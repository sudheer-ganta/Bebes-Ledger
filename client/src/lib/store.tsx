import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { AppState } from '../types'
import { toISO } from './date'
import { makeDefaultState } from './defaults'
import { hydrate } from './hydrate'
import { computeFinance, type FinanceView } from './finance'
import { applyAutoSweeps, type Mut } from './actions'
import * as api from './api'

const KEY = 'life-os-v1'

function loadLocal(): AppState {
  try {
    const txt = localStorage.getItem(KEY)
    return hydrate(txt ? (JSON.parse(txt) as Partial<AppState>) : null)
  } catch {
    return makeDefaultState()
  }
}

export type SyncStatus = 'local' | 'connecting' | 'syncing' | 'synced' | 'error' | 'auth'

const statusOf = (e: unknown): SyncStatus => (e instanceof api.ApiError && e.status === 401 ? 'auth' : 'error')
export type Tone = 'ok' | 'warn' | 'danger' | 'info'
export interface ToastAction {
  label: string
  onClick: () => void
}

interface Ctx {
  state: AppState
  update: (m: Mut) => void
  replaceAll: (s: AppState) => void
  resetAll: () => void
  today: string
  now: Date
  fv: FinanceView
  toast: (msg: string, tone?: Tone, action?: ToastAction) => void
  toasts: Array<{ id: number; msg: string; tone: Tone; action?: ToastAction }>
  sync: SyncStatus
  openExpense: (preset?: { title: string; amount: number; category: string }) => void
  expenseOpen: { open: boolean; preset?: { title: string; amount: number; category: string } }
  closeExpense: () => void
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadLocal)
  const [now, setNow] = useState(() => new Date())
  const [sync, setSync] = useState<SyncStatus>('local')
  const [toasts, setToasts] = useState<Ctx['toasts']>([])
  const [expenseOpen, setExpenseOpen] = useState<Ctx['expenseOpen']>({ open: false })
  const apiOn = useRef(false)
  const toastId = useRef(0)

  const today = toISO(now)
  const fv = useMemo(() => computeFinance(state, today), [state, today])

  // clock tick (alerts, day rollover)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    const onVis = () => document.visibilityState === 'visible' && setNow(new Date())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // persist locally on every change
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full / blocked — keep running in memory */
    }
  }, [state])

  // Sunday sweeps (idempotent — returns the same object when nothing is due)
  useEffect(() => {
    setState((s) => applyAutoSweeps(today)(s))
  }, [today, state.finance.autoSweep, state.finance.paydayDay])

  // ----- optional server sync (last write wins on `updatedAt`) -----
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  /** Take the server's copy, keeping what was on this device as a one-slot safety backup. */
  const adopt = useCallback((remote: AppState) => {
    try {
      localStorage.setItem(`${KEY}-backup`, JSON.stringify(stateRef.current))
    } catch {
      /* ignore */
    }
    setState(hydrate(remote))
  }, [])

  const syncDown = useCallback(async () => {
    if (!apiOn.current) return
    try {
      const remote = await api.pull()
      if (remote && remote.updatedAt > stateRef.current.updatedAt) adopt(remote)
      setSync('synced')
    } catch (e) {
      setSync(statusOf(e))
    }
  }, [adopt])

  useEffect(() => {
    let cancelled = false
    // On a hosted deployment the free server may still be waking up: keep trying for a couple of minutes.
    const hosted = !/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)
    const attempts = hosted ? 10 : 1
    ;(async () => {
      for (let i = 0; i < attempts && !cancelled; i++) {
        setSync('connecting')
        if (await api.probe(hosted ? 12_000 : 2_000)) {
          try {
            const remote = await api.pull()
            if (cancelled) return
            const local = stateRef.current
            if (remote && remote.updatedAt > local.updatedAt) adopt(remote)
            else await api.push(local)
            apiOn.current = true
            setSync('synced')
          } catch (e) {
            if (!cancelled) setSync(statusOf(e))
          }
          return
        }
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 12_000))
      }
      if (!cancelled) setSync('local')
    })()
    return () => {
      cancelled = true
    }
  }, [adopt])

  // pick up changes made on another device when the app comes back to the foreground, and once a minute
  useEffect(() => {
    const check = () => document.visibilityState === 'visible' && void syncDown()
    document.addEventListener('visibilitychange', check)
    const t = setInterval(check, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      clearInterval(t)
    }
  }, [syncDown])

  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!apiOn.current) return
    setSync('syncing')
    const t = setTimeout(() => {
      api
        .push(state)
        .then(() => setSync('synced'))
        .catch((e) => (e instanceof api.ApiError && e.status === 409 ? syncDown() : setSync(statusOf(e))))
    }, 1200)
    return () => clearTimeout(t)
  }, [state, syncDown])

  const update = useCallback((m: Mut) => setState((s) => m(s)), [])
  const replaceAll = useCallback((s: AppState) => setState({ ...hydrate(s), updatedAt: new Date().toISOString() }), [])
  const resetAll = useCallback(() => setState({ ...makeDefaultState(), updatedAt: new Date().toISOString() }), [])

  const toast = useCallback((msg: string, tone: Tone = 'ok', action?: ToastAction) => {
    const id = ++toastId.current
    const wrapped = action
      ? { label: action.label, onClick: () => { action.onClick(); setToasts((t) => t.filter((x) => x.id !== id)) } }
      : undefined
    setToasts((t) => [...t.slice(-2), { id, msg, tone, action: wrapped }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 5000 : 3200)
  }, [])

  const openExpense = useCallback<Ctx['openExpense']>((preset) => setExpenseOpen({ open: true, preset }), [])
  const closeExpense = useCallback(() => setExpenseOpen({ open: false }), [])

  const value: Ctx = {
    state, update, replaceAll, resetAll, today, now, fv, toast, toasts, sync, openExpense, expenseOpen, closeExpense,
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used inside <AppProvider>')
  return c
}

export const exportJSON = (s: AppState) => JSON.stringify(s, null, 2)
