import { useState } from 'react'
import { Rocket } from 'lucide-react'
import { Btn, Card, Field, inputCls } from './ui'
import { useApp } from '../lib/store'
import { addExpense, logDebtPayment, setPaid } from '../lib/actions'
import { fmtDate } from '../lib/date'
import { fmt } from '../lib/util'

/** First-run catch-up so a mid-cycle start doesn't show a full pool and phantom overdue bills. */
export function Onboarding() {
  const { state, fv, update, toast } = useApp()
  const k = fv.cycle.key
  const [spentG, setSpentG] = useState('')
  const [spentL, setSpentL] = useState('')
  const [rent, setRent] = useState(false)
  const [fixed, setFixed] = useState(false)
  const [debt, setDebt] = useState('')

  // Only needed when salary is entered for a cycle that was already under way when the app was first used.
  if (state.settings.onboarded || fv.pending || fv.cycle.start >= state.startedOn) return null

  const finish = (apply: boolean) => {
    update((s) => {
      let n = s
      if (apply) {
        const g = Math.round(Number(spentG) || 0)
        const l = Math.round(Number(spentL) || 0)
        if (g > 0) n = addExpense({ amount: g, title: 'Groceries before using Life OS', category: 'Groceries', date: fv.cycle.start })(n)
        if (l > 0) n = addExpense({ amount: l, title: 'Lifestyle spend before using Life OS', category: 'Personal', date: fv.cycle.start })(n)
        if (rent) n = setPaid(`${k}:rent`, true)(n)
        if (fixed) n = setPaid(`${k}:fixed`, true)(n)
        const d = Math.round(Number(debt) || 0)
        if (d > 0) n = logDebtPayment(d, fv.cycle.start, 'Paid before using Life OS')(n)
      }
      return { ...n, settings: { ...n.settings, onboarded: true } }
    })
    toast(apply ? 'Setup saved — your pool now reflects this cycle so far' : 'Skipped — you can back-date expenses anytime', 'ok')
  }

  return (
    <Card title="Quick setup · 20 seconds" icon={<Rocket size={14} />} subtitle={`This pay cycle started ${fmtDate(fv.cycle.start)} (${fv.cycle.elapsed} days ago). Tell the app what already happened so the numbers are real.`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={`Spent on groceries so far (₹)`} hint={`of ${fmt(fv.alloc.buckets.groceries)}`}>
          <input className={inputCls} type="number" inputMode="numeric" min={0} value={spentG} onChange={(e) => setSpentG(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Spent on outside food, movies, dates, rides, personal (₹)" hint={`of ${fmt(fv.alloc.buckets.lifestyle)}`}>
          <input className={inputCls} type="number" inputMode="numeric" min={0} value={spentL} onChange={(e) => setSpentL(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Already paid toward the debt this cycle (₹)">
          <input className={inputCls} type="number" inputMode="numeric" min={0} value={debt} onChange={(e) => setDebt(e.target.value)} placeholder="0" />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={rent} onChange={(e) => setRent(e.target.checked)} /> PG rent already paid</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> Recharge / gym / bills already paid</label>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Btn variant="primary" onClick={() => finish(true)}>Save & start</Btn>
        <Btn variant="ghost" onClick={() => finish(false)}>Skip</Btn>
      </div>
    </Card>
  )
}
