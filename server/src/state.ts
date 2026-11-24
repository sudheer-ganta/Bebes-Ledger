import { z } from 'zod'
import {
  Config, CrisisEvent, DayLog, DebtPayment, Expense, GroceryCheckout, Journal, MealLog, PoolTopup, Sweep, Task,
  WorkoutLog, type AnyModel,
} from './models.js'

// ---------- validation of the client snapshot (PUT /api/sync) ----------

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const amount = z.number().finite().nonnegative()
const id = z.string().min(1)

const ExpenseZ = z.object({
  id, date: iso, createdAt: z.string(), amount, title: z.string(),
  category: z.enum(['Groceries', 'Outside Food', 'Movies/Dates', 'Rides', 'Personal', 'Emergency']),
  fundedBy: z.enum(['pool', 'savings']), source: z.enum(['manual', 'grocery-checkout', 'meal', 'crisis']),
  refId: z.string().optional(),
})
const TaskZ = z.object({
  id, title: z.string(), category: z.enum(['today', 'errands', 'finance', 'dev', 'personal']),
  priority: z.enum(['high', 'routine', 'low']), due: iso.optional(), done: z.boolean(), createdAt: z.string(),
  doneAt: z.string().optional(), carried: z.number(), note: z.string().optional(),
})
const DebtZ = z.object({ id, date: iso, amount, note: z.string().optional() })
const TopupZ = z.object({ id, date: iso, amount, reason: z.string() })
const SweepZ = z.object({
  id, cycleKey: iso, weekStart: iso, groceries: z.number(), lifestyle: z.number(), amount: z.number(), date: iso,
  auto: z.boolean(),
})
const MealZ = z.object({
  id, date: iso, slot: z.enum(['Pre-Workout', 'Breakfast', 'Lunch', 'Evening Snack', 'Dinner']), title: z.string(),
  appliances: z.array(z.enum(['Egg Boiler', 'Pan', 'Kettle'])), cost: amount, protein: amount, createdAt: z.string(),
})
const CheckoutZ = z.object({
  id, weekKey: iso, weekIndex: z.number().int().min(0).max(3), date: iso, total: amount, itemIds: z.array(z.string()),
})
const CrisisZ = z.object({
  id, date: iso, type: z.enum(['money', 'expense', 'bad-day', 'food']), title: z.string(), amount: z.number(),
  detail: z.string(), resolved: z.boolean(),
})
const dated = <T extends z.ZodTypeAny>(v: T) => z.record(iso, v)
const loose = z.record(z.string(), z.unknown())

export const SnapshotZ = z
  .object({
    version: z.number(),
    updatedAt: z.string().min(1),
    startedOn: iso.optional(),
    profile: loose, finance: loose, targets: loose, settings: loose,
    habits: z.array(loose), gymPlan: loose, survival: loose,
    expenses: z.array(ExpenseZ), topups: z.array(TopupZ), sweeps: z.array(SweepZ),
    debtPayments: z.array(DebtZ), tasks: z.array(TaskZ), meals: z.array(MealZ),
    checkouts: z.array(CheckoutZ), crisisEvents: z.array(CrisisZ),
    salaries: loose.optional(), paid: loose, dismissedAuto: loose, pantry: loose, outOfStock: loose, checked: loose, priceOverrides: loose,
    workouts: dated(loose), dayLogs: dated(loose), journal: dated(loose),
  })
  .passthrough()

export type Snapshot = z.infer<typeof SnapshotZ>

// ---------- collections that map 1:1 to arrays in the client state ----------

export const LISTS = {
  expenses: Expense, topups: PoolTopup, sweeps: Sweep, debtPayments: DebtPayment, tasks: Task, meals: MealLog,
  checkouts: GroceryCheckout, crisisEvents: CrisisEvent,
} as const satisfies Record<string, AnyModel>

const CONFIG_KEYS = [
  'version', 'updatedAt', 'startedOn', 'profile', 'finance', 'targets', 'settings', 'habits', 'survival', 'gymPlan',
  'pantry', 'outOfStock', 'checked', 'priceOverrides', 'salaries', 'paid', 'dismissedAuto',
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>

const clean = <T extends Doc>(d: T): Omit<T, '_id'> => {
  const { _id, ...rest } = d
  void _id
  return rest
}

async function replaceList(Model: AnyModel, items: Doc[], key: string) {
  if (items.length > 0) {
    await Model.bulkWrite(
      items.map((it) => ({ replaceOne: { filter: { [key]: it[key] }, replacement: it, upsert: true } })),
    )
  }
  await Model.deleteMany({ [key]: { $nin: items.map((i) => i[key]) } })
}

/** Replace everything in MongoDB with the client's snapshot. */
export async function saveSnapshot(s: Snapshot): Promise<void> {
  const snap = s as Doc

  const config: Doc = { key: 'me' }
  for (const k of CONFIG_KEYS) config[k] = snap[k]
  config.salaries = snap.salaries ?? {}
  await Config.replaceOne({ key: 'me' }, config, { upsert: true })

  for (const [name, Model] of Object.entries(LISTS)) {
    await replaceList(Model, snap[name] as Doc[], 'id')
  }

  const days = Object.entries(snap.dayLogs as Record<string, Doc>).map(([date, d]) => ({ date, ...d }))
  await replaceList(DayLog, days, 'date')

  const workouts = Object.entries(snap.workouts as Record<string, Doc>).map(([date, exercises]) => ({ date, exercises }))
  await replaceList(WorkoutLog, workouts, 'date')

  const journal = Object.entries(snap.journal as Record<string, Doc>).map(([date, j]) => ({ date, ...j }))
  await replaceList(Journal, journal, 'date')
}

/** Rebuild the client's AppState from MongoDB. Returns null when nothing was ever saved. */
export async function loadSnapshot(): Promise<Doc | null> {
  const cfg = await Config.findOne({ key: 'me' }).lean<Doc>()
  if (!cfg) return null

  const state: Doc = {}
  for (const k of CONFIG_KEYS) state[k] = cfg[k]
  state.salaries = cfg.salaries ?? {}

  for (const [name, Model] of Object.entries(LISTS)) {
    const rows = await (Model as AnyModel).find().lean<Doc[]>()
    state[name] = rows.map(clean)
  }

  state.dayLogs = Object.fromEntries(
    (await DayLog.find().lean<Doc[]>()).map(({ _id, date, ...rest }) => (void _id, [date, rest])),
  )
  state.workouts = Object.fromEntries(
    (await WorkoutLog.find().lean<Doc[]>()).map(({ date, exercises }) => [date, exercises]),
  )
  state.journal = Object.fromEntries(
    (await Journal.find().lean<Doc[]>()).map(({ _id, date, ...rest }) => (void _id, [date, rest])),
  )
  return state
}

export async function touchConfig(): Promise<void> {
  await Config.updateOne({ key: 'me' }, { $set: { updatedAt: new Date().toISOString() } })
}
