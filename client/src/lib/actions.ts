import type {
  AppState, CrisisEvent, CrisisType, DayKey, DayLog, Exercise, Expense, ExpenseCategory, GroceryItem,
  GroceryWeek, ISODate, JournalEntry, MealLog, SetLog, Task,
} from '../types'
import { addDays, nowISO } from './date'
import { getDayLog } from './day'
import { dueSweeps, previewCurrentWeekSweep } from './finance'
import { checkKey, weekTotals } from './groceries'
import { sum, uid } from './util'

export type Mut = (s: AppState) => AppState

const touch = (s: AppState): AppState => ({ ...s, updatedAt: nowISO() })

// ---------- money ----------

export interface NewExpense {
  amount: number
  title: string
  category: ExpenseCategory
  date: ISODate
  fundedBy?: Expense['fundedBy']
  source?: Expense['source']
  refId?: string
}

export const addExpense = (e: NewExpense): Mut => (s) =>
  touch({
    ...s,
    expenses: [
      ...s.expenses,
      {
        id: uid(), createdAt: nowISO(), fundedBy: 'pool', source: 'manual', ...e,
        amount: Math.round(e.amount),
        title: e.title.trim() || e.category,
      },
    ],
  })

export const deleteExpense = (id: string): Mut => (s) => {
  const target = s.expenses.find((e) => e.id === id)
  let next = { ...s, expenses: s.expenses.filter((e) => e.id !== id) }
  // deleting a meal-linked expense detaches the cost from the meal log
  if (target?.source === 'meal' && target.refId) {
    next = { ...next, meals: next.meals.map((m) => (m.id === target.refId ? { ...m, cost: 0 } : m)) }
  }
  return touch(next)
}

export const logDebtPayment = (amount: number, date: ISODate, note?: string): Mut => (s) => {
  const paid = sum(s.debtPayments.map((p) => p.amount))
  const left = Math.max(0, s.finance.debtTotal - paid)
  const a = Math.min(Math.round(amount), left)
  if (a <= 0) return s
  return touch({ ...s, debtPayments: [...s.debtPayments, { id: uid(), date, amount: a, note }] })
}

/** Salary landed: this is what allocates the month. Re-entering the same cycle corrects the amount. */
export const receiveSalary = (cycleKey: ISODate, amount: number, receivedOn: ISODate): Mut => (s) =>
  touch({ ...s, salaries: { ...s.salaries, [cycleKey]: { amount: Math.round(amount), receivedOn } } })

export const clearSalary = (cycleKey: ISODate): Mut => (s) => {
  const next = { ...s.salaries }
  delete next[cycleKey]
  return touch({ ...s, salaries: next })
}

export const setPaid = (key: string, value: boolean): Mut => (s) =>
  touch({ ...s, paid: { ...s.paid, [key]: value } })

export const applyAutoSweeps = (today: ISODate): Mut => (s) => {
  const due = dueSweeps(s, today)
  return due.length === 0 ? s : touch({ ...s, sweeps: [...s.sweeps, ...due] })
}

export const sweepNow = (today: ISODate): Mut => (s) => {
  const sw = previewCurrentWeekSweep(s, today)
  return sw ? touch({ ...s, sweeps: [...s.sweeps, sw] }) : s
}

export const topupFromSavings = (amount: number, reason: string, today: ISODate): Mut => (s) =>
  touch({ ...s, topups: [...s.topups, { id: uid(), date: today, amount: Math.round(amount), reason }] })

// ---------- tasks ----------

export const addTask = (t: Pick<Task, 'title' | 'category' | 'priority' | 'due' | 'note'>): Mut => (s) =>
  touch({
    ...s,
    tasks: [...s.tasks, { id: uid(), done: false, carried: 0, createdAt: nowISO(), ...t, title: t.title.trim() }],
  })

export const toggleTask = (id: string): Mut => (s) =>
  touch({
    ...s,
    tasks: s.tasks.map((t) =>
      t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? nowISO() : undefined } : t,
    ),
  })

export const deleteTask = (id: string): Mut => (s) => touch({ ...s, tasks: s.tasks.filter((t) => t.id !== id) })

/** Move every unfinished task that is due today (or overdue / "today's must-do" with no date) to tomorrow. */
export const carryOverTasks = (today: ISODate): Mut => (s) => {
  const tomorrow = addDays(today, 1)
  return touch({
    ...s,
    tasks: s.tasks.map((t) =>
      !t.done && ((t.due && t.due <= today) || (!t.due && t.category === 'today'))
        ? { ...t, due: tomorrow, carried: t.carried + 1 }
        : t,
    ),
  })
}

export const dismissAuto = (id: string): Mut => (s) =>
  touch({ ...s, dismissedAuto: { ...s.dismissedAuto, [id]: true } })

/** Completing an auto-task performs the underlying action where one exists. */
export const completeAutoTask = (id: string, installmentLeft: number, today: ISODate): Mut => (s) => {
  if (id.startsWith('auto:rent:')) return setPaid(`${id.slice('auto:rent:'.length)}:rent`, true)(s)
  if (id.startsWith('auto:fixed:')) return setPaid(`${id.slice('auto:fixed:'.length)}:fixed`, true)(s)
  if (id.startsWith('auto:payday:')) return setPaid(`${id.slice('auto:payday:'.length)}:savings`, true)(s)
  if (id.startsWith('auto:debt:')) return logDebtPayment(installmentLeft, today, 'From auto-task')(s)
  return dismissAuto(id)(s)
}

// ---------- groceries & meals ----------

export const setOutOfStock = (itemId: string, value: boolean): Mut => (s) => {
  const next = { ...s.outOfStock }
  if (value) next[itemId] = true
  else delete next[itemId]
  return touch({ ...s, outOfStock: next })
}

export const setInStock = (item: GroceryItem, value: boolean, today: ISODate): Mut => (s) => {
  if (!item.pantryKey) return s
  const entry = value
    ? { inStock: true, boughtOn: today, expiresOn: addDays(today, item.shelfLifeDays ?? 28) }
    : { inStock: false }
  // having it in stock means it is no longer out of stock anywhere
  const oos = { ...s.outOfStock }
  if (value) for (const k of Object.keys(oos)) if (k === item.id) delete oos[k]
  return touch({ ...s, pantry: { ...s.pantry, [item.pantryKey]: entry }, outOfStock: oos })
}

export const toggleChecked = (weekKey: ISODate, itemId: string): Mut => (s) => {
  const k = checkKey(weekKey, itemId)
  return touch({ ...s, checked: { ...s.checked, [k]: !s.checked[k] } })
}

export const setPriceOverride = (itemId: string, price: number | null): Mut => (s) => {
  const next = { ...s.priceOverrides }
  if (price === null || Number.isNaN(price)) delete next[itemId]
  else next[itemId] = Math.max(0, Math.round(price))
  return touch({ ...s, priceOverrides: next })
}

/** Log the checked items as one grocery expense, stock shelf-stable items, clear out-of-stock flags. */
export const checkoutWeek = (week: GroceryWeek, weekKey: ISODate, today: ISODate): Mut => (s) => {
  const totals = weekTotals(s, week, weekKey, today)
  if (totals.checkedItems.length === 0) return s
  const total = totals.checkedTotal
  const pantry = { ...s.pantry }
  const oos = { ...s.outOfStock }
  for (const it of totals.checkedItems) {
    delete oos[it.id]
    if (it.pantryKey) {
      pantry[it.pantryKey] = {
        inStock: true, boughtOn: today, expiresOn: addDays(today, it.shelfLifeDays ?? 28),
      }
    }
  }
  const id = uid()
  const next: AppState = {
    ...s,
    pantry,
    outOfStock: oos,
    checkouts: [
      ...s.checkouts,
      { id, weekKey, weekIndex: week.index, date: today, total, itemIds: totals.checkedItems.map((i) => i.id) },
    ],
    expenses: [
      ...s.expenses,
      {
        id: uid(), createdAt: nowISO(), date: today, amount: total, category: 'Groceries', fundedBy: 'pool',
        source: 'grocery-checkout', refId: id,
        title: `${week.title} groceries (${totals.checkedItems.length} items)`,
      },
    ],
  }
  return touch(next)
}

export const addMeal = (m: Omit<MealLog, 'id' | 'createdAt'>): Mut => (s) => {
  const id = uid()
  const meal: MealLog = { ...m, id, createdAt: nowISO() }
  let next: AppState = { ...s, meals: [...s.meals, meal] }
  if (m.cost > 0) {
    next = {
      ...next,
      expenses: [
        ...next.expenses,
        {
          id: uid(), createdAt: nowISO(), date: m.date, amount: Math.round(m.cost), title: m.title,
          category: 'Outside Food', fundedBy: 'pool', source: 'meal', refId: id,
        },
      ],
    }
  }
  return touch(next)
}

export const deleteMeal = (id: string): Mut => (s) =>
  touch({
    ...s,
    meals: s.meals.filter((m) => m.id !== id),
    expenses: s.expenses.filter((e) => !(e.source === 'meal' && e.refId === id)),
  })

// ---------- day tracking ----------

const patchDay = (date: ISODate, fn: (d: DayLog) => DayLog): Mut => (s) =>
  touch({ ...s, dayLogs: { ...s.dayLogs, [date]: fn(getDayLog(s, date)) } })

export const addWater = (date: ISODate, ml: number, label: string): Mut =>
  patchDay(date, (d) => ({
    ...d, water: [...d.water, { id: uid(), ml, label, t: nowISO() }],
  }))

export const removeLastWater = (date: ISODate): Mut => patchDay(date, (d) => ({ ...d, water: d.water.slice(0, -1) }))

export const addSteps = (date: ISODate, n: number): Mut =>
  patchDay(date, (d) => ({ ...d, extraSteps: Math.max(0, d.extraSteps + n) }))

export const setExtraSteps = (date: ISODate, n: number): Mut =>
  patchDay(date, (d) => ({ ...d, extraSteps: Math.max(0, Math.round(n)) }))

export const toggleHabit = (date: ISODate, habitId: string): Mut =>
  patchDay(date, (d) => ({ ...d, habits: { ...d.habits, [habitId]: !d.habits[habitId] } }))

export const setMinimumDay = (date: ISODate, on: boolean): Mut => patchDay(date, (d) => ({ ...d, minimumDay: on }))

export const toggleMobility = (date: ISODate, id: string): Mut =>
  patchDay(date, (d) => ({ ...d, mobility: { ...d.mobility, [id]: !d.mobility[id] } }))

export const setSplitOverride = (date: ISODate, key: DayKey | undefined): Mut =>
  patchDay(date, (d) => ({ ...d, splitOverride: key }))

export const setGymMissed = (date: ISODate, v: boolean): Mut => patchDay(date, (d) => ({ ...d, gymMissed: v }))

/** Can't train today: today becomes active recovery, tomorrow does today's split. */
export const moveSessionToTomorrow = (today: ISODate, todayKey: DayKey): Mut => (s) =>
  setSplitOverride(addDays(today, 1), todayKey)(setSplitOverride(today, 'sun')(setGymMissed(today, true)(s)))

// ---------- gym ----------

export const updateSet = (
  date: ISODate, exercise: Exercise, idx: number, patch: Partial<SetLog>,
): Mut => (s) => {
  const day = { ...(s.workouts[date] ?? {}) }
  const sets: SetLog[] = Array.from({ length: Math.max(exercise.sets, (day[exercise.id] ?? []).length) }, (_, i) =>
    day[exercise.id]?.[i] ?? { weight: '', reps: '', done: false })
  sets[idx] = { ...sets[idx], ...patch }
  day[exercise.id] = sets
  return touch({ ...s, workouts: { ...s.workouts, [date]: day } })
}

export const addExercise = (key: DayKey, name: string, sets: number, reps: string): Mut => (s) =>
  touch({
    ...s,
    gymPlan: { ...s.gymPlan, [key]: [...s.gymPlan[key], { id: uid(), name: name.trim(), sets, reps }] },
  })

export const removeExercise = (key: DayKey, id: string): Mut => (s) =>
  touch({ ...s, gymPlan: { ...s.gymPlan, [key]: s.gymPlan[key].filter((e) => e.id !== id) } })

// ---------- journal ----------

export const saveJournal = (date: ISODate, patch: Partial<JournalEntry>): Mut => (s) => {
  const prev: JournalEntry = s.journal[date] ?? {
    mood: 3, energy: 3, wins: '', struggles: '', tomorrow: '', notes: '', updatedAt: nowISO(),
  }
  return touch({ ...s, journal: { ...s.journal, [date]: { ...prev, ...patch, updatedAt: nowISO() } } })
}

// ---------- crisis ----------

export const logCrisis = (
  type: CrisisType, title: string, amount: number, detail: string, date: ISODate,
): Mut => (s) => {
  const ev: CrisisEvent = { id: uid(), date, type, title, amount, detail, resolved: false }
  return touch({ ...s, crisisEvents: [ev, ...s.crisisEvents] })
}

export const resolveCrisis = (id: string): Mut => (s) =>
  touch({ ...s, crisisEvents: s.crisisEvents.map((c) => (c.id === id ? { ...c, resolved: true } : c)) })

export const setSurvival = (active: boolean, today: ISODate): Mut => (s) =>
  touch({ ...s, survival: active ? { active: true, since: today } : { active: false } })

/** Surprise expense: split between the pool (Emergency → buffer) and savings, optionally with a recovery task. */
export const logSurpriseExpense = (p: {
  title: string; fromPool: number; fromSavings: number; today: ISODate; recoverNote?: string
}): Mut => (s) => {
  let next = s
  if (p.fromPool > 0) {
    next = addExpense({
      amount: p.fromPool, title: p.title, category: 'Emergency', date: p.today, fundedBy: 'pool', source: 'crisis',
    })(next)
  }
  if (p.fromSavings > 0) {
    next = addExpense({
      amount: p.fromSavings, title: `${p.title} (from savings)`, category: 'Emergency', date: p.today,
      fundedBy: 'savings', source: 'crisis',
    })(next)
  }
  next = logCrisis('expense', p.title, p.fromPool + p.fromSavings, p.recoverNote ?? '', p.today)(next)
  return next
}

// ---------- settings ----------

export const patchState = (patch: Partial<AppState>): Mut => (s) => touch({ ...s, ...patch })

// ---------- clear / reset ----------

/** Forget typed prices, ticks, "in kitchen" and "ran out" marks. */
export const clearGroceries: Mut = (s) =>
  touch({ ...s, priceOverrides: {}, checked: {}, pantry: {}, outOfStock: {} })

export const clearCompletedTasks: Mut = (s) => touch({ ...s, tasks: s.tasks.filter((t) => !t.done) })

export const clearAllTasks: Mut = (s) => touch({ ...s, tasks: [], dismissedAuto: {} })

/** Remove every expense, top-up, sweep and grocery checkout that belongs to one pay cycle. */
export const clearCycleExpenses = (start: ISODate, end: ISODate): Mut => (s) => {
  const inC = (d: ISODate) => d >= start && d <= end
  return touch({
    ...s,
    expenses: s.expenses.filter((e) => !inC(e.date)),
    topups: s.topups.filter((t) => !inC(t.date)),
    sweeps: s.sweeps.filter((w) => w.cycleKey !== start),
    checkouts: s.checkouts.filter((c) => !inC(c.date)),
  })
}

export const clearDebtPayments: Mut = (s) => touch({ ...s, debtPayments: [] })

/** Wipe one day: water, steps, habits, meals (and their expenses), gym sets and the journal entry. */
export const clearDay = (date: ISODate): Mut => (s) => {
  const dayLogs = { ...s.dayLogs }
  const workouts = { ...s.workouts }
  const journal = { ...s.journal }
  delete dayLogs[date]
  delete workouts[date]
  delete journal[date]
  const mealIds = new Set(s.meals.filter((m) => m.date === date).map((m) => m.id))
  return touch({
    ...s,
    dayLogs, workouts, journal,
    meals: s.meals.filter((m) => m.date !== date),
    expenses: s.expenses.filter((e) => !(e.source === 'meal' && e.refId && mealIds.has(e.refId))),
  })
}

/** Wipe all tracking history (water/steps/habits, meals, gym logs, journal, crisis log). Money ledgers are untouched. */
export const clearHistory: Mut = (s) => {
  const mealIds = new Set(s.meals.map((m) => m.id))
  return touch({
    ...s,
    dayLogs: {}, workouts: {}, journal: {}, meals: [], crisisEvents: [],
    expenses: s.expenses.filter((e) => !(e.source === 'meal' && e.refId && mealIds.has(e.refId))),
  })
}
