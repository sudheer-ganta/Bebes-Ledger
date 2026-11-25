import { Schema, model, type Model } from 'mongoose'

// Single-user app: every document carries a client-generated string `id` (uuid) or a `date` key.
// Shapes mirror client/src/types.ts one-to-one.

const opts = { versionKey: false, minimize: false } as const

const CATEGORIES = ['Groceries', 'Outside Food', 'Movies/Dates', 'Rides', 'Personal', 'Emergency'] as const

// ---------- money ----------
const ExpenseSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    createdAt: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    title: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    fundedBy: { type: String, enum: ['pool', 'savings'], default: 'pool' },
    source: { type: String, enum: ['manual', 'grocery-checkout', 'meal', 'crisis'], default: 'manual' },
    refId: String,
  },
  opts,
)

const DebtPaymentSchema = new Schema(
  { id: { type: String, required: true, unique: true }, date: { type: String, required: true }, amount: { type: Number, required: true, min: 0 }, note: String },
  opts,
)

const PoolTopupSchema = new Schema(
  { id: { type: String, required: true, unique: true }, date: { type: String, required: true }, amount: { type: Number, required: true, min: 0 }, reason: String },
  opts,
)

const SweepSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    cycleKey: { type: String, required: true, index: true },
    weekStart: { type: String, required: true },
    groceries: { type: Number, default: 0 },
    lifestyle: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    date: { type: String, required: true },
    auto: { type: Boolean, default: true },
  },
  opts,
)

// ---------- tasks ----------
const TaskSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    category: { type: String, enum: ['today', 'errands', 'finance', 'dev', 'personal'], required: true },
    priority: { type: String, enum: ['high', 'routine', 'low'], default: 'routine' },
    due: String,
    done: { type: Boolean, default: false },
    createdAt: String,
    doneAt: String,
    carried: { type: Number, default: 0 },
    note: String,
  },
  opts,
)

// ---------- food ----------
const MealLogSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    date: { type: String, required: true, index: true },
    slot: { type: String, enum: ['Pre-Workout', 'Breakfast', 'Lunch', 'Evening Snack', 'Dinner'], required: true },
    title: { type: String, required: true },
    appliances: [{ type: String, enum: ['Egg Boiler', 'Pan', 'Kettle'] }],
    cost: { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
    createdAt: String,
  },
  opts,
)

const GroceryCheckoutSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    weekKey: { type: String, required: true },
    weekIndex: { type: Number, min: 0, max: 3 },
    date: { type: String, required: true },
    total: { type: Number, required: true },
    itemIds: [String],
  },
  opts,
)

// ---------- crisis ----------
const CrisisEventSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    date: { type: String, required: true },
    type: { type: String, enum: ['money', 'expense', 'bad-day', 'food'], required: true },
    title: String,
    amount: { type: Number, default: 0 },
    detail: String,
    resolved: { type: Boolean, default: false },
  },
  opts,
)

// ---------- one document per day ----------
const DayLogSchema = new Schema(
  {
    date: { type: String, required: true, unique: true },
    water: [{ _id: false, id: String, ml: Number, label: String, t: String }],
    extraSteps: { type: Number, default: 0 },
    habits: { type: Schema.Types.Mixed, default: {} },
    mobility: { type: Schema.Types.Mixed, default: {} },
    minimumDay: { type: Boolean, default: false },
    splitOverride: String,
    gymMissed: Boolean,
  },
  opts,
)

const WorkoutLogSchema = new Schema(
  {
    date: { type: String, required: true, unique: true },
    // { [exerciseId]: [{ weight: number|'', reps: number|'', done: boolean }] }
    exercises: { type: Schema.Types.Mixed, default: {} },
  },
  opts,
)

const JournalSchema = new Schema(
  {
    date: { type: String, required: true, unique: true },
    mood: { type: Number, min: 1, max: 5, default: 3 },
    energy: { type: Number, min: 1, max: 5, default: 3 },
    wins: String,
    struggles: String,
    tomorrow: String,
    notes: String,
    updatedAt: String,
  },
  opts,
)

// ---------- singleton configuration + small keyed maps ----------
const ConfigSchema = new Schema(
  {
    key: { type: String, default: 'me', unique: true },
    version: Number,
    updatedAt: { type: String, required: true },
    startedOn: String,
    profile: {
      name: String, age: Number, gender: String, weightKg: Number, goal: String, city: String, living: String,
      appliances: [String],
    },
    finance: {
      salary: Number, rent: Number, fixed: Number, savings: Number, paydayDay: Number, rentDueDay: Number,
      debtDueDay: Number, fixedDueDay: Number, debtTotal: Number, debtPlanMonthly: Number, debtPlanMonths: Number,
      autoSweep: Boolean,
      buckets: { groceries: Number, lifestyle: Number, buffer: Number },
    },
    targets: {
      waterMl: Number, glassMl: Number, steps: Number, walkCredit: Number, proteinG: Number, minWaterMl: Number,
      minSteps: Number,
    },
    settings: {
      notifications: Boolean,
      onboarded: Boolean,
      quickPresets: [{ _id: false, id: String, title: String, amount: Number, category: String }],
    },
    habits: [{ _id: false, id: String, label: String, stepCredit: Number }],
    survival: { active: Boolean, since: String },
    gymPlan: { type: Schema.Types.Mixed, default: {} }, // { mon: Exercise[], … }
    pantry: { type: Schema.Types.Mixed, default: {} },
    outOfStock: { type: Schema.Types.Mixed, default: {} },
    checked: { type: Schema.Types.Mixed, default: {} },
    priceOverrides: { type: Schema.Types.Mixed, default: {} },
    salaries: { type: Schema.Types.Mixed, default: {} }, // { [cycleStart]: { amount, receivedOn } }
    paid: { type: Schema.Types.Mixed, default: {} },
    dismissedAuto: { type: Schema.Types.Mixed, default: {} },
  },
  opts,
)

export const Expense = model('Expense', ExpenseSchema)
export const DebtPayment = model('DebtPayment', DebtPaymentSchema)
export const PoolTopup = model('PoolTopup', PoolTopupSchema)
export const Sweep = model('Sweep', SweepSchema)
export const Task = model('Task', TaskSchema)
export const MealLog = model('MealLog', MealLogSchema)
export const GroceryCheckout = model('GroceryCheckout', GroceryCheckoutSchema)
export const CrisisEvent = model('CrisisEvent', CrisisEventSchema)
export const DayLog = model('DayLog', DayLogSchema)
export const WorkoutLog = model('WorkoutLog', WorkoutLogSchema)
export const Journal = model('Journal', JournalSchema)
export const Config = model('Config', ConfigSchema)

// The chat bot's own memory (recent lines, greeting count). Separate from Config so the app's sync never touches it.
const BotMemorySchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    picks: { type: Schema.Types.Mixed, default: {} },
    morning: { type: Schema.Types.Mixed, default: { count: 0, at: 0 } },
    history: { type: Schema.Types.Mixed, default: [] }, // last few chat turns, for Gemini
    ai: { type: Schema.Types.Mixed, default: null }, // { day, count } Gemini replies today
  },
  opts,
)
export const BotMemory = model('BotMemory', BotMemorySchema)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModel = Model<any>
