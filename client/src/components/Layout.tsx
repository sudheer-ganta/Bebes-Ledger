import type { ReactNode } from 'react'
import {
  CalendarDays, Cloud, CloudOff, Dumbbell, LayoutDashboard, LifeBuoy, ListChecks, NotebookPen, Plus, RefreshCw,
  Settings as SettingsIcon, ShoppingBasket, Wallet,
} from 'lucide-react'
import { useApp } from '../lib/store'
import { useReminders } from '../lib/reminders'
import { navigate, type Route } from '../lib/route'
import { fmtDate, fmtLong } from '../lib/date'
import { cn, fmt } from '../lib/util'
import { QuickExpense } from './QuickExpense'
import { toneBg } from './ui'

const NAV: Array<{ id: Route; label: string; short: string; icon: ReactNode }> = [
  { id: 'today', label: 'Today', short: 'Today', icon: <LayoutDashboard size={17} /> },
  { id: 'wallet', label: 'Money & debt', short: 'Money', icon: <Wallet size={17} /> },
  { id: 'food', label: 'Food & groceries', short: 'Food', icon: <ShoppingBasket size={17} /> },
  { id: 'todo', label: 'Tasks', short: 'Tasks', icon: <ListChecks size={17} /> },
  { id: 'body', label: 'Body & water', short: 'Body', icon: <Dumbbell size={17} /> },
  { id: 'calendar', label: 'Calendar', short: 'Calendar', icon: <CalendarDays size={17} /> },
  { id: 'journal', label: 'Journal', short: 'Journal', icon: <NotebookPen size={17} /> },
]

function SyncDot() {
  const { sync } = useApp()
  const map = {
    local: { icon: <CloudOff size={13} />, label: 'Local only', cls: 'text-slate-400' },
    connecting: { icon: <RefreshCw size={13} className="animate-spin" />, label: 'Connecting…', cls: 'text-slate-400' },
    syncing: { icon: <RefreshCw size={13} className="animate-spin" />, label: 'Syncing…', cls: 'text-sky-600' },
    synced: { icon: <Cloud size={13} />, label: 'Synced with Moira', cls: 'text-emerald-400' },
    error: { icon: <CloudOff size={13} />, label: 'Sync error (saved locally)', cls: 'text-amber-600' },
    auth: { icon: <CloudOff size={13} />, label: 'API key needed (Settings)', cls: 'text-rose-600' },
  }[sync]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px]', map.cls)} title={map.label}>
      {map.icon}
      <span className="hidden lg:inline">{map.label}</span>
    </span>
  )
}

export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  const { fv, today, toasts, openExpense } = useApp()
  useReminders()
  const overspent = fv.todayLeft < 0

  return (
    <div className="flex min-h-dvh">
      {/* ---------- desktop sidebar: black couture ---------- */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-slate-900 text-slate-300 lg:flex">
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <div className="grid h-10 w-10 place-items-center rounded-full border border-white/40 text-lg font-semibold text-white">M</div>
          <div>
            <div className="text-[16px] font-semibold leading-tight text-white">Bébé's Ledger</div>
            <div className="text-[11px] text-slate-400">{fmtLong(today)}</div>
          </div>
        </div>
        <div className="mx-5 h-px bg-white/10" />

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Main">
          {NAV.map((n) => {
            const on = route === n.id
            return (
              <button
                key={n.id}
                onClick={() => navigate(n.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                  on ? 'bg-white/[0.07] text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {on && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-white" />}
                <span className={on ? "text-white" : "text-slate-500 group-hover:text-slate-300"}>{n.icon}</span>
                <span className="text-[14px] font-medium">{n.label}</span>
              </button>
            )
          })}
          <div className="!my-3 mx-3 h-px bg-white/10" />
          <button
            onClick={() => navigate('crisis')}
            aria-current={route === 'crisis' ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-medium transition-colors',
              route === 'crisis' ? 'bg-rose-600/25 text-rose-200' : 'text-rose-300 hover:bg-rose-600/15',
            )}
          >
            <LifeBuoy size={17} /> SOS · crisis mode
          </button>
          <button
            onClick={() => navigate('settings')}
            aria-current={route === 'settings' ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-medium transition-colors',
              route === 'settings' ? 'bg-white/[0.07] text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
            )}
          >
            <SettingsIcon size={17} className="text-slate-500" /> Settings & data
          </button>
        </nav>

        <div className="m-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          {fv.pending ? (
            <>
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">{fv.waitingFirst ? 'Between engagements' : 'Salary day'}</div>
              <div className="tnum mt-1 text-3xl font-semibold text-white">{fv.waitingFirst ? `${fv.cycle.daysToPayday} days` : 'Enter it'}</div>
              <div className="mt-0.5 text-xs text-slate-400">{fv.waitingFirst ? `until salary · ${fmtDate(fv.cycle.nextPayday)}` : 'to allocate the month'}</div>
            </>
          ) : (
            <>
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Safe to spend today</div>
              <div className={cn('tnum mt-1 text-3xl font-semibold', overspent ? 'text-rose-300' : 'text-white')}>
                {fmt(fv.todayLeft)}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {fmt(fv.remaining)} in the purse · {fv.cycle.daysLeft}d to payday
              </div>
            </>
          )}
          <div className="mt-3"><SyncDot /></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- mobile header ---------- */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-canvas/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-sm font-semibold text-white">M</div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">{NAV.find((n) => n.id === route)?.label ?? (route === 'crisis' ? 'SOS' : 'Settings')}</div>
              <div className="text-[11px] text-slate-500">{fmtLong(today)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn('tnum rounded-md border px-2 py-1 text-xs font-semibold', fv.pending ? toneBg.neutral : overspent ? toneBg.danger : toneBg.ok)}>
              {fv.pending ? (fv.waitingFirst ? `Salary in ${fv.cycle.daysToPayday}d` : 'Enter salary') : `${fmt(fv.todayLeft)} left`}
            </span>
            <button onClick={() => navigate('calendar')} aria-label="Calendar" className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><CalendarDays size={18} /></button>
            <button onClick={() => navigate('journal')} aria-label="Journal" className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><NotebookPen size={18} /></button>
            <button onClick={() => navigate('settings')} aria-label="Settings" className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><SettingsIcon size={18} /></button>
            <button onClick={() => navigate('crisis')} aria-label="SOS" className="flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-bold text-white"><LifeBuoy size={14} /> SOS</button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-28 pt-6 lg:px-10 lg:pb-28 lg:pt-10">
          {children}
        </main>

        {/* ---------- mobile bottom tab bar ---------- */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/10 bg-slate-900/95 backdrop-blur lg:hidden" aria-label="Main">
          {NAV.filter((n) => n.id !== 'journal' && n.id !== 'calendar').map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              aria-current={route === n.id ? 'page' : undefined}
              className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', route === n.id ? "text-white" : "text-slate-400")}
            >
              {n.icon}
              {n.short}
            </button>
          ))}
        </nav>
      </div>

      {/* ---------- 1-tap expense FAB ---------- */}
      <button
        onClick={() => openExpense()}
        aria-label="Log expense"
        className="fixed bottom-20 right-4 z-40 flex h-14 items-center gap-1.5 rounded-full border border-white/15 bg-slate-900 px-5 text-sm font-medium text-white shadow-[0_14px_30px_-12px_rgb(23_19_15/0.7)] transition-transform hover:scale-[1.03] active:scale-95 lg:bottom-8 lg:right-8"
      >
        <Plus size={20} /> <span className="hidden sm:inline">Log expense</span>
        <span className="sr-only sm:hidden">Log expense</span>
      </button>

      <QuickExpense />

      <div className="pointer-events-none fixed inset-x-0 bottom-36 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-24" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn('toast-anim pointer-events-auto max-w-sm rounded-lg border px-3.5 py-2 text-sm font-medium shadow-md', toneBg[t.tone === 'ok' ? 'ok' : t.tone])}>
            {t.msg}
            {t.action && (
              <button onClick={t.action.onClick} className="ml-3 font-semibold underline underline-offset-2">
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
