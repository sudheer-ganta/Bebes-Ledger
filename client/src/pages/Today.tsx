import { useMemo, useState } from 'react'
import { ArrowRight, Dumbbell, Plus, ShieldCheck, Utensils, Zap } from 'lucide-react'
import { Badge, Btn, Card, Chip, Progress, type Tone } from '../components/ui'
import { AlertList, CrisisRadar } from '../components/Alerts'
import { MoneyStrip } from '../components/MoneyStrip'
import { Onboarding } from '../components/Onboarding'
import { WaitingForSalary } from '../components/Salary'
import { QuickAddTask, TaskRow } from '../components/tasks'
import { HabitList, MealSheet, StepTracker, WaterTracker, slotForNow } from '../components/widgets'
import { useApp } from '../lib/store'
import { addExpense, setMinimumDay } from '../lib/actions'
import { buildAlerts, deriveAutoTasks, detectCrisis, allTasks } from '../lib/smart'
import { dayStats, getDayLog, gymProgress, splitKeyFor } from '../lib/day'
import { DAY_FOCUS, GROCERY_WEEKS, MEAL_SLOTS } from '../lib/defaults'
import { currentWeekIndex } from '../lib/groceries'
import { poolRatio } from '../lib/finance'
import { navigate } from '../lib/route'
import { fmtLong } from '../lib/date'
import { cn, fmt, pct } from '../lib/util'
import type { MealSlot, Priority } from '../types'

const prioRank: Record<Priority, number> = { high: 0, routine: 1, low: 2 }

export function Today() {
  const { state, fv, today, now, update, toast, openExpense } = useApp()
  const [mealOpen, setMealOpen] = useState(false)
  const [mealSlot, setMealSlot] = useState<MealSlot | undefined>()

  const alerts = useMemo(() => buildAlerts(state, fv), [state, fv])
  const signals = detectCrisis(state, fv, now)
  const auto = deriveAutoTasks(state, fv, now)
  const log = getDayLog(state, today)
  const minimum = log.minimumDay
  const open = allTasks(state, auto)
    .filter((t) => !t.done)
    .sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || (a.due ?? '9').localeCompare(b.due ?? '9'))
  const shown = (minimum ? open.filter((t) => t.priority === 'high').concat(open.filter((t) => t.priority !== 'high')).slice(0, 3) : open.slice(0, 6))
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const over = fv.todayLeft < 0
  const spendPct = pct(fv.todaySpend, fv.dailyLimit)
  const tone: Tone = over ? 'danger' : spendPct > 75 ? 'warn' : 'ok'
  const poolTone: Tone = poolRatio(fv) < 0.2 ? 'danger' : poolRatio(fv) < 0.4 ? 'warn' : 'ok'

  const quick = (title: string, amount: number, category: Parameters<typeof addExpense>[0]['category']) => {
    update(addExpense({ amount, title, category, date: today }))
    toast(`${fmt(amount)} · ${title} logged`, 'ok')
  }

  const st = dayStats(state, today)
  const gym = gymProgress(state, today)
  const key = splitKeyFor(state, today)
  const week = GROCERY_WEEKS[currentWeekIndex(state, today)]
  const meals = state.meals.filter((m) => m.date === today)
  const nextSlot = slotForNow(hour)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{greeting}, {state.profile.name}</h1>
          <p className="text-sm text-slate-500">{fmtLong(today)} · {fv.pending ? (fv.waitingFirst ? `salary due in ${fv.cycle.daysToPayday} day${fv.cycle.daysToPayday === 1 ? '' : 's'}` : 'enter your salary to start the month') : `payday in ${fv.cycle.daysToPayday} day${fv.cycle.daysToPayday === 1 ? '' : 's'}`}</p>
        </div>
        <div className="flex gap-2">
          <Btn variant={minimum ? 'soft' : 'outline'} size="sm" onClick={() => update(setMinimumDay(today, !minimum))}>
            <ShieldCheck size={14} /> {minimum ? 'Minimum Day ON' : 'Rough day?'}
          </Btn>
        </div>
      </div>

      <MoneyStrip />
      <Onboarding />
      <CrisisRadar signals={signals} />
      <AlertList alerts={alerts} />

      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {/* ---------- column 1 ---------- */}
        <div className="flex flex-col gap-4">
          <div className={fv.pending ? 'order-1' : 'order-2'}>
          {fv.pending ? <WaitingForSalary /> : (
          <Card title="Today's spending" subtitle={`Daily safe limit ${fmt(fv.dailyLimit)} · ${fv.cycle.daysLeft} days left in cycle`}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-500">{over ? "Over today's limit by" : 'Spent today'}</span>
              <span className="tnum font-semibold">{over ? fmt(-fv.todayLeft) : fmt(fv.todaySpend)} <span className="font-normal text-slate-400">{over ? '' : `of ${fmt(fv.dailyLimit)}`}</span></span>
            </div>
            <Progress value={spendPct} tone={tone} className="mt-2" />

            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-slate-600">₹{fv.poolTotal.toLocaleString('en-IN')} pocket pool</span>
                <span className="tnum font-semibold text-slate-900">{fmt(fv.remaining)} left</span>
              </div>
              <Progress value={pct(fv.remaining, fv.poolTotal)} tone={poolTone} h="h-1.5" className="mt-1.5" />
              <div className="mt-3 space-y-2">
                {([
                  ['Groceries', fv.groceries.left, fv.groceries.budget, 'ok'],
                  ['Lifestyle Flex', fv.lifestyle.left, fv.alloc.buckets.lifestyle, fv.lifestyle.left / Math.max(1, fv.alloc.buckets.lifestyle) < 0.25 ? 'danger' : 'ok'],
                  ['Pool buffer', fv.buffer.left, fv.buffer.target, fv.buffer.used > 0 ? 'warn' : 'ok'],
                ] as Array<[string, number, number, Tone]>).map(([label, left, budget, t]) => (
                  <div key={label}>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{label}</span>
                      <span className="tnum">{fmt(Math.max(0, left))} / {fmt(budget)}</span>
                    </div>
                    <Progress value={pct(Math.max(0, left), budget)} tone={t} h="h-1" className="mt-1" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">1-tap log</div>
              <div className="flex flex-wrap gap-1.5">
                {state.settings.quickPresets.slice(0, 5).map((p) => (
                  <Chip key={p.id} onClick={() => quick(p.title, p.amount, p.category)}>{p.title} ₹{p.amount}</Chip>
                ))}
              </div>
              <Btn variant="primary" className="mt-3 w-full" onClick={() => openExpense()}><Plus size={15} /> Log expense</Btn>
            </div>
          </Card>
          )}
          </div>

          <Card
            className={fv.pending ? 'order-2' : 'order-1'}
            title={minimum ? 'Top 3 only (Minimum Day)' : 'Priority To-Dos'}
            icon={<Zap size={14} />}
            action={<button onClick={() => navigate('todo')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">All <ArrowRight size={12} /></button>}
          >
            {shown.length === 0 ? (
              <p className="py-3 text-center text-sm text-slate-500">All clear. Nothing urgent right now.</p>
            ) : (
              <ul className="-mx-1.5 mb-3">{shown.map((t) => <TaskRow key={t.id} task={t} compact />)}</ul>
            )}
            <QuickAddTask />
          </Card>
        </div>

        {/* ---------- column 2 ---------- */}
        <div className="space-y-4">
          <Card title={`Hydration · ${(st.waterTarget / 1000).toFixed(2).replace(/0$/, '')} L target`}>
            <WaterTracker compact />
          </Card>
          <Card title={`Steps · ${st.stepTarget.toLocaleString('en-IN')} target`}>
            <StepTracker compact />
          </Card>
          <Card
            title="Today's gym focus" icon={<Dumbbell size={14} />}
            action={<Badge tone={minimum ? 'info' : gym.pct >= 1 ? 'ok' : 'neutral'}>{Math.round(gym.pct * 100)}%</Badge>}
          >
            <div className="text-base font-semibold">{minimum ? 'Minimum Day: 15-min mobility reset' : DAY_FOCUS[key]}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {gym.kind === 'lift'
                ? `${gym.done}/${gym.total} sets done · ${gym.exercises.map((e) => e.name).slice(0, 3).join(', ')}…`
                : gym.kind === 'minimum' ? `${gym.done}/${gym.total} moves done — your streak is safe`
                : `${gym.done}/${gym.total} review items done`}
            </div>
            <Progress value={gym.pct * 100} tone="ok" className="mt-3" />
            <Btn variant="outline" className="mt-3 w-full" onClick={() => navigate('body')}>Open workout <ArrowRight size={14} /></Btn>
          </Card>
        </div>

        {/* ---------- column 3 ---------- */}
        <div className="grid items-start gap-4 lg:col-span-2 lg:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
          <Card title="Daily habits"><HabitList /></Card>
          <Card
            title="Today's meals" icon={<Utensils size={14} />}
            subtitle={`${week.title} focus: ${week.focus}`}
            action={<Badge tone={st.proteinG >= state.targets.proteinG ? 'ok' : 'neutral'}>{st.proteinG}/{state.targets.proteinG} g protein</Badge>}
          >
            <ul className="divide-y divide-[#F1F5F9]">
              {MEAL_SLOTS.map((slot) => {
                const m = meals.filter((x) => x.slot === slot)
                return (
                  <li key={slot} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className={cn('text-xs font-medium', slot === nextSlot && m.length === 0 ? 'text-slate-900' : 'text-slate-500')}>{slot}</div>
                      {m.length > 0 ? (
                        <div className="truncate text-sm">{m.map((x) => x.title).join(' + ')}</div>
                      ) : (
                        <div className="text-xs text-slate-400">{slot === nextSlot ? 'Up next' : 'Not logged'}</div>
                      )}
                    </div>
                    {m.length === 0 && (
                      <Btn size="sm" variant="ghost" onClick={() => { setMealSlot(slot); setMealOpen(true) }}><Plus size={13} /> Log</Btn>
                    )}
                  </li>
                )
              })}
            </ul>
            <Btn variant="outline" className="mt-2 w-full" onClick={() => navigate('food')}>Groceries & meal plan <ArrowRight size={14} /></Btn>
          </Card>
        </div>
      </div>

      <MealSheet open={mealOpen} onClose={() => setMealOpen(false)} prefill={{ slot: mealSlot }} />
    </div>
  )
}
