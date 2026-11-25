import { useMemo, useState } from 'react'
import { AlertTriangle, Hourglass, Landmark, PartyPopper } from 'lucide-react'
import { Btn, Card, Field, inputCls, Sheet } from './ui'
import { useApp } from '../lib/store'
import { clearSalary, receiveSalary } from '../lib/actions'
import { cycleAllocation, type Allocation } from '../lib/finance'
import { fmtDate, fmtLong } from '../lib/date'
import { cn, fmt } from '../lib/util'

/** Where the money goes, in the order it is paid. Fixed items first; the pocket pool is what's left. */
export function AllocationTable({ a, muted, debtLabel }: { a: Allocation; muted?: boolean; debtLabel?: string }) {
  const { fv } = useApp()
  const perDay = a.pocket / fv.cycle.totalDays
  const rows: Array<{ label: string; v: number; note?: string }> = [
    { label: 'PG rent', v: a.rent },
    { label: 'Recharge, gym & bills', v: a.fixed },
    { label: debtLabel ?? 'Debt installment (fixed)', v: a.debt },
    { label: 'Savings (fixed)', v: a.savings },
  ]
  return (
    <div className={cn('rounded-lg border border-line', muted && 'bg-slate-50/60')}>
      <ul className="divide-y divide-line-soft text-sm">
        <li className="flex justify-between px-3 py-2 font-semibold"><span>Salary</span><span className="tnum">{fmt(a.salary)}</span></li>
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0"><span className="mr-2 text-[11px] text-slate-400">{i + 1}</span>{r.label}</div>
            <span className="tnum shrink-0 text-slate-700">−{fmt(r.v)}</span>
          </li>
        ))}
        <li className="flex items-start justify-between gap-3 bg-emerald-50 px-3 py-2.5 text-emerald-800">
          <div className="min-w-0">
            <div className="font-semibold">Pocket pool — what's left to spend</div>
            <div className="text-[11px]">Groceries {fmt(a.buckets.groceries)} · Lifestyle {fmt(a.buckets.lifestyle)} · Buffer {fmt(a.buckets.buffer)}</div>
            <div className="text-[11px] font-medium">≈ {fmt(perDay)} a day · {fmt(perDay * 7)} a week</div>
          </div>
          <span className="tnum shrink-0 text-base font-semibold">{fmt(a.pocket)}</span>
        </li>
      </ul>
    </div>
  )
}

export function AllocWarnings({ a }: { a: Allocation }) {
  const { fv } = useApp()
  const perDay = a.pocket / fv.cycle.totalDays
  if (a.short <= 0 && a.trimmed <= 0 && perDay >= 100) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        {a.short > 0
          ? `This salary is ${fmt(a.short)} short of rent + bills + the debt installment, so savings and the pocket pool are ₹0. Consider asking to push a bill or the installment.`
          : a.trimmed > 0
            ? `This salary can't cover the full ${fmt(a.savings + a.trimmed)} savings, so savings are cut by ${fmt(a.trimmed)} and the pocket pool is ₹0.`
            : `Only ${fmt(perDay)} a day is left for the pocket pool this month — a tight one. Savings and debt stay fixed, so spending is what has to flex.`}
      </span>
    </div>
  )
}

/** Enter the real salary → see the exact split → confirm. Also used to correct an amount already entered. */
export function SalaryForm({ onDone }: { onDone: () => void }) {
  const { state, fv, update, toast, today } = useApp()
  const existing = fv.received
  const [amount, setAmount] = useState(String(existing?.amount ?? state.finance.salary))
  const [date, setDate] = useState(existing?.receivedOn ?? (today < fv.cycle.start ? fv.cycle.start : today))
  const amt = Math.max(0, Math.round(Number(amount) || 0))
  const preview = useMemo(() => cycleAllocation(state, fv.cycle, amt), [state, fv.cycle, amt])

  const submit = () => {
    if (amt <= 0) return
    update(receiveSalary(fv.cycle.key, amt, date))
    toast(`${fmt(amt)} allocated — ${fmt(preview.pocket)} to spend, ${fmt(preview.savings)} to savings`, 'ok')
    onDone()
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Salary received (₹)" hint={`Expected ${fmt(state.finance.salary)}`}>
          <input autoFocus onFocus={(e) => e.target.select()} className={inputCls} type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Received on">
          <input className={inputCls} type="date" value={date} max={today} min={fv.cycle.start} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">Here's how {amt > 0 ? fmt(amt) : 'it'} will be allocated</div>
        <AllocationTable a={preview} />
      </div>
      <AllocWarnings a={preview} />
      <div className="flex flex-wrap gap-2">
        <Btn type="submit" variant="success" disabled={amt <= 0}><PartyPopper size={15} /> {existing ? 'Update allocation' : 'Allocate & start the month'}</Btn>
        {existing && (
          <Btn type="button" variant="ghost" onClick={() => { update(clearSalary(fv.cycle.key)); toast('Salary removed — back to waiting', 'info'); onDone() }}>
            Remove salary
          </Btn>
        )}
        <Btn type="button" variant="ghost" onClick={onDone}>Cancel</Btn>
      </div>
    </form>
  )
}

export function SalarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Salary & allocation" wide>
      <SalaryForm onDone={onClose} />
    </Sheet>
  )
}

/** Shown instead of the pool until this cycle's salary has been entered. */
export function WaitingForSalary() {
  const { fv, state } = useApp()
  const [open, setOpen] = useState(false)
  const days = fv.cycle.daysToPayday
  const first = fv.waitingFirst
  const showForm = open || !first // on/after payday the form is the main event

  return (
    <Card
      title={first ? 'Waiting for your salary' : 'Salary day — enter what you received'}
      icon={first ? <Hourglass size={14} /> : <Landmark size={14} />}
      subtitle={first
        ? `Nothing is allocated until the money actually lands. Your first month starts ${fmtLong(fv.cycle.nextPayday)}.`
        : `Your cycle started ${fmtDate(fv.cycle.start)}. The pool and the daily limit appear as soon as you allocate it.`}
    >
      {first && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="tnum text-4xl font-semibold tracking-tight">{days}<span className="ml-1 text-lg font-medium text-slate-400">day{days === 1 ? '' : 's'}</span></div>
            <div className="text-xs text-slate-500">until payday on the {state.finance.paydayDay}th · pool ₹0 · daily limit ₹0</div>
          </div>
          {!showForm && <Btn variant="primary" onClick={() => setOpen(true)}><Landmark size={15} /> My salary has arrived</Btn>}
        </div>
      )}

      {showForm ? (
        <SalaryForm onDone={() => setOpen(false)} />
      ) : (
        <>
          <div className="mb-1 text-xs font-medium text-slate-600">The plan for when {fmt(fv.plan.salary)} lands</div>
          <AllocationTable a={fv.plan} muted />
          <p className="mt-3 text-xs text-slate-500">
            Rent, bills, the debt installment and savings are fixed and come out first. Whatever is left is your pocket pool, so a bigger or smaller salary only changes what you can spend. You'll see the exact split before confirming.
          </p>
        </>
      )}
    </Card>
  )
}
