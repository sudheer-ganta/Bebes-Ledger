import { useMemo, useState } from 'react'
import { Banknote, CheckCircle2, PiggyBank, Plus, Trash2, TrendingUp } from 'lucide-react'
import { Badge, Btn, Card, Chip, ConfirmButton, Empty, Field, inputCls, PageHeader, Progress, Stat, type Tone } from '../components/ui'
import { AlertList } from '../components/Alerts'
import { AllocWarnings, SalarySheet, WaitingForSalary } from '../components/Salary'
import { useApp } from '../lib/store'
import { clearCycleExpenses, clearDebtPayments, deleteExpense, logDebtPayment, setPaid, sweepNow } from '../lib/actions'
import { buildAlerts } from '../lib/smart'
import { dailySeries, dueDateInCycle, poolRatio, previewCurrentWeekSweep, spendByCategory, weekdaySpend } from '../lib/finance'
import { fmtDate } from '../lib/date'
import { cn, fmt, pct, sum } from '../lib/util'
import type { ExpenseCategory } from '../types'

const CAT_COLOUR: Record<ExpenseCategory, string> = {
  Groceries: 'bg-emerald-500',
  'Outside Food': 'bg-amber-500',
  'Movies/Dates': 'bg-violet-500',
  Rides: 'bg-sky-500',
  Personal: 'bg-slate-500',
  Emergency: 'bg-rose-500',
}

export function WalletPage() {
  const { state, fv, openExpense } = useApp()
  const f = state.finance
  const c = fv.cycle
  const alerts = buildAlerts(state, fv)

  return (
    <div className="space-y-4">
      <PageHeader
        title="₹ Wallet, Debt & Pool"
        sub={fv.pending && fv.waitingFirst ? `First month starts ${fmtDate(c.nextPayday)} · salary on the ${f.paydayDay}${ord(f.paydayDay)}` : `Pay cycle ${fmtDate(c.start)} → ${fmtDate(c.end)} · ${c.daysLeft} days left · salary on the ${f.paydayDay}${ord(f.paydayDay)}`}
        right={<Btn variant="primary" onClick={() => openExpense()}><Plus size={15} /> Log expense</Btn>}
      />
      <AlertList alerts={alerts} />

      {fv.pending ? (
        <>
          <WaitingForSalary />
          <DebtCard />
        </>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <PoolCard />
            <SalaryCard />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DebtCard />
            <SavingsCard />
          </div>
          <Analytics />
        </>
      )}
      <ExpenseLog />
    </div>
  )
}

const ord = (n: number) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th')

// ---------- pool & sub-buckets ----------

function PoolCard() {
  const { fv } = useApp()
  const b = fv.alloc.buckets
  const tone: Tone = poolRatio(fv) < 0.2 ? 'danger' : poolRatio(fv) < 0.4 ? 'warn' : 'ok'
  const rows: Array<{ label: string; note: string; spent: number; budget: number; left: number; tone: Tone }> = [
    { label: 'Groceries & Nutrition', note: '~₹600 / week', spent: fv.groceries.spent, budget: fv.groceries.budget, left: fv.groceries.left, tone: fv.groceries.left < 0 ? 'danger' : 'ok' },
    { label: 'Lifestyle Flex', note: 'movies · dates · rides · outside food · personal', spent: fv.lifestyle.spent, budget: fv.lifestyle.budget, left: fv.lifestyle.left, tone: fv.lifestyle.left <= 0 ? 'danger' : fv.lifestyle.left / Math.max(1, b.lifestyle) < 0.25 ? 'warn' : 'ok' },
    { label: 'Pool Buffer / Rollover', note: 'sweeps to savings every Sunday', spent: fv.buffer.used, budget: fv.buffer.target, left: fv.buffer.left, tone: fv.buffer.left < 0 ? 'danger' : fv.buffer.used > 0 ? 'warn' : 'ok' },
  ]
  return (
    <Card title={`${fmt(fv.poolTotal)} decreasing pocket pool`} icon={<Banknote size={14} />}>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Left in pool" value={fmt(fv.remaining)} tone={tone === 'ok' ? undefined : tone} sub={`of ${fmt(fv.poolTotal)} · spent ${fmt(fv.poolSpent)}${fv.swept ? ` · swept ${fmt(fv.swept)}` : ''}`} />
        <Stat label="Per day" value={fmt(fv.dailyLimit)} sub={`today left ${fmt(Math.max(0, fv.todayLeft))}`} />
        <Stat label="This week" value={fmt(Math.max(0, fv.weekLeft))} sub={`left · ≈ ${fmt(fv.weekPace)} a week`} />
      </div>
      <Progress value={pct(fv.remaining, fv.poolTotal)} tone={tone} className="mt-3" />
      <div className="mt-4 space-y-3.5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="ml-2 hidden text-[11px] text-slate-400 sm:inline">{r.note}</span>
              </div>
              <span className={cn('tnum shrink-0 text-sm font-semibold', r.left < 0 && 'text-rose-600')}>{fmt(r.left)} <span className="font-normal text-slate-400">left</span></span>
            </div>
            <Progress value={pct(r.spent, r.budget)} tone={r.tone === 'ok' ? 'info' : r.tone} h="h-1.5" className="mt-1.5" />
            <div className="tnum mt-1 text-[11px] text-slate-500">{fmt(r.spent)} {r.label.startsWith('Pool') ? 'used' : 'spent'} of {fmt(r.budget)}</div>
          </div>
        ))}
      </div>
      {(fv.groceries.over > 0 || fv.lifestyle.over > 0) && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Overspend in a bucket automatically spills into the Pool Buffer — it's the single {fmt(fv.poolTotal)} total that matters.
        </p>
      )}
    </Card>
  )
}

// ---------- salary allocation (what was received, where it went, what's been done) ----------

function SalaryCard() {
  const { state, fv, update, today, toast } = useApp()
  const [edit, setEdit] = useState(false)
  const f = state.finance
  const a = fv.alloc
  const k = fv.cycle.key
  const rentDue = dueDateInCycle(fv.cycle, f.rentDueDay)
  const fixedDue = dueDateInCycle(fv.cycle, f.fixedDueDay)
  const debtDone = fv.debt.installmentLeft === 0

  type Row = {
    label: string
    v: number
    strong?: boolean
    sub?: string
    done?: boolean
    doneLabel?: string
    todoLabel?: string
    onToggle?: () => void
  }

  const rows: Row[] = [
    { label: 'Salary received', v: a.salary, strong: true, sub: fv.received ? `Received ${fmtDate(fv.received.receivedOn)}${a.salary !== f.salary ? ` · expected ${fmt(f.salary)}` : ''}` : undefined },
    { label: 'PG rent', v: -a.rent, done: !!state.paid[`${k}:rent`], doneLabel: 'Paid', todoLabel: `Mark paid · due ${fmtDate(rentDue)}`, onToggle: () => update(setPaid(`${k}:rent`, !state.paid[`${k}:rent`])) },
    { label: 'Fixed commitments (recharge, gym, bills)', v: -a.fixed, done: !!state.paid[`${k}:fixed`], doneLabel: 'Paid', todoLabel: `Mark paid · due ${fmtDate(fixedDue)}`, onToggle: () => update(setPaid(`${k}:fixed`, !state.paid[`${k}:fixed`])) },
    {
      label: fv.debt.cleared && a.debt === 0 ? 'Debt payoff (cleared)' : 'Debt installment', v: -a.debt,
      done: debtDone, doneLabel: fv.debt.cleared ? 'Debt-free' : 'Paid this cycle', todoLabel: `Log ${fmt(fv.debt.installmentLeft)} payment`,
      onToggle: debtDone ? undefined : () => { update(logDebtPayment(fv.debt.installmentLeft, today)); toast(`${fmt(fv.debt.installmentLeft)} debt payment logged`, 'ok') },
    },
    { label: 'Savings (fixed every month)', v: -a.savings, done: !!state.paid[`${k}:savings`], doneLabel: 'Moved to savings', todoLabel: 'Mark moved to savings', onToggle: () => update(setPaid(`${k}:savings`, !state.paid[`${k}:savings`])) },
  ]

  return (
    <Card
      title="Salary allocation" icon={<TrendingUp size={14} />}
      action={<Btn size="sm" variant="outline" onClick={() => setEdit(true)}>Edit salary</Btn>}
    >
      <ul className="divide-y divide-[#F1F5F9] text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className={cn(r.strong && 'font-semibold')}>{r.label}</div>
              {r.sub && <div className="text-[11px] text-slate-500">{r.sub}</div>}
              {r.todoLabel && (
                <button
                  onClick={r.onToggle} disabled={!r.onToggle}
                  className={cn('mt-0.5 inline-flex items-center gap-1 text-[11px]', r.done ? 'text-emerald-600' : 'text-slate-500 hover:text-slate-800')}
                >
                  <CheckCircle2 size={12} /> {r.done ? r.doneLabel : r.todoLabel}
                </button>
              )}
            </div>
            <span className={cn('tnum shrink-0', r.strong ? 'font-semibold' : 'text-slate-600')}>{fmt(r.v)}</span>
          </li>
        ))}
        <li className="-mx-4 flex items-center justify-between gap-3 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          <div>
            <div>Pocket pool — yours to spend</div>
            <div className="text-[11px] font-normal text-emerald-700/80">Groceries {fmt(a.buckets.groceries)} · Lifestyle {fmt(a.buckets.lifestyle)} · Buffer {fmt(a.buckets.buffer)}</div>
            <div className="text-[11px] font-normal text-emerald-700/80">≈ {fmt(a.pocket / fv.cycle.totalDays)} a day · {fmt((a.pocket / fv.cycle.totalDays) * 7)} a week</div>
          </div>
          <span className="tnum">{fmt(a.pocket)}</span>
        </li>
      </ul>
      <div className="mt-3"><AllocWarnings a={a} /></div>
      {!fv.debt.cleared && (
        <p className="mt-3 text-xs text-slate-500">
          Savings stay fixed at <b className="text-slate-900">{fmt(state.finance.savings)}</b>. Once the debt is cleared the pocket pool grows to <b className="text-slate-900">{fmt(fv.savings.pocketAfterDebt)}</b> / month.
        </p>
      )}
      <SalarySheet open={edit} onClose={() => setEdit(false)} />
    </Card>
  )
}

// ---------- debt ----------

function DebtCard() {
  const { state, fv, update, today, toast } = useApp()
  const d = fv.debt
  const [amount, setAmount] = useState('')
  const suggested = d.installmentLeft > 0 ? d.installmentLeft : Math.min(d.remaining, state.finance.debtPlanMonthly)
  const amt = Math.round(Number(amount) || suggested)

  const log = () => {
    if (d.remaining <= 0 || amt <= 0) return
    const paying = Math.min(amt, d.remaining)
    update(logDebtPayment(paying, today))
    const clears = paying >= d.remaining
    toast(clears ? `Debt cleared! Your pocket pool grows to ${fmt(fv.savings.pocketAfterDebt)} a month` : `${fmt(paying)} paid · ${fmt(d.remaining - paying)} to go`, 'ok')
    setAmount('')
  }

  return (
    <Card title="Debt payoff tracker" subtitle="Owed to people" icon={<Banknote size={14} />}
      action={<div className="flex items-center gap-2">{d.cleared ? <Badge tone="ok">Debt-free</Badge> : <Badge tone="warn">{d.monthsLeft} month{d.monthsLeft === 1 ? '' : 's'} left</Badge>}{state.debtPayments.length > 0 && <ConfirmButton label="Clear payments" onConfirm={() => { update(clearDebtPayments); toast("Debt payment history cleared", "info") }} />}</div>}>
      <div className="flex items-end justify-between">
        <Stat label="Still owed" value={fmt(d.remaining)} tone={d.cleared ? 'ok' : undefined} sub={`of ${fmt(d.total)} · paid ${fmt(d.paidSoFar)}`} />
        <Stat label="Plan" value={`${fmt(state.finance.debtPlanMonthly)}/mo`} sub={`over ${state.finance.debtPlanMonths} months`} />
      </div>
      <Progress value={pct(d.paidSoFar, d.total)} tone="ok" className="mt-3" />

      {d.cleared ? (
        <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          Debt cleared. Your monthly pocket pool is now <b>{fmt(fv.savings.pocketAfterDebt)}</b>; savings stay at {fmt(state.finance.savings)}.
        </div>
      ) : (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); log() }}>
          <Field label={`This cycle's installment: ${fmt(d.installmentDue)} · ${fmt(d.installmentLeft)} still to pay`}>
            <div className="flex gap-2">
              <input className={inputCls} type="number" inputMode="numeric" min={1} max={d.remaining} value={amount} placeholder={String(suggested)} onChange={(e) => setAmount(e.target.value)} />
              <Btn type="submit" variant="success"><Plus size={15} /> Log Debt Payment</Btn>
            </div>
          </Field>
          <p className="text-xs text-slate-500">
            The installment stays fixed at {fmt(state.finance.debtPlanMonthly)} a month. Once the remaining {fmt(d.remaining)} is cleared, your pocket pool grows to {fmt(fv.savings.pocketAfterDebt)} a month.
          </p>
        </form>
      )}

      {state.debtPayments.length > 0 && (
        <ul className="mt-3 divide-y divide-[#F1F5F9] border-t border-[#F1F5F9] text-sm">
          {[...state.debtPayments].reverse().map((p) => (
            <li key={p.id} className="flex justify-between py-1.5">
              <span className="text-slate-500">{fmtDate(p.date)}{p.note ? ` · ${p.note}` : ''}</span>
              <span className="tnum font-medium">{fmt(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------- savings ----------

function SavingsCard() {
  const { state, fv, update, today, toast } = useApp()
  const s = fv.savings
  const preview = previewCurrentWeekSweep(state, today)
  const sweeps = state.sweeps.filter((x) => x.cycleKey === fv.cycle.key && x.amount > 0)
  return (
    <Card title="Savings guardrail" icon={<PiggyBank size={14} />}>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Savings (fixed)" value={fmt(s.floorNow)} sub="this cycle" tone="ok" />
        <Stat label="Pool after debt" value={fmt(s.pocketAfterDebt)} sub="per month, once debt is cleared" />
        <Stat label="Swept so far" value={fmt(s.swept)} sub={`${sweeps.length} Sunday sweep${sweeps.length === 1 ? '' : 's'}`} />
        <Stat label="Emergency draws" value={fmt(s.withdrawals + fv.topups)} sub="taken from savings" tone={s.withdrawals + fv.topups > 0 ? 'warn' : undefined} />
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between"><span className="text-slate-600">Savings if you spend the whole pool</span><span className="tnum font-semibold">{fmt(s.guaranteed)}</span></div>
        <div className="mt-1 flex justify-between"><span className="text-slate-600">If you stop spending now</span><span className="tnum font-semibold text-emerald-700">{fmt(s.ifUnspent)}</span></div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {state.finance.autoSweep ? 'Every Sunday unspent weekly pocket money is swept into savings.' : 'Auto-sweep is off (Settings).'}
        </p>
        <Btn size="sm" variant="outline" disabled={!preview || preview.amount <= 0}
          onClick={() => { update(sweepNow(today)); toast(`${fmt(preview?.amount ?? 0)} swept to savings`, 'ok') }}>
          Sweep {preview ? fmt(preview.amount) : '₹0'} now
        </Btn>
      </div>
      {sweeps.length > 0 && (
        <ul className="mt-2 divide-y divide-[#F1F5F9] text-xs text-slate-600">
          {[...sweeps].reverse().map((w) => (
            <li key={w.id} className="flex justify-between py-1">
              <span>Week of {fmtDate(w.weekStart)} {w.auto ? '' : '(manual)'}</span>
              <span className="tnum font-medium text-emerald-700">+{fmt(w.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------- analytics ----------

function Analytics() {
  const { fv } = useApp()
  const series = useMemo(() => dailySeries(fv), [fv])
  const cats = spendByCategory(fv.cycleExpenses)
  const total = sum(cats.map((x) => x.amount))
  const wk = weekdaySpend(fv.cycleExpenses)
  const maxWk = Math.max(1, ...wk)
  const W = 640, H = 150, pad = 18
  const max = Math.max(fv.dailyLimit * 1.6, ...series.map((s) => s.spend), 100)
  const bw = (W - pad * 2) / series.length
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2)
  const avg = fv.cycle.elapsed > 0 ? sum(series.filter((s) => !s.future).map((s) => s.spend)) / fv.cycle.elapsed : 0
  const over = series.filter((s) => !s.future && s.spend > fv.dailyLimit).length

  return (
    <Card title="Overspend analytics" icon={<TrendingUp size={14} />} subtitle="Daily spend vs your safe limit (weekly grocery run excluded)">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily spend against safe limit">
            <line x1={pad} x2={W - pad} y1={y(fv.dailyLimit)} y2={y(fv.dailyLimit)} stroke="#10b981" strokeDasharray="4 4" strokeWidth="1.2" />
            <text x={W - pad} y={y(fv.dailyLimit) - 4} textAnchor="end" fontSize="10" fill="#059669">safe limit {fmt(fv.dailyLimit)}</text>
            {series.map((s, i) => {
              const h = Math.max(s.spend > 0 ? 2 : 0, (s.spend / max) * (H - pad * 2))
              const isToday = s.date === fv.today
              return (
                <g key={s.date}>
                  <rect x={pad + i * bw + 1} y={H - pad - h} width={Math.max(2, bw - 2)} height={h} rx="1.5"
                    fill={s.future ? '#f1f5f9' : s.spend > fv.dailyLimit ? '#f43f5e' : '#0f172a'} opacity={s.future ? 1 : isToday ? 1 : 0.85} />
                  {isToday && <rect x={pad + i * bw} y={pad / 2} width={bw} height={H - pad * 1.5} fill="#0ea5e9" opacity="0.08" />}
                </g>
              )
            })}
            <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="#e5e7eb" />
            <text x={pad} y={H - 3} fontSize="10" fill="#94a3b8">{fmtDate(fv.cycle.start)}</text>
            <text x={W - pad} y={H - 3} textAnchor="end" fontSize="10" fill="#94a3b8">{fmtDate(fv.cycle.end)}</text>
          </svg>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>Avg/day <b className="tnum text-slate-900">{fmt(avg)}</b></span>
            <span>Days over limit <b className={cn('text-slate-900', over > 0 && 'text-rose-600')}>{over}</b></span>
            {fv.projectedSpend !== null && (
              <span>Projected by payday <b className={cn('tnum', fv.projectedSpend > fv.poolTotal ? 'text-rose-600' : 'text-emerald-700')}>{fmt(fv.projectedSpend)}</b> of {fmt(fv.poolTotal)}</span>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-2 text-xs font-medium text-slate-600">By category</div>
            {cats.length === 0 ? <Empty>No spending yet this cycle.</Empty> : (
              <>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                  {cats.map((x) => <div key={x.category} className={CAT_COLOUR[x.category]} style={{ width: `${(x.amount / total) * 100}%` }} />)}
                </div>
                <ul className="mt-2 space-y-1 text-xs">
                  {cats.map((x) => (
                    <li key={x.category} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', CAT_COLOUR[x.category])} />{x.category}</span>
                      <span className="tnum text-slate-600">{fmt(x.amount)} · {Math.round((x.amount / total) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-slate-600">Spend by weekday</div>
            <div className="flex h-14 items-end gap-1.5">
              {wk.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-sm bg-slate-800" style={{ height: `${(v / maxWk) * 100}%`, minHeight: v > 0 ? 3 : 0 }} title={fmt(v)} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5 text-center text-[10px] text-slate-400">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="flex-1">{d}</span>)}</div>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ---------- expense log ----------

function ExpenseLog() {
  const { fv, update, toast } = useApp()
  const [filter, setFilter] = useState<'All' | ExpenseCategory>('All')
  const list = [...fv.cycleExpenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .filter((e) => filter === 'All' || e.category === filter)
  const cats: Array<'All' | ExpenseCategory> = ['All', 'Groceries', 'Outside Food', 'Movies/Dates', 'Rides', 'Personal', 'Emergency']
  return (
    <Card title="Expense log" subtitle={`${list.length} entries this cycle`}
      action={<ConfirmButton label="Clear this cycle" confirmLabel="Yes, clear all" disabled={fv.cycleExpenses.length === 0 && fv.topups === 0} onConfirm={() => { update(clearCycleExpenses(fv.cycle.start, fv.cycle.end)); toast("This cycle's expenses cleared", "info") }} />}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {cats.map((c) => <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>{c}</Chip>)}
      </div>
      {list.length === 0 ? <Empty>Nothing logged yet. Tap “Log expense” — it takes one tap.</Empty> : (
        <ul className="divide-y divide-[#F1F5F9]">
          {list.map((e) => (
            <li key={e.id} className="group flex items-center gap-3 py-2">
              <span className={cn('h-8 w-1 shrink-0 rounded-full', CAT_COLOUR[e.category])} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.title}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{fmtDate(e.date)}</span><span>·</span><span>{e.category}</span>
                  {e.fundedBy === 'savings' && <Badge tone="warn">from savings</Badge>}
                  {e.source === 'grocery-checkout' && <Badge>grocery run</Badge>}
                </div>
              </div>
              <span className="tnum text-sm font-semibold">{fmt(e.amount)}</span>
              <button aria-label="Delete expense" onClick={() => { update(deleteExpense(e.id)); toast('Expense removed', 'info') }}
                className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600 lg:opacity-0 lg:group-hover:opacity-100"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
