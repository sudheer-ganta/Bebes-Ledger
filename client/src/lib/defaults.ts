import type {
  AppState, Appliance, DayKey, Exercise, GroceryWeek, Habit, QuickPreset,
} from '../types'
import { toISO } from './date'

export const STATE_VERSION = 1

export const CATEGORIES = ['Groceries', 'Outside Food', 'Movies/Dates', 'Rides', 'Personal'] as const

export const MEAL_SLOTS = ['Pre-Workout', 'Breakfast', 'Lunch', 'Evening Snack', 'Dinner'] as const
export const APPLIANCES: Appliance[] = ['Egg Boiler', 'Pan', 'Kettle']

export const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}
export const DAY_FOCUS: Record<DayKey, string> = {
  mon: 'Shoulders', tue: 'Biceps', wed: 'Lats / Back', thu: 'Triceps', fri: 'Chest', sat: 'Legs',
  sun: 'Active Recovery + Weekly Review',
}
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const ex = (id: string, name: string, sets: number, reps: string): Exercise => ({ id, name, sets, reps })

export const DEFAULT_GYM_PLAN: Record<DayKey, Exercise[]> = {
  mon: [
    ex('mon-ohp', 'Overhead Press', 4, '8-10'),
    ex('mon-lat', 'Lateral Raise', 4, '12-15'),
    ex('mon-rear', 'Rear Delt Fly', 3, '15'),
    ex('mon-front', 'Front Raise', 3, '12'),
    ex('mon-shrug', 'Dumbbell Shrugs', 3, '12'),
  ],
  tue: [
    ex('tue-bb', 'Barbell Curl', 4, '8-10'),
    ex('tue-inc', 'Incline Dumbbell Curl', 3, '10-12'),
    ex('tue-ham', 'Hammer Curl', 3, '12'),
    ex('tue-pre', 'Preacher / Concentration Curl', 3, '12'),
    ex('tue-cab', 'Cable Curl', 2, '15'),
  ],
  wed: [
    ex('wed-pd', 'Lat Pulldown', 4, '10'),
    ex('wed-row', 'Seated Cable Row', 4, '8-10'),
    ex('wed-pu', 'Assisted Pull-ups', 3, '8'),
    ex('wed-db', 'One-arm Dumbbell Row', 3, '10'),
    ex('wed-fp', 'Face Pull', 3, '12-15'),
  ],
  thu: [
    ex('thu-cg', 'Close-grip Bench Press', 4, '8-10'),
    ex('thu-rope', 'Rope Pushdown', 4, '12'),
    ex('thu-oh', 'Overhead Triceps Extension', 3, '12'),
    ex('thu-dip', 'Bench Dips', 3, '12'),
    ex('thu-kb', 'Triceps Kickback', 2, '15'),
  ],
  fri: [
    ex('fri-bp', 'Flat Bench Press', 4, '8-10'),
    ex('fri-inc', 'Incline Dumbbell Press', 4, '10'),
    ex('fri-fly', 'Cable Fly', 3, '12'),
    ex('fri-pec', 'Pec Deck', 3, '12'),
    ex('fri-pu', 'Push-ups', 2, 'AMRAP'),
  ],
  sat: [
    ex('sat-sq', 'Squat', 4, '8-10'),
    ex('sat-lp', 'Leg Press', 4, '10-12'),
    ex('sat-rdl', 'Romanian Deadlift', 3, '10'),
    ex('sat-lc', 'Leg Curl', 3, '12'),
    ex('sat-calf', 'Standing Calf Raise', 4, '15'),
  ],
  sun: [], // active recovery — handled as a checklist, see Body page
}

export const SUNDAY_REVIEW = [
  { id: 'sun-stretch', label: '20-min stretch / mobility flow' },
  { id: 'sun-walk', label: 'Easy walk (no weights)' },
  { id: 'sun-budget', label: 'Review the week\'s spending vs safe limit' },
  { id: 'sun-sweep', label: 'Sweep unspent weekly money into Savings' },
  { id: 'sun-list', label: 'Check kitchen stock & plan next week\'s grocery list' },
  { id: 'sun-prep', label: 'Pick 3 priorities for Monday' },
]

export const MINIMUM_DAY_MOBILITY = [
  { id: 'mob-neck', label: '5 min neck & shoulder rolls' },
  { id: 'mob-body', label: '10 slow squats + 10 wall push-ups' },
  { id: 'mob-stretch', label: '5 min hamstring / quad stretch' },
]

export const DEFAULT_HABITS: Habit[] = [
  { id: 'walk', label: '60-min round-trip walk to gym', stepCredit: 5500 },
  { id: 'amla', label: 'Morning amla / lemon water' },
  { id: 'gym', label: 'Gym session done' },
  { id: 'protein', label: 'Hit protein target' },
  { id: 'log', label: 'Log every expense' },
  { id: 'sleep', label: 'In bed by 11 PM' },
]

export const DEFAULT_PRESETS: QuickPreset[] = [
  { id: 'p1', title: 'Chai / snack', amount: 20, category: 'Outside Food' },
  { id: 'p2', title: 'Auto ride', amount: 60, category: 'Rides' },
  { id: 'p3', title: 'Metro / bus', amount: 30, category: 'Rides' },
  { id: 'p4', title: 'Veg & eggs run', amount: 120, category: 'Groceries' },
  { id: 'p5', title: 'Movie ticket', amount: 250, category: 'Movies/Dates' },
  { id: 'p6', title: 'Coffee date', amount: 300, category: 'Movies/Dates' },
]

// ---------- 4-week micronutrient rotator (pan + kettle + egg boiler only) ----------

// Prices are deliberately NOT pre-filled — you enter what you actually pay (they're remembered per item).
const it = (
  id: string, name: string, qty: string, _price: number, appliances: Appliance[], nutrient: string,
  pantryKey?: string, shelfLifeDays?: number,
) => ({ id, name, qty, price: 0, appliances, nutrient, pantryKey, shelfLifeDays })

export const GROCERY_WEEKS: GroceryWeek[] = [
  {
    index: 0, title: 'Week 1', focus: 'Iron, Vitamin C & Protein', target: 600,
    items: [
      it('w1-eggs', 'Eggs', '21 (3/day)', 147, ['Egg Boiler'], 'Complete protein, B12, choline'),
      it('w1-spinach', 'Spinach / palak', '3 bunches', 45, ['Pan'], 'Iron, folate, magnesium'),
      it('w1-tomato', 'Tomatoes', '1 kg', 40, ['Pan'], 'Vitamin C, lycopene'),
      it('w1-onion', 'Onions', '1 kg', 38, ['Pan'], 'Prebiotic fibre, quercetin'),
      it('w1-amla', 'Amla', '250 g', 40, ['Kettle'], 'Vitamin C (boosts iron absorption)'),
      it('w1-lemon', 'Lemons', '5', 25, ['Kettle'], 'Vitamin C — warm lemon water'),
      it('w1-banana', 'Bananas', '12', 60, [], 'Potassium, quick carbs'),
      it('w1-peanut', 'Raw peanuts', '400 g', 64, ['Pan'], 'Protein, niacin, healthy fats', 'peanuts', 21),
      it('w1-curd', 'Curd', '750 g', 55, [], 'Protein, calcium, probiotics'),
      it('w1-spice', 'Spices & oil starter (turmeric, chilli, salt, 250 ml oil)', '1 set', 70, ['Pan'],
        'Cooking base — lasts ~4 weeks', 'spices', 28),
    ],
  },
  {
    index: 1, title: 'Week 2', focus: 'Zinc, Magnesium & B-Complex', target: 600,
    items: [
      it('w2-chicken', 'Chicken curry-cut', '500 g', 115, ['Pan'], 'Zinc, B6, B12, lean protein'),
      it('w2-pumpkin', 'Pumpkin seeds', '50 g', 45, [], 'Zinc, magnesium', 'pumpkin-seeds', 30),
      it('w2-sunflower', 'Sunflower seeds', '100 g', 50, [], 'Vitamin E, B1, magnesium', 'sunflower-seeds', 30),
      it('w2-moong', 'Green moong (sprout it)', '250 g', 40, ['Kettle', 'Pan'], 'B-complex, folate, magnesium'),
      it('w2-sweet', 'Sweet potatoes', '1 kg', 60, ['Pan'], 'Complex carbs, vitamin A'),
      it('w2-atta', 'Whole-wheat atta', '1 kg', 50, ['Pan'], 'B-complex, fibre, zinc', 'atta', 28),
      it('w2-rice', 'Rice', '1 kg', 55, ['Pan'], 'Clean carbs for mass', 'rice', 28),
      it('w2-eggs', 'Eggs', '14 (2/day)', 98, ['Egg Boiler'], 'Protein, B12'),
      it('w2-base', 'Onion, tomato, ginger-garlic', '1 set', 50, ['Pan'], 'Cooking base'),
      it('w2-banana', 'Bananas', '6', 30, [], 'Potassium'),
    ],
  },
  {
    index: 2, title: 'Week 3', focus: 'Calcium, Potassium & Vitamin D/E', target: 600,
    items: [
      it('w3-paneer', 'Paneer', '250 g', 90, ['Pan'], 'Calcium, casein protein'),
      it('w3-milk', 'Toned milk', '2 L (4 × 500 ml)', 96, ['Kettle'], 'Calcium, vitamin D, B2'),
      it('w3-almonds', 'Almonds', '50 g', 40, [], 'Vitamin E, magnesium', 'almonds', 30),
      it('w3-raisins', 'Black raisins', '100 g', 40, [], 'Iron, potassium', 'raisins', 30),
      it('w3-carrot', 'Carrots', '500 g', 35, ['Pan'], 'Beta-carotene (vitamin A)'),
      it('w3-capsicum', 'Capsicum', '500 g', 50, ['Pan'], 'Vitamin C'),
      it('w3-coconut', 'Tender coconut water', '1', 40, [], 'Potassium, electrolytes'),
      it('w3-eggs', 'Eggs', '14 (2/day)', 98, ['Egg Boiler'], 'Vitamin D, protein'),
      it('w3-banana', 'Bananas', '12', 60, [], 'Potassium'),
      it('w3-base', 'Onion & tomato', '1 set', 26, ['Pan'], 'Cooking base'),
    ],
  },
  {
    index: 3, title: 'Week 4', focus: 'Omega-3, Folate & Gut Recovery', target: 600,
    items: [
      it('w4-flax', 'Flax seeds', '100 g', 30, [], 'Omega-3 (ALA), fibre', 'flax', 30),
      it('w4-chia', 'Chia seeds', '50 g', 40, [], 'Omega-3, calcium', 'chia', 30),
      it('w4-soya', 'Soya chunks', '400 g', 60, ['Kettle', 'Pan'], 'Plant protein, iron'),
      it('w4-eggs', 'Eggs', '21 (3/day)', 147, ['Egg Boiler'], 'Protein, choline'),
      it('w4-beet', 'Beetroot', '500 g', 30, ['Pan'], 'Folate, nitrates'),
      it('w4-orange', 'Oranges', '4', 50, [], 'Vitamin C, folate'),
      it('w4-guava', 'Guava', '500 g', 40, [], 'Vitamin C, fibre'),
      it('w4-jaggery', 'Jaggery', '250 g', 25, ['Kettle'], 'Iron, quick energy', 'jaggery', 30),
      it('w4-curd', 'Curd', '1 kg', 70, [], 'Probiotics for gut recovery'),
      it('w4-banana', 'Bananas', '6', 30, [], 'Potassium, prebiotic fibre'),
      it('w4-base', 'Onion, tomato, ginger-garlic', '1 set', 55, ['Pan'], 'Cooking base'),
      it('w4-green', 'Green chillies & coriander', '1 bunch', 13, ['Pan'], 'Vitamin C, folate'),
    ],
  },
]

export const ALL_GROCERY_ITEMS = GROCERY_WEEKS.flatMap((w) => w.items)

// ---------- Food-crisis meal bank (approx. Bengaluru prices, protein is an estimate) ----------

export interface CrisisMeal {
  id: string
  title: string
  cost: number
  protein: number
  appliances: Appliance[]
  minutes: number
  how: string
}

export const CRISIS_MEALS: CrisisMeal[] = [
  { id: 'cm1', title: '4 boiled eggs + 2 bananas', cost: 38, protein: 26, appliances: ['Egg Boiler'], minutes: 12,
    how: 'Boil 4 eggs in the egg boiler. Eat with 2 bananas.' },
  { id: 'cm2', title: 'Soya chunks masala + rice', cost: 28, protein: 30, appliances: ['Kettle', 'Pan'], minutes: 20,
    how: 'Soak 60 g soya chunks in kettle-hot water 10 min, squeeze, sauté with onion-tomato, serve with rice.' },
  { id: 'cm3', title: '3-egg onion-tomato bhurji + rice', cost: 36, protein: 22, appliances: ['Pan'], minutes: 12,
    how: 'Sauté onion + tomato, scramble in 3 eggs, serve with rice.' },
  { id: 'cm4', title: 'Peanuts + banana + warm milk', cost: 34, protein: 24, appliances: ['Kettle'], minutes: 5,
    how: 'No cooking: 50 g peanuts, 2 bananas, 250 ml milk warmed in the kettle.' },
  { id: 'cm5', title: 'Curd rice + 2 boiled eggs', cost: 30, protein: 19, appliances: ['Egg Boiler'], minutes: 12,
    how: 'Boil eggs, mix cooked rice with curd and salt.' },
  { id: 'cm6', title: 'Sprouted moong sabzi', cost: 18, protein: 14, appliances: ['Pan'], minutes: 15,
    how: 'Sauté sprouted moong with onion, tomato, turmeric and chilli.' },
  { id: 'cm7', title: 'Egg curry (3 eggs) + rice', cost: 42, protein: 24, appliances: ['Egg Boiler', 'Pan'], minutes: 25,
    how: 'Boil eggs, make onion-tomato masala in the pan, add eggs and simmer 5 min.' },
  { id: 'cm8', title: 'Paneer bhurji + 2 chapati', cost: 62, protein: 28, appliances: ['Pan'], minutes: 20,
    how: 'Crumble 100 g paneer into a spiced onion-tomato base; roll and pan-cook chapati.' },
  { id: 'cm9', title: 'Chicken curry (pan) + rice', cost: 72, protein: 38, appliances: ['Pan'], minutes: 35,
    how: '150 g chicken curry-cut, onion-tomato masala, cover and cook 20 min.' },
  { id: 'cm10', title: 'Boiled peanuts + jaggery + lemon water', cost: 16, protein: 12, appliances: ['Kettle'], minutes: 8,
    how: 'Boil peanuts in the kettle water, eat with a bit of jaggery; warm lemon water on the side.' },
]

// ---------- default app state ----------

export function makeDefaultState(): AppState {
  return {
    version: STATE_VERSION,
    // Epoch on purpose: a brand-new device must never look newer than data already saved on the server.
    updatedAt: new Date(0).toISOString(),
    startedOn: toISO(new Date()),
    profile: {
      name: 'Me',
      age: 23,
      gender: 'Male',
      weightKg: 51,
      goal: 'Muscle gain — 6-day gym split + 60-min round-trip walk',
      city: 'Bengaluru',
      living: 'PG',
      appliances: ['Electric Kettle', 'Egg Boiler', '1 Cooking Pan'],
    },
    finance: {
      salary: 25160,
      rent: 9500,
      fixed: 3000,
      savings: 5000,
      paydayDay: 8,
      rentDueDay: 10,
      debtDueDay: 12,
      fixedDueDay: 15,
      buckets: { groceries: 2400, lifestyle: 1600, buffer: 1000 },
      debtTotal: 6000,
      debtPlanMonthly: 2000,
      debtPlanMonths: 3,
      autoSweep: true,
    },
    targets: {
      waterMl: 2750,
      glassMl: 250,
      steps: 9500,
      walkCredit: 5500,
      proteinG: 95,
      minWaterMl: 2000,
      minSteps: 5500,
    },
    settings: { quickPresets: DEFAULT_PRESETS, notifications: false, onboarded: false },
    habits: DEFAULT_HABITS,
    expenses: [],
    topups: [],
    sweeps: [],
    debtPayments: [],
    salaries: {},
    paid: {},
    tasks: [],
    dismissedAuto: {},
    pantry: {},
    outOfStock: {},
    checked: {},
    priceOverrides: {},
    checkouts: [],
    meals: [],
    gymPlan: DEFAULT_GYM_PLAN,
    workouts: {},
    dayLogs: {},
    journal: {},
    survival: { active: false },
    crisisEvents: [],
  }
}
