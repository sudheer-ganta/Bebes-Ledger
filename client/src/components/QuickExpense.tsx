import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Btn, Chip, Field, inputCls, Sheet } from './ui'
import { useApp } from '../lib/store'
import { addExpense } from '../lib/actions'
import { CATEGORIES } from '../lib/defaults'
import { computeFinance, bucketOf } from '../lib/finance'
import { fmt } from '../lib/util'
import type { ExpenseCategory } from '../types'

export function QuickExpense() {
  const { expenseOpen, closeExpense, state, update, today, fv, toast } = useApp()
  const [amount, setAmount] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('Outside Food')
  const [date, setDate] = useState(today)
  const [confirmFrozen, setConfirmFrozen] = useState(false)

  useEffect(() => {
    if (!expenseOpen.open) return
    const p = expenseOpen.preset
    setAmount(p ? String(p.amount) : '')
    setTitle(p?.title ?? '')
    setCategory((p?.category as ExpenseCategory) ?? 'Outside Food')
    setDate(today)
    setConfirmFrozen(false)
  }, [expenseOpen.open, expenseOpen.preset, today])

  const amt = Math.round(Number(amount) || 0)
  const after = useMemo(() => {
    if (amt <= 0 || fv.pending) return null
    const next = addExpense({ amount: amt, title: 'x', category, date })(state)
    return computeFinance(next, today)
  }, [amt, category, date, state, today, fv.pending])

  const bucket = bucketOf(category)
  const frozen = state.survival.active && bucket === 'lifestyle'
  const bucketLabel = { groceries: 'Groceries', lifestyle: 'Lifestyle Flex', buffer: 'Pool buffer' }[bucket]
  const bucketLeftBefore = fv[bucket].left
  const bucketLeftAfter = after ? after[bucket].left : bucketLeftBefore

  const submit = () => {
    if (amt <= 0) return
    if (frozen && !confirmFrozen) {
      setConfirmFrozen(true)
      return
    }
    update(addExpense({ amount: amt, title, category, date }))
    const left = after ? Math.max(0, after.todayLeft) : 0
    toast(fv.pending ? `${fmt(amt)} logged (no pool yet)` : `${fmt(amt)} logged · ${fmt(left)} left to spend today`, after && after.todayLeft < 0 ? 'warn' : 'ok')
    closeExpense()
  }

  return (
    <Sheet open={expenseOpen.open} onClose={closeExpense} title="Log expense">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="space-y-4"
      >
        <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2 focus-within:ring-2 focus-within:ring-slate-200">
          <span className="text-2xl font-semibold text-slate-400">₹</span>
          <input
            autoFocus
            inputMode="numeric"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            aria-label="Amount"
            className="tnum w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-slate-300"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {state.settings.quickPresets.map((p) => (
            <Chip
              key={p.id}
              onClick={() => {
                setAmount(String(p.amount))
                setTitle(p.title)
                setCategory(p.category)
              }}
            >
              {p.title} · ₹{p.amount}
            </Chip>
          ))}
        </div>

        <Field label="What was it?">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dinner with friends" />
        </Field>

        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Category</div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{c}</Chip>
            ))}
          </div>
        </div>

        <Field label="Date">
          <input type="date" className={inputCls} value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </Field>

        {fv.pending && amt > 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            Your salary hasn't been allocated yet, so there's no pool to deduct this from. It's recorded in the log only.
          </div>
        )}

        {after && (
          <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>{bucketLabel} left</span>
              <span className="tnum font-medium text-slate-900">{fmt(bucketLeftBefore)} → {fmt(bucketLeftAfter)}</span>
            </div>
            <div className="flex justify-between">
              <span>Pocket pool left</span>
              <span className="tnum font-medium text-slate-900">{fmt(fv.remaining)} → {fmt(after.remaining)}</span>
            </div>
            <div className="flex justify-between">
              <span>Safe left to spend today</span>
              <span className={`tnum font-medium ${after.todayLeft < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                {fmt(fv.todayLeft)} → {fmt(after.todayLeft)}
              </span>
            </div>
          </div>
        )}

        {frozen && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Survival budget is ON — lifestyle spending is frozen until payday.
              {confirmFrozen && ' Tap again to log it anyway.'}
            </span>
          </div>
        )}

        <Btn type="submit" variant={confirmFrozen ? 'danger' : 'primary'} size="lg" className="w-full" disabled={amt <= 0}>
          <Check size={16} /> {confirmFrozen ? 'Log it anyway' : 'Log expense'}
        </Btn>
      </form>
    </Sheet>
  )
}
