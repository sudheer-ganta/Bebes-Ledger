import type { AppState, ISODate } from '../types'
import { addDays, diffDays, toISO } from './date'
import { dayCounts, dayStats, getDayLog, gymProgress } from './day'
import { cycleAllocation, getCycle } from './finance'
import { sum } from './util'

export const PILLARS = [
  { id: 'move', label: 'Move', hint: 'Gym ≥ 60%, or the gym walk, or a finished minimum-day reset' },
  { id: 'water', label: 'Water', hint: '≥ 90% of the water target' },
  { id: 'steps', label: 'Steps', hint: '≥ 90% of the step target' },
  { id: 'spend', label: 'Spend', hint: 'Within the daily pocket allowance, and you logged (or ticked "log every expense")' },
  { id: 'food', label: 'Fuel', hint: '3+ meals logged, or ≥ 80% of the protein target' },
] as const

export type PillarId = (typeof PILLARS)[number]['id']

export interface DayMetrics {
  date: ISODate
  hasData: boolean
  pillars: Record<PillarId, boolean>
  score: number // 0..5
  counts: boolean // counts toward the streak (gym walk / gym ≥60% / minimum day done)
  minimum: boolean
  gymPct: number
  waterMl: number
  waterTarget: number
  steps: number
  stepTarget: number
  spent: number
  allowance: number
  habitsDone: number
  habitsTotal: number
  meals: number
  protein: number
  journal: boolean
}

export function dayMetrics(s: AppState, date: ISODate): DayMetrics {
  const log = getDayLog(s, date)
  const st = dayStats(s, date)
  const gym = gymProgress(s, date)
  const expenses = s.expenses.filter((e) => e.date === date)
  const spent = sum(
    expenses.filter((e) => e.fundedBy === 'pool' && e.source !== 'grocery-checkout' && e.category !== 'Emergency').map((e) => e.amount),
  )
  const cyc = getCycle(date, s.finance.paydayDay)
  const allowance = cycleAllocation(s, cyc, s.salaries[cyc.key]?.amount).pocket / cyc.totalDays
  const habitsDone = s.habits.filter((h) => log.habits[h.id]).length
  const workedOut = Object.values(s.workouts[date] ?? {}).some((sets) => sets.some((x) => x.done))

  const hasData =
    log.water.length > 0 || log.extraSteps > 0 || habitsDone > 0 || log.minimumDay || st.mealsLogged > 0 ||
    expenses.length > 0 || workedOut || !!s.journal[date] || Object.values(log.mobility).some(Boolean)

  const pillars: Record<PillarId, boolean> = {
    move: gym.pct >= (log.minimumDay ? 0.66 : 0.6) || !!log.habits.walk,
    water: st.waterMl >= st.waterTarget * 0.9,
    steps: st.steps >= st.stepTarget * 0.9,
    spend: spent <= allowance && (expenses.length > 0 || !!log.habits.log),
    food: st.mealsLogged >= 3 || st.proteinG >= s.targets.proteinG * 0.8,
  }
  const score = Object.values(pillars).filter(Boolean).length

  return {
    date, hasData, pillars, score, counts: dayCounts(s, date), minimum: log.minimumDay, gymPct: gym.pct,
    waterMl: st.waterMl, waterTarget: st.waterTarget, steps: st.steps, stepTarget: st.stepTarget, spent, allowance,
    habitsDone, habitsTotal: s.habits.length, meals: st.mealsLogged, protein: st.proteinG, journal: !!s.journal[date],
  }
}

/** First day anything was recorded (or the day the app was first used). */
export function firstDay(s: AppState): ISODate {
  const all: ISODate[] = [
    s.startedOn, ...s.expenses.map((e) => e.date), ...s.meals.map((m) => m.date), ...Object.keys(s.dayLogs),
    ...Object.keys(s.workouts), ...Object.keys(s.journal),
  ]
  return all.reduce((a, b) => (b < a ? b : a), toISO(new Date()))
}

export interface StreakInfo {
  current: number
  best: number
  activeDays: number
  trackedDays: number
}

export function streaks(s: AppState, today: ISODate): StreakInfo {
  const start = firstDay(s)
  const span = Math.min(diffDays(today, start), 730)
  let best = 0
  let run = 0
  let active = 0
  for (let i = span; i >= 0; i--) {
    const d = addDays(today, -i)
    const counted = dayCounts(s, d)
    if (counted) {
      run++
      active++
      best = Math.max(best, run)
    } else if (d !== today) {
      run = 0 // today is still in progress, so it can't break the run
    }
  }
  // current streak: walk back from today (skipping today if it hasn't counted yet)
  let current = 0
  let d = today
  if (!dayCounts(s, d)) d = addDays(d, -1)
  while (diffDays(today, d) <= span && dayCounts(s, d)) {
    current++
    d = addDays(d, -1)
  }
  return { current, best, activeDays: active, trackedDays: span + 1 }
}

export const SCORE_CLASS = [
  'bg-slate-100', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-500', 'bg-emerald-600',
]
