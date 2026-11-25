import type { ReactNode } from 'react'
import { Card, Progress, type Tone } from './ui'
import { useApp } from '../lib/store'
import { fmtDate } from '../lib/date'
import { cn, fmt, pct } from '../lib/util'
import { poolRatio } from '../lib/finance'
import { navigate } from '../lib/route'

function Tile({
  label, value, sub, tone, children, big,
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; children?: ReactNode; big?: boolean }) {
  const colour = tone === 'danger' ? 'text-rose-600' : tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900'
  return (
    <button
      type="button"
      onClick={() => navigate('wallet')}
      className={cn('min-w-0 rounded-xl p-3.5 text-left transition-colors hover:bg-slate-50', big && 'col-span-2 lg:col-span-1')}
    >
      <div className="label-couture">{label}</div>
      <div className={cn('tnum mt-1.5 font-display font-semibold', big ? 'text-[34px] leading-none' : 'text-[24px] leading-none', colour)}>{value}</div>
      {sub && <div className="mt-1 text-xs leading-snug text-slate-500">{sub}</div>}
      {children}
    </button>
  )
}

const SEGMENTS = [
  { key: 'rent', label: 'Rent', cls: 'bg-slate-700' },
  { key: 'fixed', label: 'Bills', cls: 'bg-slate-500' },
  { key: 'debt', label: 'Debt', cls: 'bg-rose-400' },
  { key: 'savings', label: 'Savings', cls: 'bg-emerald-500' },
  { key: 'pocket', label: 'Pocket pool', cls: 'bg-gold' },
] as const

/** The first thing you see every day: what you can spend per day / per week, the pool, and the fixed money. */
export function MoneyStrip() {
  const { fv } = useApp()
  const p = fv.pending
  const over = fv.todayLeft < 0
  const a = fv.alloc

  const todayTone: Tone | undefined = p ? undefined : over ? 'danger' : fv.todayLeft < fv.dailyLimit * 0.25 ? 'warn' : 'ok'
  const weekTone: Tone | undefined = p ? undefined : fv.weekLeft < 0 ? 'danger' : undefined
  const poolTone: Tone | undefined = p ? undefined : poolRatio(fv) < 0.2 ? 'danger' : poolRatio(fv) < 0.4 ? 'warn' : undefined
  const saved = fv.savings.floorNow + fv.savings.swept - fv.savings.withdrawals - fv.topups


  return (
    <Card bodyClass="p-2 sm:p-3">
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-5">
        <Tile
          big
          label="You can spend today"
          tone={todayTone}
          value={p ? '₹0' : over ? `−${fmt(-fv.todayLeft)}` : fmt(fv.todayLeft)}
          sub={
            p
              ? (fv.waitingFirst ? `We are between engagements until ${fmtDate(fv.cycle.nextPayday)}` : 'Enter your salary to begin')
              : over ? `over today's ${fmt(fv.dailyLimit)} limit` : `of ${fmt(fv.dailyLimit)} a day · spent ${fmt(fv.todaySpend)}`
          }
        />
        <Tile
          label="Left this week"
          tone={weekTone}
          value={p ? '₹0' : fv.weekLeft < 0 ? `−${fmt(-fv.weekLeft)}` : fmt(fv.weekLeft)}
          sub={p ? 'Nothing to budget until payday' : `≈ ${fmt(fv.weekPace)} a week pace · ${fv.daysLeftInWeek} day${fv.daysLeftInWeek === 1 ? '' : 's'} to go`}
        />
        <Tile
          label="Pocket pool left"
          tone={poolTone}
          value={p ? '₹0' : fmt(fv.remaining)}
          sub={p ? (fv.waitingFirst ? `Salary lands ${fmtDate(fv.cycle.nextPayday)} · ${fv.cycle.daysToPayday} days` : 'Enter your salary to start') : `of ${fmt(fv.poolTotal)} · ${fv.cycle.daysLeft} days to payday`}
        >
          {!p && <Progress value={pct(fv.remaining, fv.poolTotal)} tone={poolTone ?? 'ok'} h="h-1.5" className="mt-2" />}
        </Tile>
        <Tile
          label="Savings"
          tone={p ? undefined : 'ok'}
          value={p ? '₹0' : fmt(saved)}
          sub={p ? `Fixed: ${fmt(fv.plan.savings)} a month` : `fixed ${fmt(a.savings)} a month`}
        />
        <Tile
          label="Debt still owed"
          value={fmt(fv.debt.remaining)}
          tone={fv.debt.cleared ? 'ok' : undefined}
          sub={fv.debt.cleared ? 'debt-free' : fv.debt.installmentLeft > 0 ? `${fmt(fv.debt.installmentLeft)} due this cycle` : 'this cycle paid'}
        />
      </div>

      {!p && a.salary > 0 && (
        <div className="mt-2 border-t border-line-soft px-3 pb-1 pt-3">
          <div className="mb-1.5 text-[11px] text-slate-500">Where your {fmt(a.salary)} salary went</div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Salary allocation">
            {SEGMENTS.map((s) => {
              const v = a[s.key]
              return v > 0 ? <div key={s.key} className={s.cls} style={{ width: `${(v / a.salary) * 100}%` }} title={`${s.label} ${fmt(v)}`} /> : null
            })}
          </div>
          <div className="mt-1.5 hidden flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500 sm:flex">
            {SEGMENTS.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', s.cls)} />{s.label} <b className="tnum font-medium text-slate-700">{fmt(a[s.key])}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
