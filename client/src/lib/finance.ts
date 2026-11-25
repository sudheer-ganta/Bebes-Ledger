import type {
  AppState, FinanceConfig, Bucket, Expense, ExpenseCategory, ISODate, Sweep,
} from '../types'
import { addDays, daysInMonth, diffDays, fromISO, toISO, weekStartOf } from './date'
import { sum, uid } from './util'

// ---------- pay cycle (salary lands on the `paydayDay` of every month) ----------

export interface Cycle {
  key: ISODate // first day of the cycle (the payday)
  start: ISODate
  end: ISODate // last day, inclusive
  nextPayday: ISODate
  totalDays: number
  elapsed: number // days passed including today
  daysLeft: number // days remaining including today
  daysToPayday: number
}

function paydayIn(year: number, month0: number, day: number): Date {
  const first = new Date(year, month0, 1) // normalises month overflow
  const y = first.getFullYear()
  const m = first.getMonth()
  return new Date(y, m, Math.min(day, daysInMonth(y, m)))
}

export function getCycle(today: ISODate, paydayDay: number): Cycle {
  const t = fromISO(today)
  let start = paydayIn(t.getFullYear(), t.getMonth(), paydayDay)
  if (start > t) start = paydayIn(t.getFullYear(), t.getMonth() - 1, paydayDay)
  const next = paydayIn(start.getFullYear(), start.getMonth() + 1, paydayDay)
  const startISO = toISO(start)
  const nextISO = toISO(next)
  return {
    key: startISO,
    start: startISO,
    end: addDays(nextISO, -1),
    nextPayday: nextISO,
    totalDays: diffDays(nextISO, startISO),
    elapsed: diffDays(today, startISO) + 1,
    daysLeft: diffDays(nextISO, today),
    daysToPayday: diffDays(nextISO, today),
  }
}

/** The date inside this cycle on which a monthly bill with `dueDay` falls. */
export function dueDateInCycle(cycle: Cycle, dueDay: number): ISODate {
  const s = fromISO(cycle.start)
  let d = paydayIn(s.getFullYear(), s.getMonth(), dueDay)
  if (toISO(d) < cycle.start) d = paydayIn(s.getFullYear(), s.getMonth() + 1, dueDay)
  return toISO(d)
}

// ---------- buckets ----------

export const bucketOf = (c: ExpenseCategory): Bucket =>
  c === 'Groceries' ? 'groceries' : c === 'Emergency' ? 'buffer' : 'lifestyle'

export const BUCKET_LABEL: Record<Bucket, string> = {
  groceries: 'Groceries & Nutrition',
  lifestyle: 'Lifestyle Flex',
  buffer: 'Pool Buffer / Rollover',
}

export interface BucketView {
  budget: number // effective budget (after sweeps / top-ups)
  spent: number
  left: number // may be negative
  over: number // overflow that spills into the buffer
}

// ---------- salary allocation ----------

export interface Allocation {
  salary: number
  rent: number
  fixed: number
  debt: number
  pocket: number
  savings: number
  buckets: { groceries: number; lifestyle: number; buffer: number }
  /** How much the fixed savings amount had to be cut because the salary can't cover it. */
  trimmed: number
  /** How far the salary falls short of rent + bills + debt installment (0 = covered). */
  short: number
}

/**
 * Fixed-commitments-first waterfall: rent → bills → debt installment → savings (a constant) → whatever is left is the pocket pool.
 * Savings and the debt installment never move; a bigger or smaller salary only changes the pocket pool (its three
 * buckets scale proportionally). Only if the salary can't even cover the fixed items does savings get trimmed.
 */
export function allocate(f: FinanceConfig, salary: number, debtDue: number, extraDebt = 0): Allocation {
  let left = Math.max(0, salary)
  const take = (want: number) => {
    const n = Math.max(0, Math.min(want, left))
    left -= n
    return n
  }
  const rent = take(f.rent)
  const fixed = take(f.fixed)
  const debt = take(debtDue)
  const savings = take(f.savings)
  const extra = take(extraDebt) // extra debt payments come out of pocket money, never out of savings
  const pocket = left
  const base = f.buckets.groceries + f.buckets.lifestyle + f.buckets.buffer
  const k = base > 0 ? pocket / base : 0
  const g = Math.round(f.buckets.groceries * k)
  const l = Math.round(f.buckets.lifestyle * k)
  return {
    salary, rent, fixed, debt: debt + extra, savings, pocket,
    buckets: { groceries: g, lifestyle: l, buffer: pocket - g - l },
    trimmed: f.savings - savings,
    short: Math.max(0, f.rent + f.fixed + debtDue - salary),
  }
}

export interface DebtInfo {
  allPaid: number
  remaining: number
  paidThisCycle: number
  installmentDue: number
  installmentLeft: number
  monthsLeft: number
}

export function debtInfo(state: AppState, cycle: Cycle): DebtInfo {
  const f = state.finance
  const allPaid = sum(state.debtPayments.map((p) => p.amount))
  const remaining = Math.max(0, f.debtTotal - allPaid)
  const paidThisCycle = sum(
    state.debtPayments.filter((p) => p.date >= cycle.start && p.date <= cycle.end).map((p) => p.amount),
  )
  const installmentDue = Math.min(f.debtPlanMonthly, remaining + paidThisCycle)
  return {
    allPaid, remaining, paidThisCycle, installmentDue,
    installmentLeft: Math.max(0, installmentDue - paidThisCycle),
    monthsLeft: remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, f.debtPlanMonthly)),
  }
}

/** Allocation for a cycle with a given salary (the actual one if received, otherwise the expected plan). */
export function cycleAllocation(state: AppState, cycle: Cycle, salary?: number): Allocation {
  const d = debtInfo(state, cycle)
  return allocate(
    state.finance, salary ?? state.finance.salary, d.installmentDue, Math.max(0, d.paidThisCycle - d.installmentDue),
  )
}

export interface FinanceView {
  cycle: Cycle
  today: ISODate
  /** Salary for this cycle hasn't been entered yet — nothing is allocated and the pool is ₹0. */
  pending: boolean
  /** Pending AND the cycle began before the app was started: the first real month starts at the next payday. */
  waitingFirst: boolean
  received?: { amount: number; receivedOn: ISODate }
  /** The split that will happen / did happen. `plan` always uses the expected salary. */
  alloc: Allocation
  plan: Allocation
  cycleExpenses: Expense[]
  poolSpent: number
  swept: number
  topups: number
  poolTotal: number
  remaining: number
  groceries: BucketView
  lifestyle: BucketView
  buffer: BucketView & { used: number; target: number }
  todaySpend: number
  dailyLimit: number
  todayLeft: number
  tomorrowCap: number
  projectedSpend: number | null
  /** Money you can still spend through Sunday (or payday) at the safe daily pace, today's spending already deducted. */
  weekLeft: number
  /** Safe pace for a whole week (7 × the daily limit). */
  weekPace: number
  daysLeftInWeek: number
  salary: { salary: number; rent: number; fixed: number; debt: number; pocket: number; savings: number }
  debt: {
    total: number
    paidSoFar: number
    remaining: number
    installmentDue: number
    paidThisCycle: number
    installmentLeft: number
    monthsLeft: number
    cleared: boolean
  }
  savings: {
    floorNow: number
    /** Pocket pool you'd have each month once the debt is cleared. */
    pocketAfterDebt: number
    swept: number
    withdrawals: number
    guaranteed: number
    ifUnspent: number
  }
}

/** remaining ÷ total, safe when there is no pool (pending). */
export const poolRatio = (fv: FinanceView) => (fv.poolTotal > 0 ? fv.remaining / fv.poolTotal : 0)

export function computeFinance(state: AppState, today: ISODate): FinanceView {
  const f = state.finance
  const cycle = getCycle(today, f.paydayDay)
  const inCycle = (d: ISODate) => d >= cycle.start && d <= cycle.end

  const received = state.salaries[cycle.key]
  const pending = !received
  const waitingFirst = pending && cycle.start < state.startedOn

  const debt = debtInfo(state, cycle)
  const plan = cycleAllocation(state, cycle)
  const alloc = received ? cycleAllocation(state, cycle, received.amount) : plan
  // Until the salary lands there is no money to allocate: the pool and every bucket are ₹0.
  const eff = pending ? { pocket: 0, buckets: { groceries: 0, lifestyle: 0, buffer: 0 }, savings: 0 } : alloc

  const cycleExpenses = state.expenses.filter((e) => inCycle(e.date))
  const poolExp = cycleExpenses.filter((e) => e.fundedBy === 'pool')
  const savingsExp = cycleExpenses.filter((e) => e.fundedBy === 'savings')

  const cycleSweeps = state.sweeps.filter((s) => s.cycleKey === cycle.key)
  const sweptG = sum(cycleSweeps.map((s) => s.groceries))
  const sweptL = sum(cycleSweeps.map((s) => s.lifestyle))
  const topups = sum(state.topups.filter((t) => inCycle(t.date)).map((t) => t.amount))

  const spentBy = (b: Bucket) => sum(poolExp.filter((e) => bucketOf(e.category) === b).map((e) => e.amount))

  const gBudget = eff.buckets.groceries + topups - sweptG
  const lBudget = eff.buckets.lifestyle - sweptL
  const gSpent = spentBy('groceries')
  const lSpent = spentBy('lifestyle')
  const bSpent = spentBy('buffer')
  const gOver = Math.max(0, gSpent - gBudget)
  const lOver = Math.max(0, lSpent - lBudget)
  const bufferUsed = bSpent + gOver + lOver

  const poolSpent = sum(poolExp.map((e) => e.amount))
  const swept = sweptG + sweptL
  const poolTotal = eff.pocket + topups
  const remaining = poolTotal - poolSpent - swept

  // "Today's spend" ignores groceries (a tray of eggs lasts ten days: it comes out of the month's groceries
  // money, and the lower pool is spread over the days left) and emergency/crisis outflows, which are
  // planned/handled separately and would otherwise trip the daily alert.
  const todaySpend = sum(
    poolExp
      .filter((e) => e.date === today && e.source !== 'grocery-checkout' && e.category !== 'Emergency' && e.category !== 'Groceries')
      .map((e) => e.amount),
  )
  const daysLeft = Math.max(1, cycle.daysLeft)
  const dailyLimit = pending ? 0 : Math.max(0, (remaining + todaySpend) / daysLeft)
  const bufferLeft = eff.buckets.buffer - bufferUsed
  const protectedBuffer = Math.max(0, bufferLeft)
  const tomorrowCap =
    daysLeft > 1 ? Math.max(0, (remaining - protectedBuffer) / (daysLeft - 1)) : Math.max(0, remaining)

  const projectedSpend =
    !pending && cycle.elapsed >= 5 ? ((poolSpent + swept) / cycle.elapsed) * cycle.totalDays : null

  const shown = pending ? plan : alloc
  const floorNow = pending ? 0 : alloc.savings
  const pocketAfterDebt = allocate(f, shown.salary, 0).pocket
  const weekEnd = addDays(weekStartOf(today), 6)
  const daysLeftInWeek = diffDays(weekEnd < cycle.end ? weekEnd : cycle.end, today) + 1
  const withdrawals = sum(savingsExp.map((e) => e.amount))

  return {
    cycle,
    today,
    pending,
    waitingFirst,
    received,
    alloc,
    plan,
    cycleExpenses,
    poolSpent,
    swept,
    topups,
    poolTotal,
    remaining,
    groceries: { budget: gBudget, spent: gSpent, left: gBudget - gSpent, over: gOver },
    lifestyle: { budget: lBudget, spent: lSpent, left: lBudget - lSpent, over: lOver },
    buffer: {
      budget: eff.buckets.buffer, spent: bSpent, left: bufferLeft, over: Math.max(0, -bufferLeft),
      used: bufferUsed, target: eff.buckets.buffer,
    },
    todaySpend,
    dailyLimit,
    todayLeft: dailyLimit - todaySpend,
    tomorrowCap,
    projectedSpend,
    weekLeft: pending ? 0 : dailyLimit * daysLeftInWeek - todaySpend,
    weekPace: dailyLimit * 7,
    daysLeftInWeek,
    salary: {
      salary: shown.salary, rent: shown.rent, fixed: shown.fixed, debt: shown.debt, pocket: shown.pocket,
      savings: shown.savings,
    },
    debt: {
      total: f.debtTotal, paidSoFar: debt.allPaid, remaining: debt.remaining, installmentDue: debt.installmentDue,
      paidThisCycle: debt.paidThisCycle, installmentLeft: debt.installmentLeft, monthsLeft: debt.monthsLeft,
      cleared: debt.remaining === 0,
    },
    savings: {
      floorNow,
      pocketAfterDebt,
      swept,
      withdrawals,
      guaranteed: pending ? 0 : floorNow + swept - withdrawals - topups,
      ifUnspent: pending ? 0 : floorNow + swept - withdrawals - topups + Math.max(0, remaining),
    },
  }
}

// ---------- weekly Sunday sweeps ----------

function calcSweep(state: AppState, cycle: Cycle, weekStart: ISODate): Sweep | null {
  const received = state.salaries[cycle.key]
  if (!received) return null // nothing was allocated, so nothing can be swept
  const buckets = cycleAllocation(state, cycle, received.amount).buckets
  const weekEnd = addDays(weekStart, 6)
  const segStart = weekStart > cycle.start ? weekStart : cycle.start
  const segEnd = weekEnd < cycle.end ? weekEnd : cycle.end
  if (segEnd < segStart) return null
  const days = diffDays(segEnd, segStart) + 1
  const allowG = (buckets.groceries * days) / cycle.totalDays
  const allowL = (buckets.lifestyle * days) / cycle.totalDays
  const inSeg = state.expenses.filter(
    (e) => e.fundedBy === 'pool' && e.date >= segStart && e.date <= segEnd,
  )
  const spentG = sum(inSeg.filter((e) => bucketOf(e.category) === 'groceries').map((e) => e.amount))
  const spentL = sum(inSeg.filter((e) => bucketOf(e.category) === 'lifestyle').map((e) => e.amount))
  const g = Math.max(0, Math.round(allowG - spentG))
  const l = Math.max(0, Math.round(allowL - spentL))
  return {
    id: uid(), cycleKey: cycle.key, weekStart, groceries: g, lifestyle: l, amount: g + l,
    date: segEnd, auto: true,
  }
}

/** Weeks (Mon–Sun) of the current cycle that have fully passed and are not yet swept. */
export function dueSweeps(state: AppState, today: ISODate): Sweep[] {
  if (!state.finance.autoSweep) return []
  const cycle = getCycle(today, state.finance.paydayDay)
  const done = new Set(state.sweeps.filter((s) => s.cycleKey === cycle.key).map((s) => s.weekStart))
  const out: Sweep[] = []
  for (let ws = weekStartOf(cycle.start); ws <= today; ws = addDays(ws, 7)) {
    if (addDays(ws, 6) >= today) break // week not finished yet
    if (done.has(ws) || ws < state.startedOn) continue // never sweep weeks from before first use
    const s = calcSweep(state, cycle, ws)
    if (s) out.push(s)
  }
  return out
}

/** What a manual "sweep this week now" would move into savings. */
export function previewCurrentWeekSweep(state: AppState, today: ISODate): Sweep | null {
  const cycle = getCycle(today, state.finance.paydayDay)
  const ws = weekStartOf(today)
  if (state.sweeps.some((s) => s.cycleKey === cycle.key && s.weekStart === ws)) return null
  const s = calcSweep(state, cycle, ws)
  return s ? { ...s, auto: false, date: today } : null
}

// ---------- analytics ----------

export function spendByCategory(expenses: Expense[]): Array<{ category: ExpenseCategory; amount: number }> {
  const map = new Map<ExpenseCategory, number>()
  for (const e of expenses) if (e.fundedBy === 'pool') map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
  return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
}

export function dailySeries(fv: FinanceView): Array<{ date: ISODate; spend: number; future: boolean }> {
  const out: Array<{ date: ISODate; spend: number; future: boolean }> = []
  for (let i = 0; i < fv.cycle.totalDays; i++) {
    const date = addDays(fv.cycle.start, i)
    const spend = sum(
      fv.cycleExpenses
        .filter((e) => e.date === date && e.fundedBy === 'pool' && e.source !== 'grocery-checkout')
        .map((e) => e.amount),
    )
    out.push({ date, spend, future: date > fv.today })
  }
  return out
}

export function weekdaySpend(expenses: Expense[]): number[] {
  // Mon..Sun average-less totals (excluding weekly grocery run)
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const e of expenses) {
    if (e.fundedBy !== 'pool' || e.source === 'grocery-checkout') continue
    totals[(fromISO(e.date).getDay() + 6) % 7] += e.amount
  }
  return totals
}
