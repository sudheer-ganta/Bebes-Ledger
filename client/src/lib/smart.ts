import type { Alert, AppState, ISODate, Task } from '../types'
import { dayStats, getDayLog, gymProgress } from './day'
import { addDays, diffDays, fmtDate, isSunday, toISO } from './date'
import { dueDateInCycle, poolRatio, previewCurrentWeekSweep, type FinanceView } from './finance'
import { itemPrice, outOfStockItems } from './groceries'
import { fmt, num } from './util'

// ---------- live alerts for the ₹5,000 pool ----------

export function buildAlerts(_s: AppState, fv: FinanceView): Alert[] {
  const out: Alert[] = []
  if (fv.pending) return out // no salary allocated yet: no pool, so nothing to warn about
  const bufferTarget = fv.buffer.target

  if (fv.todaySpend > fv.dailyLimit && fv.todaySpend > 0) {
    const tail =
      fv.tomorrowCap > 0
        ? `keep tomorrow under ${fmt(fv.tomorrowCap)} to protect your ${fmt(bufferTarget)} pool savings`
        : `your pool buffer is already in use — cook at home until payday`
    out.push({
      id: 'overspend',
      level: 'danger',
      message: `You spent ${fmt(fv.todaySpend)} today vs ${fmt(fv.dailyLimit)} safe limit — ${tail}`,
    })
  }

  const lifeBudget = Math.max(1, fv.alloc.buckets.lifestyle)
  if (fv.lifestyle.left <= 0) {
    out.push({
      id: 'lifestyle-empty',
      level: 'danger',
      message: `Lifestyle Flex is empty — anything more on movies, dates, rides or outside food now eats your pool buffer. Cook in your pan instead.`,
    })
  } else if (fv.lifestyle.left / lifeBudget < 0.25) {
    out.push({
      id: 'lifestyle-low',
      level: 'warn',
      message: `Only ${fmt(fv.lifestyle.left)} left for movies/dates/rides this month — cook in your pan instead of ordering out`,
    })
  }

  if (fv.groceries.left < 0) {
    out.push({
      id: 'groceries-over',
      level: 'warn',
      message: `Groceries are ${fmt(-fv.groceries.left)} over the ${fmt(fv.groceries.budget)} bucket — the overflow is coming out of your pool buffer.`,
    })
  }

  if (fv.buffer.left < 0) {
    out.push({
      id: 'pool-overdrawn',
      level: 'danger',
      message: `The pocket pool is overdrawn by ${fmt(-fv.buffer.left)} — this is now eating into savings. Open SOS for a recovery plan.`,
      action: { label: 'Open SOS', to: 'crisis' },
    })
  } else if (fv.buffer.used > 0) {
    out.push({
      id: 'buffer-used',
      level: 'warn',
      message: `${fmt(fv.buffer.used)} of your ${fmt(bufferTarget)} pool buffer is already used — ${fmt(fv.buffer.left)} still protected.`,
    })
  }

  if (fv.projectedSpend !== null && fv.projectedSpend > fv.poolTotal + 1) {
    out.push({
      id: 'pace',
      level: 'warn',
      message: `At this pace you'll spend about ${fmt(fv.projectedSpend)} by payday — ${fmt(fv.projectedSpend - fv.poolTotal)} over the pool.`,
    })
  }

  if (fv.cycle.daysToPayday <= 3) {
    out.push({
      id: 'payday',
      level: 'info',
      message: `Salary lands in ${fv.cycle.daysToPayday} day${fv.cycle.daysToPayday === 1 ? '' : 's'} (${fmtDate(fv.cycle.nextPayday)}) — ${fmt(Math.max(0, fv.remaining))} of the pool is left.`,
    })
  }

  return out
}

// ---------- smart auto-generated tasks ----------

const T = (
  id: string, title: string, category: Task['category'], priority: Task['priority'], due: ISODate | undefined,
  note?: string,
): Task => ({
  id, title, category, priority, due, done: false, createdAt: '', carried: 0, note, auto: true,
})

export function deriveAutoTasks(s: AppState, fv: FinanceView, now: Date): Task[] {
  const out: Task[] = []
  const today = fv.today
  const c = fv.cycle
  const hour = now.getHours()

  // 1) grocery items flagged "Out of Stock" → restock errand
  const oos = outOfStockItems(s)
  if (oos.length > 0) {
    const total = oos.reduce((a, i) => a + itemPrice(s, i), 0)
    const names = oos.map((i) => i.name.replace(/\s*\(.*\)/, '')).join(' & ')
    out.push(T('auto:restock', `Buy ${names}${total > 0 ? ` (~${fmt(total)})` : ''}`, 'errands', 'high', today,
      'Auto-created from Groceries → Out of Stock'))
  }

  // 0) waiting for salary: the only finance task is to enter it
  const live = !fv.pending
  if (fv.pending && (!fv.waitingFirst || c.daysToPayday <= 2)) {
    const due = fv.waitingFirst ? c.nextPayday : c.start
    out.push(T(`auto:salary:${due}`,
      fv.waitingFirst ? `Salary due ${fmtDate(due)} — enter it to allocate your month` : 'Salary day: enter what you received and allocate the month',
      'finance', 'high', due, 'Wallet → Salary'))
  }

  // 2) rent / debt / fixed bills when the due date approaches
  const near = (due: ISODate) => diffDays(due, today) <= 5
  const rentDue = dueDateInCycle(c, s.finance.rentDueDay)
  if (live && !s.paid[`${c.key}:rent`] && near(rentDue)) {
    out.push(T(`auto:rent:${c.key}`, `Pay PG rent ${fmt(s.finance.rent)}`, 'finance', 'high', rentDue,
      `Due ${fmtDate(rentDue)}`))
  }
  const debtDue = dueDateInCycle(c, s.finance.debtDueDay)
  if (live && !fv.debt.cleared && fv.debt.installmentLeft > 0 && near(debtDue)) {
    out.push(T(`auto:debt:${c.key}`,
      `Transfer ${fmt(fv.debt.installmentLeft)} toward ${fmt(fv.debt.remaining)} debt payoff`, 'finance', 'high',
      debtDue, `Due ${fmtDate(debtDue)} · ${fv.debt.monthsLeft} month(s) to clear`))
  }
  const fixedDue = dueDateInCycle(c, s.finance.fixedDueDay)
  if (live && !s.paid[`${c.key}:fixed`] && near(fixedDue)) {
    out.push(T(`auto:fixed:${c.key}`, `Pay recharge, gym & bills ${fmt(s.finance.fixed)}`, 'finance', 'routine',
      fixedDue, `Due ${fmtDate(fixedDue)}`))
  }

  // 3) payday: pay yourself first
  if (live && !s.paid[`${c.key}:savings`] && diffDays(today, c.start) <= 2 && fv.savings.floorNow > 0) {
    out.push(T(`auto:payday:${c.key}`, `Salary day: move ${fmt(fv.savings.floorNow)} to savings before you spend`,
      'finance', 'high', c.start, 'Protected savings floor'))
  }

  // 4) Sunday weekly review
  if (live && isSunday(today)) {
    const sw = previewCurrentWeekSweep(s, today)
    out.push(T(`auto:sunday:${today}`,
      `Sunday review: sweep ${fmt(sw?.amount ?? 0)} to savings, check kitchen stock, plan next week's list`,
      'finance', 'routine', today))
  }

  // 5) evening nudge when steps / water are behind
  if (hour >= 18) {
    const st = dayStats(s, today)
    const remSteps = Math.max(0, st.stepTarget - st.steps)
    const remWater = Math.max(0, st.waterTarget - st.waterMl)
    if (remSteps > 0 || remWater > 0) {
      const bits = [
        remSteps > 0 ? `${num(Math.ceil(remSteps / 100) * 100)} steps` : '',
        remWater > 0 ? `${num(Math.ceil(remWater / 50) * 50)}ml water` : '',
      ].filter(Boolean)
      out.push(T(`auto:nudge:${today}`, `Complete remaining ${bits.join(' + ')} before 10 PM`, 'today', 'routine',
        today, 'Gentle evening nudge'))
    }
  }

  return out.filter((t) => !s.dismissedAuto[t.id])
}

export function allTasks(s: AppState, auto: Task[]): Task[] {
  return [...auto, ...s.tasks]
}

export const isOverdue = (t: Task, today: ISODate) => !t.done && !!t.due && t.due < today

// ---------- crisis radar ----------

export interface CrisisSignal {
  type: 'money' | 'food' | 'bad-day'
  level: 'warn' | 'danger' | 'info'
  title: string
  message: string
}

export function detectCrisis(s: AppState, fv: FinanceView, now: Date): CrisisSignal[] {
  const out: CrisisSignal[] = []
  const hour = now.getHours()
  const today = fv.today

  if (fv.pending) {
    // no pool yet — money crises don't apply until the salary is allocated
  } else if (s.survival.active) {
    out.push({ type: 'money', level: 'info', title: 'Survival budget is ON',
      message: `Only essentials until payday (${fv.cycle.daysToPayday} days).` })
  } else if (fv.remaining <= 0) {
    out.push({ type: 'money', level: 'danger', title: 'The pocket pool is empty',
      message: `${fv.cycle.daysToPayday} days to payday with ${fmt(Math.max(0, fv.remaining))} left.` })
  } else if (fv.dailyLimit < 80 || poolRatio(fv) < 0.2) {
    out.push({ type: 'money', level: 'warn', title: 'Money is running low',
      message: `${fmt(fv.remaining)} for ${fv.cycle.daysLeft} days = ${fmt(fv.dailyLimit)}/day.` })
  }

  const oos = outOfStockItems(s).length
  const st = dayStats(s, today)
  if (oos >= 3) {
    out.push({ type: 'food', level: 'warn', title: 'Kitchen is running empty',
      message: `${oos} items are out of stock — get the cheap-protein plan.` })
  } else if (hour >= 14 && st.mealsLogged === 0) {
    out.push({ type: 'food', level: 'warn', title: 'No meal logged yet today',
      message: 'Skipping meals tanks a muscle-gain day. Grab a cheap protein meal.' })
  }

  const log = getDayLog(s, today)
  const g = gymProgress(s, today)
  if (log.minimumDay) {
    out.push({ type: 'bad-day', level: 'info', title: 'Minimum Viable Day is ON',
      message: 'Targets are lowered. Your streak is protected.' })
  } else if (hour >= 17 && g.pct === 0 && st.steps < st.stepTarget * 0.4) {
    out.push({ type: 'bad-day', level: 'warn', title: 'Rough day?',
      message: 'Nothing moved yet. Switch to a Minimum Viable Day and keep the streak.' })
  }

  return out
}

export const tomorrowISO = (today: ISODate) => addDays(today, 1)
export const todayISO = () => toISO(new Date())
