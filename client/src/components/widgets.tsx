import { useEffect, useState } from 'react'
import { Check, Droplets, Flame, Footprints, Undo2, UtensilsCrossed } from 'lucide-react'
import { Badge, Btn, Chip, ConfirmButton, Field, inputCls, Progress, Ring, Sheet } from './ui'
import { useApp } from '../lib/store'
import {
  addMeal, addSteps, addWater, clearSteps, clearWater, removeLastWater, setExtraSteps, setWaterTotal, toggleHabit, type Mut,
} from '../lib/actions'
import { dayStats, dayCounts, getDayLog } from '../lib/day'
import { APPLIANCES, MEAL_SLOTS } from '../lib/defaults'
import { addDays } from '../lib/date'
import { cn, fmt, litres, num } from '../lib/util'
import type { Appliance, MealSlot } from '../types'

// ---------- hydration ----------

const WATER_BUTTONS = [
  { label: '+250ml Water', ml: 250, name: 'Water' },
  { label: '+500ml Bottle', ml: 500, name: 'Bottle' },
  { label: 'Morning Amla/Lemon Water', ml: 250, name: 'Amla/Lemon', habit: 'amla' },
  { label: 'Coconut Water', ml: 250, name: 'Coconut water' },
]

export function WaterTracker({ compact }: { compact?: boolean }) {
  const { state, update, today, toast } = useApp()
  const [setMl, setSetMl] = useState('')
  const st = dayStats(state, today)
  const log = getDayLog(state, today)
  const glasses = Math.ceil(st.waterTarget / state.targets.glassMl)
  const filled = Math.floor(st.waterMl / state.targets.glassMl)
  const done = st.waterMl >= st.waterTarget

  const add = (b: (typeof WATER_BUTTONS)[number]) => {
    const muts: Mut[] = [addWater(today, b.ml, b.name)]
    if (b.habit && !log.habits[b.habit]) muts.push(toggleHabit(today, b.habit))
    update((s) => muts.reduce((acc, m) => m(acc), s))
    if (st.waterMl + b.ml >= st.waterTarget && !done) toast('Hydration target hit 💧', 'ok')
  }

  const buttons = compact ? WATER_BUTTONS.slice(0, 2) : WATER_BUTTONS

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Ring value={st.waterMl / st.waterTarget} tone={done ? 'ok' : 'info'} size={compact ? 76 : 92}>
          <span className="tnum text-base font-semibold leading-none">{litres(st.waterMl)}</span>
          <span className="text-[10px] text-slate-500">of {litres(st.waterTarget)}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {done ? 'Target hit — nice.' : `${num(st.waterTarget - st.waterMl)} ml to go`}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1" aria-label={`${filled} of ${glasses} glasses`}>
            {Array.from({ length: glasses }, (_, i) => (
              <span key={i} className={cn('h-4 w-3 rounded-sm border', i < filled ? 'border-sky-500 bg-sky-400' : 'border-slate-200 bg-slate-50')} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {buttons.map((b) => (
          <Btn key={b.label} variant="outline" size="sm" onClick={() => add(b)} className="h-auto! min-h-9 whitespace-normal! py-1.5 text-center leading-tight">
            <Droplets size={13} className="shrink-0 text-sky-500" /> {b.label}
          </Btn>
        ))}
      </div>
      {!compact && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const n = Number(setMl)
              if (!Number.isFinite(n) || n < 0 || setMl === '') return
              update(setWaterTotal(today, n))
              setSetMl('')
            }}
          >
            <input
              className={inputCls} inputMode="numeric" type="number" min={0} value={setMl}
              onChange={(e) => setSetMl(e.target.value)} placeholder="Set today's total in ml (e.g. 2000)"
            />
            <Btn type="submit" variant="soft">Set</Btn>
          </form>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{log.water.length} drink{log.water.length === 1 ? '' : 's'} logged today</span>
            <span className="flex items-center gap-2">
              {log.water.length > 0 && (
                <button className="inline-flex items-center gap-1 hover:text-slate-800" onClick={() => update(removeLastWater(today))}>
                  <Undo2 size={12} /> Undo last
                </button>
              )}
              <ConfirmButton label="Reset water" confirmLabel="Yes, reset" disabled={log.water.length === 0} onConfirm={() => { update(clearWater(today)); toast('Water reset to 0', 'info') }} />
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- steps ----------

export function StepTracker({ compact }: { compact?: boolean }) {
  const { state, update, today, toast } = useApp()
  const st = dayStats(state, today)
  const log = getDayLog(state, today)
  const walk = state.habits.find((h) => h.stepCredit)
  const [total, setTotal] = useState('')
  const done = st.steps >= st.stepTarget

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Ring value={st.steps / st.stepTarget} tone={done ? 'ok' : 'warn'} size={compact ? 76 : 92}>
          <span className="tnum text-base font-semibold leading-none">{num(st.steps)}</span>
          <span className="text-[10px] text-slate-500">of {num(st.stepTarget)}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{done ? 'Steps done — nice.' : `${num(st.stepTarget - st.steps)} steps to go`}</div>
          <div className="mt-0.5 text-xs text-slate-500">{num(st.stepCredit)} from the gym walk · {num(log.extraSteps)} other</div>
        </div>
      </div>
      {walk && (
        <button
          onClick={() => update(toggleHabit(today, walk.id))}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors',
            log.habits[walk.id] ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-line bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', log.habits[walk.id] ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}>
            {log.habits[walk.id] && <Check size={11} />}
          </span>
          <span className="min-w-0 flex-1">{walk.label}</span>
          <span className="tnum shrink-0 text-slate-500">+{num(walk.stepCredit ?? 0)}</span>
        </button>
      )}
      <div className="grid grid-cols-3 gap-2">
        {[500, 1000, 2000].map((n) => (
          <Btn key={n} variant="outline" size="sm" onClick={() => update(addSteps(today, n))}>
            <Footprints size={13} className="text-amber-500" /> +{num(n)}
          </Btn>
        ))}
      </div>
      {!compact && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(total)
            if (!Number.isFinite(n) || n <= 0) return
            update(setExtraSteps(today, Math.max(0, n - st.stepCredit)))
            setTotal('')
          }}
        >
          <input
            className={inputCls} inputMode="numeric" type="number" min={0} value={total}
            onChange={(e) => setTotal(e.target.value)} placeholder="Set today's total from phone / watch"
          />
          <Btn type="submit" variant="soft">Set</Btn>
        </form>
      )}
      {!compact && (
        <div className="flex justify-end">
          <ConfirmButton
            label="Reset steps" confirmLabel="Yes, reset"
            disabled={st.steps === 0}
            onConfirm={() => { update(clearSteps(today, state.habits.filter((h) => h.stepCredit).map((h) => h.id))); toast('Steps reset to 0', 'info') }}
          />
        </div>
      )}
    </div>
  )
}

// ---------- habits ----------

export function useStreak(): number {
  const { state, today } = useApp()
  let streak = 0
  let d = today
  // today may still be in progress: if it doesn't count yet, start from yesterday
  if (!dayCounts(state, d)) d = addDays(d, -1)
  for (let i = 0; i < 365; i++) {
    if (!dayCounts(state, d)) break
    streak++
    d = addDays(d, -1)
  }
  return streak
}

export function HabitList() {
  const { state, update, today } = useApp()
  const log = getDayLog(state, today)
  const done = state.habits.filter((h) => log.habits[h.id]).length
  const streak = useStreak()
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <Badge tone={done === state.habits.length ? 'ok' : 'neutral'}>{done}/{state.habits.length} done</Badge>
        <Badge tone={streak >= 3 ? 'ok' : 'neutral'}><Flame size={11} /> {streak}-day streak</Badge>
      </div>
      <Progress value={(done / Math.max(1, state.habits.length)) * 100} />
      <ul className="space-y-1">
        {state.habits.map((h) => (
          <li key={h.id}>
            <button
              onClick={() => update(toggleHabit(today, h.id))}
              className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm hover:bg-slate-50"
            >
              <span className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors', log.habits[h.id] ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white')}>
                {log.habits[h.id] && <Check size={12} strokeWidth={3} />}
              </span>
              <span className={cn('flex-1', log.habits[h.id] && 'text-slate-400 line-through')}>{h.label}</span>
              {h.stepCredit && <span className="tnum text-[11px] text-slate-400">+{num(h.stepCredit)} steps</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- meal logging ----------

export function slotForNow(hour: number): MealSlot {
  if (hour < 7) return 'Pre-Workout'
  if (hour < 11) return 'Breakfast'
  if (hour < 16) return 'Lunch'
  if (hour < 19) return 'Evening Snack'
  return 'Dinner'
}

export interface MealPrefill {
  slot?: MealSlot
  title?: string
  appliances?: Appliance[]
  protein?: number
  cost?: number
}

export function MealSheet({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: MealPrefill }) {
  const { state, update, today, now, toast } = useApp()
  const [slot, setSlot] = useState<MealSlot>('Lunch')
  const [title, setTitle] = useState('')
  const [apps, setApps] = useState<Appliance[]>([])
  const [cost, setCost] = useState('')
  const [protein, setProtein] = useState('')

  useEffect(() => {
    if (!open) return
    setSlot(prefill?.slot ?? slotForNow(now.getHours()))
    setTitle(prefill?.title ?? '')
    setApps(prefill?.appliances ?? [])
    setCost(prefill?.cost ? String(prefill.cost) : '')
    setProtein(prefill?.protein ? String(prefill.protein) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill])

  const submit = () => {
    if (!title.trim()) return
    const c = Math.max(0, Math.round(Number(cost) || 0))
    update(addMeal({ date: today, slot, title: title.trim(), appliances: apps, cost: c, protein: Math.round(Number(protein) || 0) }))
    toast(c > 0 ? `${slot} logged · ${fmt(c)} added to Outside Food` : `${slot} logged`, 'ok')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log a meal">
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {MEAL_SLOTS.map((s) => <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>{s}</Chip>)}
        </div>
        <Field label="What did you eat?">
          <input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 3-egg bhurji + rice" />
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Cooked with</div>
          <div className="flex flex-wrap gap-1.5">
            {APPLIANCES.map((a) => (
              <Chip key={a} active={apps.includes(a)} onClick={() => setApps((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]))}>
                [{a}]
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Outside meal cost (₹)" hint="Leave empty if home-cooked">
            <input className={inputCls} type="number" inputMode="numeric" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Protein (g, optional)" hint={`Daily target ${state.targets.proteinG} g`}>
            <input className={inputCls} type="number" inputMode="numeric" min={0} value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <Btn type="submit" variant="primary" size="lg" className="w-full" disabled={!title.trim()}>
          <UtensilsCrossed size={16} /> Log meal
        </Btn>
      </form>
    </Sheet>
  )
}
