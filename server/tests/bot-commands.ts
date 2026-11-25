import { hydrate } from '../../client/src/lib/hydrate'
import { emptyMemory, runCommand } from '../src/bot/commands'

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

// ---------- option 1: data-aware, natural-language Moira ----------
{
  const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m)
  let s = runCommand(hydrate(null), 'salary 25160', at(9)).state
  let mem = emptyMemory()
  let failed = 0
  const check = (when: Date, msg: string, ok: (reply: string, changed: boolean) => boolean, why: string) => {
    const r = runCommand(s, msg, when, mem)
    s = r.state
    mem = r.memory
    const pass = ok(r.reply, r.changed)
    if (!pass) failed++
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${msg.padEnd(34)} ${why}${pass ? '' : `\n     got: ${r.reply.replace(/\n/g, ' | ')}`}`)
  }
  const last = () => s.expenses[s.expenses.length - 1]

  check(at(8), 'good morning', (r) => r.includes('💰 Today:'), 'first greeting gives the day plan')
  check(at(9), 'gave 300 to rahul for lunch', (r, c) => c && last().amount === 300 && last().title === 'rahul lunch' && last().category === 'Outside Food', 'long sentence logged, clean title')
  check(at(9), 'i spent 200 on chai and samosa', (r, c) => c && last().amount === 200 && last().category === 'Outside Food', 'sentence with "i spent"')
  check(at(9), 'paid rs 80 for auto', (r, c) => c && last().amount === 80 && last().category === 'Rides', '"rs 80" understood')
  check(at(10), 'what did i spend today', (r) => r.includes('₹580') && r.includes('rahul lunch'), 'lists today with total')
  check(at(10), 'spent yesterday?', (r) => r.includes('yesterday'), 'yesterday')
  check(at(10), 'can i afford a movie for 400', (r, c) => !c && /weekend fund/i.test(r), 'answers from weekend fund, logs nothing')
  check(at(10), 'can i spend 50000', (r, c) => !c && r.startsWith('Absolutely not'), 'refuses big spend')
  check(at(10), 'can i afford 500?', (r, c) => !c, 'question is never logged')
  check(at(15), 'hi', (r) => r.includes('\n') && /today|water/.test(r), 'afternoon hi adds a line about your day')
  check(at(23, 30), 'hey', (r) => /11:30|this late/.test(r), 'late-night greeting')
  check(at(15), 'how am i doing', (r) => r.includes('📋') && r.includes('💧'), 'day report')
  check(at(14), 'good morning', (r) => r.includes('2:00'), 'late "morning" gets teased with the time')
  check(at(22), 'good night', (r) => r.includes('📋') && /out of three|flawless|catastrophe/.test(r), 'night wrap-up with verdict')
  // memory: same group should not repeat within 3 picks
  const seen: string[] = []
  for (let i = 0; i < 4; i++) {
    const r = runCommand(s, 'blah blah', at(9), mem)
    mem = r.memory
    seen.push(r.reply.split('\n')[0])
  }
  const noRepeat = new Set(seen).size === seen.length
  if (!noRepeat) failed++
  console.log(`${noRepeat ? 'ok  ' : 'FAIL'} ${'4× blah blah'.padEnd(34)} no repeated line across 4 replies (memory carried)`)

  if (failed) {
    console.error(`\n${failed} option-1 check(s) failed`)
    process.exit(1)
  }
  console.log('\nall option-1 checks passed')
}

// ---------- before salary: Moira says you're broke, never quotes a made-up daily plan ----------
{
  const at = new Date(2026, 10, 25, 12, 32)
  let s = hydrate(null) // no salary entered
  let failed = 0
  for (const msg of ['how much money i have ?', 'how much money do i have left', 'budget', 'today', 'auto 40', 'can i afford a movie for 400', 'am i broke']) {
    const r = runCommand(s, msg, at)
    s = r.state
    const ok = r.reply.includes('No salary until') && !/plan is|\/day|left today/i.test(r.reply)
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg.padEnd(32)} broke reply, no plan${ok ? '' : `\n     got: ${r.reply.replace(/\n/g, ' | ')}`}`)
  }
  if (failed) {
    console.error(`\n${failed} pre-salary check(s) failed`)
    process.exit(1)
  }
  console.log('\nall pre-salary checks passed')
}
