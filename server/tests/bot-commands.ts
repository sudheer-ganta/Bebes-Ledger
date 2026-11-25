import { hydrate } from '../../client/src/lib/hydrate'
import { runCommand } from '../src/bot/commands'

process.env.TZ = 'Asia/Kolkata'
let state = hydrate(null)
const now = new Date()
const say = (msg: string) => {
  const r = runCommand(state, msg, now)
  state = r.state
  console.log(`> ${msg}\n${r.reply}\n`)
}

for (const m of [
  '@help',
  '@spent 120 auto',          // before salary: no pool yet
  '@salary 25160',
  '@spent 120 auto',
  '250 movie with friends',
  'chai 20',
  '@veg 150 #groceries',
  '@water 500',
  '@glass',
  '@water 1',
  '@steps 3000',
  '@steps set 6000',
  '@walk',
  '@ate 3 eggs p20',
  '@task buy soap tomorrow',
  '@task pay recharge !',
  '@tasks',
  '@done soap',
  '@debt 2000',
  '@today',
  '@undo',
  'blah blah',
]) say(m)

// ---------- regression checks: each line is a message that used to go wrong ----------
{
  const day = new Date(2026, 10, 25, 10, 0) // a Wednesday morning
  let s = runCommand(hydrate(null), 'salary 25160', day).state
  let failed = 0
  const check = (msg: string, ok: (r: ReturnType<typeof runCommand>, before: typeof s) => boolean, why: string) => {
    const before = s
    const r = runCommand(s, msg, day)
    s = r.state
    const pass = ok(r, before)
    if (!pass) failed++
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${msg.padEnd(22)} ${why}${pass ? '' : `\n     got: ${r.reply.split('\n')[0]}`}`)
  }
  const lastExp = () => s.expenses[s.expenses.length - 1]
  const expenseAdded = (amount: number, category?: string) => (r: ReturnType<typeof runCommand>, b: typeof s) =>
    r.changed && s.expenses.length === b.expenses.length + 1 && lastExp().amount === amount && (!category || lastExp().category === category)
  const noExpense = (r: ReturnType<typeof runCommand>, b: typeof s) => s.expenses.length === b.expenses.length

  check('500 gm paneer 120', expenseAdded(120, 'Groceries'), '₹120 groceries, not a greeting')
  check('300 shoes', expenseAdded(300), 'logged, not a shoes quote')
  check('200 party', expenseAdded(200, 'Movies/Dates'), 'logged, not RSVP quote')
  check('1500 dress', expenseAdded(1500), 'logged, not style quote')
  check('wine 400', expenseAdded(400), 'logged, not wine quote')
  check('chicken biryani 250', expenseAdded(250, 'Outside Food'), 'cooked food beats raw chicken')
  check('drank 2', (r, b) => noExpense(r, b) && r.reply.includes('mL'), 'water, not ₹2')
  check('drink 500', (r, b) => noExpense(r, b) && r.reply.includes('mL'), 'water, not ₹500')
  check('w 500', (r, b) => noExpense(r, b) && r.reply.includes('mL'), 'water, not ₹500')
  check('had 3 eggs p20', (r, b) => noExpense(r, b) && s.meals.length === b.meals.length + 1, 'meal, not ₹3')
  check('walked 5000', (r, b) => noExpense(r, b) && r.reply.includes('paces'), 'steps, not ₹5000')
  check('i walked 5000 steps', noExpense, 'not an expense')
  check('task review budget', (r, b) => s.tasks.length === b.tasks.length + 1, 'task added')
  check('task morning run', (r, b) => s.tasks.length === b.tasks.length + 1, 'task added, not a greeting')
  check('task buy folder', (r, b) => s.tasks.length === b.tasks.length + 1, 'task added, not cheese quote')
  check('how much water', (r) => r.reply.startsWith('💧'), 'water status, not budget')
  check('pay rent 8000', (r, b) => noExpense(r, b) && Object.values(s.paid).some(Boolean), 'rent marked paid, not pocket spend')
  check('tasks', (r) => r.reply.includes('1.'), 'numbered list')
  check('done 1', (r) => r.changed && r.reply.includes('Vanquished'), 'number from the list works')
  check('good morning', (r) => !r.changed && !r.reply.includes('Logged'), 'greeting')
  check('fold in the cheese', (r) => r.reply.includes('FOLD IT IN'), 'quote still works as a whole word')
  check('undo', (r, b) => s.expenses.length === b.expenses.length - 1, 'removes last chat expense')
  if (failed) {
    console.error(`\n${failed} regression check(s) failed`)
    process.exit(1)
  }
  console.log('\nall regression checks passed')
}
