import { useMemo, useState } from 'react'
import { ArrowRight, Landmark, Plus, ShieldCheck } from 'lucide-react'
import { Btn, Card, Progress } from '../components/ui'
import { AlertList, CrisisRadar } from '../components/Alerts'
import { MoneyStrip } from '../components/MoneyStrip'
import { Onboarding } from '../components/Onboarding'
import { SalarySheet } from '../components/Salary'
import { QuickAddTask, TaskRow } from '../components/tasks'
import { MealSheet, StepTracker, WaterTracker } from '../components/widgets'
import { useApp } from '../lib/store'
import { setMinimumDay } from '../lib/actions'
import { buildAlerts, deriveAutoTasks, detectCrisis, allTasks } from '../lib/smart'
import { dayStats, getDayLog } from '../lib/day'
import { navigate } from '../lib/route'
import { fmtDate, fmtLong } from '../lib/date'
import { greeting, moiraName } from '../lib/moira'
import { pct } from '../lib/util'
import type { Priority } from '../types'

const prioRank: Record<Priority, number> = { high: 0, routine: 1, low: 2 }

/**
 * Today, kept simple: money numbers, then water, steps, protein and the top tasks.
 * Spending detail lives on Money, meals on Food, the workout and habits on Body.
 */
export function Today() {
  const { state, fv, today, now, update } = useApp()
  const [mealOpen, setMealOpen] = useState(false)
  const [salaryOpen, setSalaryOpen] = useState(false)

  const alerts = useMemo(() => buildAlerts(state, fv), [state, fv])
  const signals = detectCrisis(state, fv, now)
  const auto = deriveAutoTasks(state, fv, now)
  const minimum = getDayLog(state, today).minimumDay
  const open = allTasks(state, auto)
    .filter((t) => !t.done)
    .sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || (a.due ?? '9').localeCompare(b.due ?? '9'))
  const shown = open.slice(0, minimum ? 3 : 5)

  const st = dayStats(state, today)
  const meals = state.meals.filter((m) => m.date === today)
  const proteinLeft = Math.max(0, state.targets.proteinG - st.proteinG)

  return (
    <div className="rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{fmtLong(today)}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting(now)}, {moiraName(state)}.
          </h1>
        </div>
        <Btn variant={minimum ? 'soft' : 'outline'} size="sm" onClick={() => update(setMinimumDay(today, !minimum))}>
          <ShieldCheck size={14} /> {minimum ? 'Minimum day on' : 'Rough day?'}
        </Btn>
      </header>

      <MoneyStrip />

      {fv.pending && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-white">
          <div>
            <div className="font-medium">{fv.waitingFirst ? `No salary until ${fmtDate(fv.cycle.nextPayday)}` : 'Salary day'}</div>
            <div className="text-sm text-slate-400">
              {fv.waitingFirst ? `${fv.cycle.daysToPayday} days to go. Spend only what you must.` : 'Enter it to plan the month.'}
            </div>
          </div>
          <Btn variant="outline" size="sm" className="border-white/20 bg-white text-slate-900 hover:bg-slate-100" onClick={() => setSalaryOpen(true)}>
            <Landmark size={14} /> My salary has arrived
          </Btn>
        </div>
      )}

      <Onboarding />
      <CrisisRadar signals={signals} />
      <AlertList alerts={alerts} />

      <div className="grid items-start gap-4 md:grid-cols-3">
        <Card title="Water" subtitle={`${(st.waterTarget / 1000).toFixed(2).replace(/0$/, '')} L today`}>
          <WaterTracker compact />
        </Card>
        <Card title="Steps" subtitle={`${st.stepTarget.toLocaleString('en-IN')} today`}>
          <StepTracker compact />
        </Card>
        <Card title="Protein" subtitle={`${state.targets.proteinG} g today`}>
          <div className="flex items-baseline gap-2">
            <span className="tnum text-3xl font-semibold">{st.proteinG}</span>
            <span className="text-sm text-slate-500">of {state.targets.proteinG} g</span>
          </div>
          <Progress value={pct(st.proteinG, state.targets.proteinG)} className="mt-2" />
          <p className="mt-2 text-xs text-slate-500">
            {meals.length ? `${meals.length} meal${meals.length === 1 ? '' : 's'} logged · ` : 'No meals logged · '}
            {proteinLeft ? `${proteinLeft} g to go` : 'target reached'}
          </p>
          <Btn variant="outline" size="sm" className="mt-3 w-full" onClick={() => setMealOpen(true)}><Plus size={13} /> Log a meal</Btn>
        </Card>
      </div>

      <Card
        title={minimum ? 'Top 3 tasks' : 'Top tasks'}
        action={<button onClick={() => navigate('todo')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">All tasks <ArrowRight size={12} /></button>}
      >
        {shown.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-500">Nothing pending. Enjoy it.</p>
        ) : (
          <ul className="-mx-1.5 mb-3">{shown.map((t) => <TaskRow key={t.id} task={t} compact />)}</ul>
        )}
        <QuickAddTask />
      </Card>

      <MealSheet open={mealOpen} onClose={() => setMealOpen(false)} prefill={{}} />
      <SalarySheet open={salaryOpen} onClose={() => setSalaryOpen(false)} />
    </div>
  )
}
