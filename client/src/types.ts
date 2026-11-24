// ---------- Shared domain types (mirrored by the Mongoose schemas in /server) ----------

export type ISODate = string // 'YYYY-MM-DD' in local time

export type ExpenseCategory =
  | 'Groceries'
  | 'Outside Food'
  | 'Movies/Dates'
  | 'Rides'
  | 'Personal'
  | 'Emergency'

export type Bucket = 'groceries' | 'lifestyle' | 'buffer'

export interface Expense {
  id: string
  date: ISODate
  createdAt: string // ISO timestamp
  amount: number
  title: string
  category: ExpenseCategory
  /** 'pool' = deducted from the ₹5,000 pocket pool. 'savings' = emergency money pulled from savings. */
  fundedBy: 'pool' | 'savings'
  source: 'manual' | 'grocery-checkout' | 'meal' | 'crisis'
  refId?: string
}

export type Priority = 'high' | 'routine' | 'low'
export type TaskCategory = 'today' | 'errands' | 'finance' | 'dev' | 'personal'

export interface Task {
  id: string
  title: string
  category: TaskCategory
  priority: Priority
  due?: ISODate
  done: boolean
  createdAt: string
  doneAt?: string
  carried: number
  note?: string
  /** Derived by the smart-trigger engine (never stored). */
  auto?: boolean
}

export interface DebtPayment {
  id: string
  date: ISODate
  amount: number
  note?: string
}

export interface PoolTopup {
  id: string
  date: ISODate
  amount: number
  reason: string
}

export interface Sweep {
  id: string
  cycleKey: ISODate
  weekStart: ISODate
  groceries: number
  lifestyle: number
  amount: number
  date: ISODate
  auto: boolean
}

export type Appliance = 'Egg Boiler' | 'Pan' | 'Kettle'
export type MealSlot = 'Pre-Workout' | 'Breakfast' | 'Lunch' | 'Evening Snack' | 'Dinner'

export interface MealLog {
  id: string
  date: ISODate
  slot: MealSlot
  title: string
  appliances: Appliance[]
  cost: number // outside / bought meal cost, 0 = home cooked
  protein: number // grams, estimate (optional, 0 = unknown)
  createdAt: string
}

export interface GroceryItem {
  id: string
  name: string
  qty: string
  price: number
  appliances: Appliance[]
  nutrient: string
  /** Shelf-stable items (seeds, jaggery, spices…) can be marked "In Kitchen Stock". */
  pantryKey?: string
  shelfLifeDays?: number
}

export interface GroceryWeek {
  index: number
  title: string
  focus: string
  target: number
  items: GroceryItem[]
}

export interface PantryEntry {
  inStock: boolean
  boughtOn?: ISODate
  expiresOn?: ISODate
}

export interface GroceryCheckout {
  id: string
  weekKey: ISODate // Monday of the week it was bought for
  weekIndex: number
  date: ISODate
  total: number
  itemIds: string[]
}

export interface Exercise {
  id: string
  name: string
  sets: number
  reps: string
}

export interface SetLog {
  weight: number | ''
  reps: number | ''
  done: boolean
}

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface WaterEntry {
  id: string
  ml: number
  label: string
  t: string
}

export interface DayLog {
  water: WaterEntry[]
  extraSteps: number
  habits: Record<string, boolean>
  minimumDay: boolean
  splitOverride?: DayKey
  gymMissed?: boolean
  mobility: Record<string, boolean>
}

export interface Habit {
  id: string
  label: string
  /** Step credit granted when ticked (the gym walk). */
  stepCredit?: number
}

export interface JournalEntry {
  mood: number // 1-5
  energy: number // 1-5
  wins: string
  struggles: string
  tomorrow: string
  notes: string
  updatedAt: string
}

export type CrisisType = 'money' | 'expense' | 'bad-day' | 'food'

export interface CrisisEvent {
  id: string
  date: ISODate
  type: CrisisType
  title: string
  amount: number
  detail: string
  resolved: boolean
}

export interface QuickPreset {
  id: string
  title: string
  amount: number
  category: ExpenseCategory
}

// ---------- Editable baseline configuration ----------

export interface Profile {
  name: string
  age: number
  gender: string
  weightKg: number
  goal: string
  city: string
  living: string
  appliances: string[]
}

export interface FinanceConfig {
  salary: number
  rent: number
  fixed: number
  /** Fixed monthly savings. Never changes with the salary; the pocket pool is whatever is left. */
  savings: number
  paydayDay: number
  rentDueDay: number
  debtDueDay: number
  fixedDueDay: number
  buckets: { groceries: number; lifestyle: number; buffer: number }
  debtTotal: number
  debtPlanMonthly: number
  debtPlanMonths: number
  autoSweep: boolean
}

export interface Targets {
  waterMl: number
  glassMl: number
  steps: number
  walkCredit: number
  proteinG: number
  minWaterMl: number
  minSteps: number
}

export interface Settings {
  quickPresets: QuickPreset[]
  notifications: boolean
  /** First-run setup (mid-cycle catch-up) finished or skipped. */
  onboarded: boolean
}

export interface AppState {
  version: number
  updatedAt: string
  /** First day the app was used — sweeps and nudges ignore anything before it. */
  startedOn: ISODate
  profile: Profile
  finance: FinanceConfig
  targets: Targets
  settings: Settings
  habits: Habit[]
  // ledgers
  expenses: Expense[]
  topups: PoolTopup[]
  sweeps: Sweep[]
  debtPayments: DebtPayment[]
  /** Salary actually received per pay cycle (key = cycle start). No entry = nothing allocated yet. */
  salaries: Record<ISODate, { amount: number; receivedOn: ISODate }>
  paid: Record<string, boolean> // `${cycleKey}:rent` | `:fixed` | `:savings`
  // tasks
  tasks: Task[]
  dismissedAuto: Record<string, boolean>
  // food
  pantry: Record<string, PantryEntry>
  outOfStock: Record<string, boolean>
  checked: Record<string, boolean> // `${weekKey}:${itemId}`
  priceOverrides: Record<string, number>
  checkouts: GroceryCheckout[]
  meals: MealLog[]
  // body
  gymPlan: Record<DayKey, Exercise[]>
  workouts: Record<ISODate, Record<string, SetLog[]>>
  dayLogs: Record<ISODate, DayLog>
  // reflection
  journal: Record<ISODate, JournalEntry>
  // crisis
  survival: { active: boolean; since?: ISODate }
  crisisEvents: CrisisEvent[]
}

// ---------- Derived (computed, never stored) ----------

export type AlertLevel = 'ok' | 'info' | 'warn' | 'danger'

export interface Alert {
  id: string
  level: AlertLevel
  message: string
  action?: { label: string; to: string }
}
