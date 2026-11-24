import type { AppState, DayKey, DayLog, Exercise, ISODate } from '../types'
import { dayKeyOf } from './date'
import { MINIMUM_DAY_MOBILITY, SUNDAY_REVIEW } from './defaults'
import { sum } from './util'

export const emptyDayLog = (): DayLog => ({
  water: [], extraSteps: 0, habits: {}, minimumDay: false, mobility: {},
})

export const getDayLog = (s: AppState, date: ISODate): DayLog => s.dayLogs[date] ?? emptyDayLog()

export const splitKeyFor = (s: AppState, date: ISODate): DayKey =>
  getDayLog(s, date).splitOverride ?? dayKeyOf(date)

export interface DayStats {
  waterMl: number
  waterTarget: number
  steps: number
  stepTarget: number
  stepCredit: number
  minimum: boolean
  proteinG: number
  mealsLogged: number
}

export function dayStats(s: AppState, date: ISODate): DayStats {
  const log = getDayLog(s, date)
  const credit = sum(s.habits.filter((h) => h.stepCredit && log.habits[h.id]).map((h) => h.stepCredit ?? 0))
  const meals = s.meals.filter((m) => m.date === date)
  return {
    waterMl: sum(log.water.map((w) => w.ml)),
    waterTarget: log.minimumDay ? s.targets.minWaterMl : s.targets.waterMl,
    steps: credit + log.extraSteps,
    stepTarget: log.minimumDay ? s.targets.minSteps : s.targets.steps,
    stepCredit: credit,
    minimum: log.minimumDay,
    proteinG: sum(meals.map((m) => m.protein)),
    mealsLogged: meals.length,
  }
}

export interface GymProgress {
  kind: 'lift' | 'recovery' | 'minimum'
  done: number
  total: number
  pct: number
  exercises: Exercise[]
}

export function gymProgress(s: AppState, date: ISODate): GymProgress {
  const log = getDayLog(s, date)
  if (log.minimumDay) {
    const done = MINIMUM_DAY_MOBILITY.filter((m) => log.mobility[m.id]).length
    return { kind: 'minimum', done, total: MINIMUM_DAY_MOBILITY.length, pct: done / MINIMUM_DAY_MOBILITY.length, exercises: [] }
  }
  const key = splitKeyFor(s, date)
  if (key === 'sun') {
    const done = SUNDAY_REVIEW.filter((m) => log.mobility[m.id]).length
    return { kind: 'recovery', done, total: SUNDAY_REVIEW.length, pct: done / SUNDAY_REVIEW.length, exercises: [] }
  }
  const exercises = s.gymPlan[key] ?? []
  const day = s.workouts[date] ?? {}
  let done = 0
  let total = 0
  for (const e of exercises) {
    total += e.sets
    const sets = day[e.id] ?? []
    done += sets.slice(0, e.sets).filter((x) => x.done).length
  }
  return { kind: 'lift', done, total, pct: total === 0 ? 0 : done / total, exercises }
}

/** Did this day "count" for the consistency streak? A minimum-viable day counts too. */
export function dayCounts(s: AppState, date: ISODate): boolean {
  const log = getDayLog(s, date)
  const g = gymProgress(s, date)
  const st = dayStats(s, date)
  if (log.minimumDay) return st.waterMl >= s.targets.minWaterMl * 0.75 || !!log.habits.walk || g.pct >= 0.66
  return !!log.habits.walk || g.pct >= 0.6
}
