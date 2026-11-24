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
  { id: 'today', label: "Today's Command Center", short: 'Today', icon: <LayoutDashboard size={18} /> },
  { id: 'wallet', label: '₹ Wallet, Debt & Pool', short: 'Wallet', icon: <Wallet size={18} /> },
  { id: 'food', label: 'Groceries & Nutrition', short: 'Food', icon: <ShoppingBasket size={18} /> },
  { id: 'todo', label: 'Smart To-Do List', short: 'Tasks', icon: <ListChecks size={18} /> },
  { id: 'body', label: 'Gym, Steps & Hydration', short: 'Body', icon: <Dumbbell size={18} /> },
  { id: 'calendar', label: 'Consistency Calendar', short: 'Calendar', icon: <CalendarDays size={18} /> },
  { id: 'journal', label: 'Daily Journal & Notes', short: 'Journal', icon: <NotebookPen size={18} /> },
]

function SyncDot() {
  const { sync } = useApp()
  const map = {
    local: { icon: <CloudOff size={13} />, label: 'Local only', cls: 'text-slate-400' },
    connecting: { icon: <RefreshCw size={13} className="animate-spin" />, label: 'Connecting…', cls: 'text-slate-400' },
    syncing: { icon: <RefreshCw size={13} className="animate-spin" />, label: 'Syncing…', cls: 'text-sky-600' },
    synced: { icon: <Cloud size={13} />, label: 'Synced to MongoDB', cls: 'text-emerald-600' },
    error: { icon: <CloudOff size={13} />, label: 'Sync error (saved locally)', cls: 'text-amber-600' },
    auth: { icon: <CloudOff size={13} />, label: 'API key needed (Settings)', cls: 'text-rose-600' },
  }[sync]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px]', map.cls)} title={map.label}>
      {map.icon}
      <span className="hidden xl:inline">{map.label}</span>
    </span>
  )
}

export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  const { fv, today, toasts, openExpense } = useApp()
  useReminders()
  const overspent = fv.todayLeft < 0

  return (
    <div className="flex min-h-dvh">
      {/* ---------- desktop sidebar ---------- */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-[#E5E7EB] bg-[#FAFAFA] lg:flex">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-bold text-emerald-400">L</div>
          <div>
            <div className="text-sm font-semibold leading-tight">Life OS</div>
            <div className="text-[11px] text-slate-500">{fmtLong(today)}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              aria-current={route === n.id ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                route === n.id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-[#E5E7EB]' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <span className={route === n.id ? 'text-slate-900' : 'text-slate-400'}>{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div className="my-2 border-t border-[#E5E7EB]" />
          <button
            onClick={() => navigate('crisis')}
            aria-current={route === 'crisis' ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors',
              route === 'crisis' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'text-rose-600 hover:bg-rose-50',
            )}
          >
            <LifeBuoy size={18} /> SOS · Crisis Mode
          </button>
          <button
            onClick={() => navigate('settings')}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
              route === 'settings' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-[#E5E7EB]' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <SettingsIcon size={18} className="text-slate-400" /> Settings & Data
          </button>
        </nav>

        <div className="m-3 rounded-xl border border-[#E5E7EB] bg-white p-3">
          {fv.pending ? (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{fv.waitingFirst ? 'Waiting for salary' : 'Salary day'}</div>
              <div className="tnum text-2xl font-semibold tracking-tight text-slate-700">{fv.waitingFirst ? `${fv.cycle.daysToPayday} days` : 'Enter it'}</div>
              <div className="mt-0.5 text-xs text-slate-500">{fv.waitingFirst ? `first month starts ${fmtDate(fv.cycle.nextPayday)}` : 'to allocate the month'}</div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Safe to spend today</div>
              <div className={cn('tnum text-2xl font-semibold tracking-tight', overspent ? 'text-rose-600' : 'text-emerald-600')}>
                {fmt(fv.todayLeft)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {fmt(fv.remaining)} pool · {fv.cycle.daysLeft}d to payday
              </div>
            </>
          )}
          <div className="mt-2"><SyncDot /></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- mobile header ---------- */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-[#E5E7EB] bg-[#FAFAFA]/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-xs font-bold text-emerald-400">L</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{NAV.find((n) => n.id === route)?.short ?? (route === 'crisis' ? 'SOS' : 'Settings')}</div>
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

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-28 lg:pt-8">
          {children}
        </main>

        {/* ---------- mobile bottom tab bar ---------- */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[#E5E7EB] bg-white/95 backdrop-blur lg:hidden" aria-label="Main">
          {NAV.filter((n) => n.id !== 'journal' && n.id !== 'calendar').map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              aria-current={route === n.id ? 'page' : undefined}
              className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', route === n.id ? 'text-slate-900' : 'text-slate-400')}
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
        className="fixed bottom-20 right-4 z-40 flex h-14 items-center gap-1.5 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 active:scale-95 lg:bottom-8 lg:right-8"
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
