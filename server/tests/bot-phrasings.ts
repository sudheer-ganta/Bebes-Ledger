// Everyday ways of saying things, each checked against what actually changed in the data.
// "unsure" means the rules only guessed, so the server hands it to Gemini when it's on.
import { hydrate } from '../../client/src/lib/hydrate'
import { dayStats } from '../../client/src/lib/day'
import { toISO } from '../../client/src/lib/date'
import type { AppState } from '../../client/src/types'
import { emptyMemory, runCommand } from '../src/bot/commands'

process.env.TZ = 'Asia/Kolkata'
const now = new Date('2026-11-26T18:00:00+05:30')
const today = toISO(now)
// before salary, 6,065 steps and 2 L water so far (yesterday's chat)
const base = runCommand(runCommand(hydrate(null), 'steps 6065', now).state, 'water 2000', now).state
let failed = 0

type R = ReturnType<typeof runCommand>
const view = (s: AppState) => ({ ...dayStats(s, today), exp: s.expenses.length, meals: s.meals.filter((m) => m.date === today), walk: !!s.dayLogs[today]?.habits?.walk })
function expect(msg: string, ok: (after: ReturnType<typeof view>, r: R) => boolean, why: string, from = base) {
  const r = runCommand(from, msg, now)
  const after = view(r.state)
  const pass = ok(after, r)
  if (!pass) failed++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${msg.padEnd(40)} ${why}${pass ? '' : `\n     got steps=${after.steps} water=${after.waterMl} exp=${after.exp} meals=${after.meals.length} unsure=${!!r.unsure} | ${r.reply.split('\n')[0]}`}`)
}
const noMoney = (a: ReturnType<typeof view>) => a.exp === 0

// steps: add, remove, set, clear
expect('remove 1000 steps', (a) => a.steps === 5065, 'subtracts')
expect('reduce steps by 500', (a) => a.steps === 5565, 'subtracts')
expect('minus 500 steps', (a) => a.steps === 5565, 'subtracts')
expect('delete 1000 steps', (a) => a.steps === 5065, 'subtracts')
expect('steps -500', (a) => a.steps === 5565, 'negative number subtracts')
expect('i added 1000 steps by mistake', (a) => a.steps === 5065, '"by mistake" subtracts')
expect('my steps are 5000', (a) => a.steps === 5000, 'sets total')
expect('steps are wrong its 5000', (a) => a.steps === 5000, 'sets total')
expect('actually i walked only 5000 steps', (a) => a.steps === 5000, 'sets total')
expect('set steps to 5000', (a) => a.steps === 5000, 'sets total')
expect('make steps 5000', (a) => a.steps === 5000, 'sets total')
expect('steps set 6000', (a) => a.steps === 6000, 'old command still works')
expect('not 6065 steps, its 4000', (a) => a.steps === 4000, 'last number wins on a correction')
expect('i walked 2000 steps', (a) => a.steps === 8065, 'adds')
expect('did 3000 steps', (a) => a.steps === 9065, 'adds')
expect('walked 2k', (a) => a.steps === 8065, 'adds 2k')
expect('steps 3000', (a) => a.steps === 9065, 'old command still adds')
expect('500 more steps', (a) => a.steps === 6565 && noMoney(a), 'adds, not ₹500')
expect('reset steps', (a) => a.steps === 0 && noMoney(a), 'clears steps, never expenses')
expect('clear steps', (a) => a.steps === 0, 'clears steps')
expect('undo steps', (a, r) => a.steps === 6065 && !!r.unsure, 'no history to undo: asks for the total (Gemini can do it)')
expect('how many steps', (a, r) => a.steps === 6065 && r.reply.includes('6,065'), 'question just answers')

// water
expect('i drank 2 glasses', (a) => a.waterMl === 2500 && noMoney(a), '2 × 250 mL, not ₹2')
expect('drank a bottle of water', (a) => a.waterMl === 3000, 'a bottle is 1 L')
expect('had a glass of water', (a) => a.waterMl === 2250 && a.meals.length === 0, 'water, not a meal')
expect('water is 1.5l actually', (a) => a.waterMl === 1500, 'sets total')
expect('remove 500ml water', (a) => a.waterMl === 1500, 'subtracts')
expect('undo water', (a) => a.waterMl === 0, 'removes the last entry (the 2 L)')
expect('reset water', (a) => a.waterMl === 0 && noMoney(a), 'clears water, never expenses')
expect('water 500', (a) => a.waterMl === 2500, 'old command')
expect('water 1', (a) => a.waterMl === 3000, 'small number is litres')
expect('750ml water', (a) => a.waterMl === 2750 && noMoney(a), 'unit first')
expect('water bottle 20', (a) => a.waterMl === 2000 && a.exp === 1, 'buying a bottle is an expense')
expect('how much water', (a, r) => a.waterMl === 2000 && r.reply.includes('2 L'), 'question just answers')
expect('2 glasses of milk', (a) => a.waterMl === 2000, 'milk is not water')

// meals
expect('ate two eggs drank half glass milk', (a, r) => a.meals[0]?.protein === 16 && !r.unsure, '16 g, sure of it')
expect('i ate 2 rotis and dal', (a) => a.meals[0]?.protein === 15, '2×3 + 9')
expect('i had 3 idlis and sambar', (a) => a.meals[0]?.protein === 18, '3×3 + 9')
expect('2 eggs', (a) => a.meals[0]?.protein === 12 && noMoney(a), 'meal, not ₹2')
expect('ate 3 eggs p20', (a, r) => a.meals[0]?.protein === 20 && !r.unsure, 'given protein wins')
expect('ate 30 protein paneer', (a) => a.meals[0]?.protein === 30, '"30 protein" is protein')
expect('ate maggi', (a, r) => a.meals.length === 1 && !!r.unsure, 'unknown food: logged, Gemini re-estimates')
expect('had chicken biryani 250', (a, r) => a.meals[0]?.cost === 250 && a.exp === 1 && !!r.unsure, '250 is the price, biryani is a guess')
expect('had lunch at mess', (a, r) => a.meals.length === 1 && !!r.unsure, 'no food named: Gemini asks/estimates')
expect('2 samosas', (a, r) => noMoney(a) && !!r.unsure, 'not ₹2; Gemini decides')

// done / tasks
expect('done sir', (a, r) => !r.reply.includes('phantom') && !!r.unsure, 'polite word ignored; Gemini picks from chat')
expect('done', (a, r) => !!r.unsure, 'which one: Gemini picks from chat')
expect('done the walk', (a) => a.walk && a.steps === 11565, 'walk habit ticked (+5,500)')
expect('i finished the steps', (a, r) => !!r.unsure, 'no number: Gemini works it out')

// money still works
expect('rapido 117 and uber 112', (a) => a.exp === 2, 'two rides')
expect('spent 120 auto', (a) => a.exp === 1, 'expense')
expect('chai 10', (a) => a.exp === 1, 'cheap expense with the price after')
expect('I took 500 from my frnd', (a, r) => noMoney(a) && r.state.finance.debtTotal === base.finance.debtTotal + 500, 'not an expense: added to debt')
expect('undo', (a) => a.exp === 0, 'expense undo still works', runCommand(base, 'chai 20', now).state)

// ---------------------------------------------------------------- the messy real world
// typos, Hinglish, casing, units
expect('REMOVE 1000 STEPS', (a) => a.steps === 5065, 'caps')
expect('remove 1,000 steps', (a) => a.steps === 5065, 'comma in the number')
expect('remov 1000 stpes', (a) => a.steps === 5065 && noMoney(a), 'typos: steps, never ₹1,000')
expect('steps kam karo 1000', (a) => a.steps === 5065, 'Hinglish: kam = less')
expect('1000 steps kam karo', (a) => a.steps === 5065, 'Hinglish, number first')
expect('mere steps 5000 hai', (a) => a.steps === 5000, 'Hinglish: hai = is')
expect('steps galat hai 5000 hai', (a) => a.steps === 5000, 'Hinglish: galat = wrong')
expect('i walked 5000 steps today not 6065', (a) => a.steps === 5000, '"not 6065" is the wrong one')
expect('change steps from 6065 to 5000', (a) => a.steps === 5000, '"from X to Y" sets Y')
expect('steps 6065 to 5065', (a) => a.steps === 5065, '"X to Y" sets Y')
expect('can you make my steps 5000', (a) => a.steps === 5000, 'a request, not a question')
expect('steps: 5000', (a) => a.steps === 5000, 'colon sets')
expect('steps = 5000', (a) => a.steps === 5000, 'equals sets')
expect('walked 3 km', (a) => a.steps === 6065 + 3900, '~1,300 steps a km')
expect('walked for 30 mins', (a) => a.steps === 9065, '~100 steps a minute ("mins" is not "minus")')
expect('water kam karo 500', (a) => a.waterMl === 1500, 'Hinglish water')
expect('pani piya 1 glass', (a) => a.waterMl === 2250, 'pani = water')
expect('drank water', (a) => a.waterMl === 2250, 'no amount: a glass')
expect('drank 2', (a) => a.waterMl === 4000, 'old shorthand: litres')

// the walk
expect('walk done', (a) => a.walk, 'walk habit')
expect('did my walk', (a) => a.walk, 'walk habit')
expect('gym walk done ✅', (a) => a.walk, 'walk habit, not the gym plan')
expect('i walked to gym and back', (a) => a.walk, 'walk habit')
expect('went for a walk', (a, r) => !a.walk && !!r.unsure, 'which walk? asks')

// things that must NOT log anything
for (const m of ['i will do it later', 'class at 5', 'meeting at 3 pm', 'call mom at 8', 'i am 25 years old', 'watched 2 movies', 'he has 3 kids',
  'slept 7 hours', 'i walked 2 dogs', 'my salary is 25160 right', 'salary day is 8th', 'give me 3 meal ideas', 'should i walk 10000 steps',
  'i want to walk 5 km tomorrow', 'going to drink more water', 'i will eat 3 eggs tomorrow', 'the water was cold', 'i spilled a glass of water',
  'glass broke', 'thinking of ordering pizza 300', 'tomorrow i will buy groceries 500', 'i want to buy headphones 1500', 'i need 500 rupees',
  'is 2l water enough', 'can i drink 3 litres', 'bought 2 shirts', 'I took 500 from my frnd', 'borrowed 500 from rahul', 'rahul gave me 500']) {
  expect(m, (a) => a.steps === 6065 && a.waterMl === 2000 && a.exp === 0 && a.meals.length === 0 && !a.walk, 'nothing logged')
}
expect('task walk 5000 steps', (a, r) => a.steps === 6065 && r.state.tasks.some((t) => t.title === 'walk 5000 steps'), 'a task, not steps')
expect('remind me to drink water', (a, r) => a.waterMl === 2000 && r.state.tasks.some((t) => t.title === 'drink water'), 'a task, not water')

// purchases with quantities
expect('6 eggs 48', (a, r) => r.state.expenses.at(-1)?.amount === 48, '₹48, not ₹6')
expect('2 dozen eggs 150', (a, r) => r.state.expenses.at(-1)?.amount === 150, '₹150')
expect('1 tray eggs 210', (a, r) => r.state.expenses.at(-1)?.amount === 210, '₹210, not ₹1')
expect('water can 40', (a, r) => a.waterMl === 2000 && r.state.expenses.at(-1)?.amount === 40, 'a can of water is bought, not drunk')
expect('uber 112rs', (a, r) => r.state.expenses.at(-1)?.amount === 112, '"112rs"')
expect('auto 40 chai 20', (a, r) => a.exp === 2, 'two expenses without a comma')

// meals
expect('ate 3 egss', (a) => a.meals[0]?.protein === 18, 'typo eggs')
expect('breakfast 2 eggs and bread', (a) => a.meals[0]?.slot === 'Breakfast' && a.meals[0]?.protein === 15 && noMoney(a), 'breakfast meal, not ₹2')
expect('breakfast: oats with milk', (a) => a.meals[0]?.slot === 'Breakfast' && a.meals[0]?.protein === 15, 'slot from the message')
expect('lunch rice dal curd', (a) => a.meals[0]?.slot === 'Lunch' && a.meals[0]?.protein === 19, 'lunch meal')
expect('dinner 3 roti paneer', (a) => a.meals[0]?.slot === 'Dinner' && noMoney(a), 'dinner meal, not ₹3')
expect('for lunch i had chicken rice', (a) => a.meals[0]?.slot === 'Lunch' && a.meals[0]?.protein === 29, 'lunch meal')
expect('ate chicken 200g', (a) => a.meals[0]?.protein === 50, '25 g per 100 g')
expect('ate 150g paneer', (a) => a.meals[0]?.protein === 27, '18 g per 100 g')
expect('had 4 egg whites', (a) => a.meals[0]?.protein === 14, '3.5 g each')
expect('drank a protein shake', (a) => a.meals[0]?.protein === 24 && a.waterMl === 2000, 'a shake is food, not water')
expect('whey 1 scoop', (a) => a.meals[0]?.protein === 24 && noMoney(a), 'one scoop, not ₹1')
expect('chai and biscuit', (a) => a.meals.length === 1 && noMoney(a), 'a snack')
expect('protein 20', (a) => a.meals[0]?.protein === 20, 'protein on its own')
expect('add 20g protein', (a, r) => a.meals[0]?.protein === 20 && r.state.tasks.length === base.tasks.length, 'protein, not a task')
{
  const withMeal = runCommand(base, 'ate chicken biryani 250', now).state
  expect('undo meal', (a) => a.meals.length === 0 && a.exp === 0, 'removes the meal and its ₹250', withMeal)
  expect('delete dinner', (a) => a.meals.length === 1, 'no dinner logged: nothing removed', withMeal)
}

// expenses: fix and remove by name
{
  const rides = runCommand(base, 'rapido 117 and uber 112', now).state
  expect('that rapido was 107 not 117', (a, r) => r.state.expenses.find((e) => e.title === 'rapido')?.amount === 107, 'amount fixed', rides)
  expect('remove rapido', (a, r) => a.exp === 1 && r.state.expenses[0].title === 'uber', 'only the rapido removed', rides)
  expect('delete the uber expense', (a, r) => a.exp === 1 && r.state.expenses[0].title === 'rapido', 'only the uber removed', rides)
  expect('clear steps', (a) => a.exp === 2 && a.steps === 0, 'clears steps, keeps expenses', rides)
}

// several kinds of thing in one message
expect('drank 500ml and walked 2000 steps', (a) => a.waterMl === 2500 && a.steps === 8065, 'water + steps')
expect('ate 2 eggs and drank 1 glass water', (a) => a.meals[0]?.protein === 12 && a.waterMl === 2250, 'meal + water')
expect('walked 3000 steps, drank 2 glasses, ate 3 eggs', (a) => a.steps === 9065 && a.waterMl === 2500 && a.meals[0]?.protein === 18, 'all three')
expect('spent 200 on lunch and walked 4000 steps', (a) => a.exp === 1 && a.steps === 10065, 'expense + steps (not 200 steps)')
expect('chai 20 and 1 glass water', (a) => a.exp === 1 && a.waterMl === 2250, 'expense + water')
expect('ate 2 rotis and dal', (a) => a.meals.length === 1, 'one meal, not split')

// salary, rent, tasks, kitchen
expect('got salary 25160', (a, r) => a.exp === 0 && Object.keys(r.state.salaries).length === 1, 'salary received, not ₹25,160 spent')
expect('i got 25160 salary', (a, r) => a.exp === 0 && Object.keys(r.state.salaries).length === 1, 'salary received')
expect('salary credited 25,160', (a, r) => Object.values(r.state.salaries)[0]?.amount === 25160, 'salary received')
expect('paid rent 8000', (a) => a.exp === 0, 'before salary: rent is not pocket spending')
{
  const paid = runCommand(base, 'salary 25160', now).state
  expect('rent paid', (a, r) => Object.entries(r.state.paid).some(([k, v]) => k.endsWith(':rent') && v), 'marked paid', paid)
  expect('bills paid', (a, r) => Object.entries(r.state.paid).some(([k, v]) => k.endsWith(':fixed') && v), 'marked paid', paid)
}
expect('remind me to pay electricity bill', (a, r) => r.state.tasks.some((t) => t.title === 'pay electricity bill'), 'clean title')
expect('add task buy milk', (a, r) => r.state.tasks.some((t) => t.title === 'buy milk'), 'clean title')
expect('buy milk', (a, r) => r.state.tasks.some((t) => t.title === 'buy milk'), 'a reminder, not the grocery list')
{
  const soap = runCommand(base, 'task buy soap', now).state
  expect('soap done', (a, r) => r.state.tasks.find((t) => t.title === 'buy soap')?.done === true, 'word then done', soap)
  expect('finished buying soap', (a, r) => r.state.tasks.find((t) => t.title === 'buy soap')?.done === true, '"buying" matches "buy"', soap)
}
expect('eggs finished', (a, r) => Object.keys(r.state.outOfStock).length > 0, 'eggs marked out of stock')
expect('milk ran out', (a, r) => Object.keys(r.state.outOfStock).length > 0, 'milk marked out of stock')

// a fresh batch, checked after the fixes above
expect('my phone says 5800 steps', (a) => a.steps === 5800, 'the phone count is the total')
expect('steps today 4321', (a) => a.steps === 4321, '"steps today N" is the total')
expect('i did 12k steps today', (a) => a.steps === 18065, '"N steps today" adds')
expect('remove 1 glass', (a) => a.waterMl === 1750, 'a glass less')
expect('change chai to 15', (a, r) => a.exp === 0 && !!r.unsure, 'no chai to fix: never a new ₹15 expense')
expect('remove chai', (a, r) => a.exp === 0 && r.reply.includes("can't find"), 'says it found nothing')
expect('no milk at home', (a, r) => Object.keys(r.state.outOfStock).length > 0, 'milk out of stock')
expect('out of oats', (a, r) => r.state.tasks.some((t) => t.title === 'buy oats'), 'not on the plan: a reminder')
expect('remind me tomorrow to call landlord', (a, r) => r.state.tasks.some((t) => t.title === 'call landlord' && t.due !== today), 'clean title, due tomorrow')
expect('starbucks 350', (a, r) => r.state.expenses.at(-1)?.category === 'Outside Food', 'cafe is outside food')
{
  const rides = runCommand(base, 'rapido 117 and uber 112', now).state
  expect('fixed: uber 120 not 112', (a, r) => a.exp === 2 && r.state.expenses.find((e) => e.title === 'uber')?.amount === 120, 'a fix, not two new expenses', rides)
  expect('make uber 120', (a, r) => a.exp === 2 && r.state.expenses.find((e) => e.title === 'uber')?.amount === 120, 'a fix', rides)
}

// ---------------------------------------------------------------- debt and cash in hand (each with a fresh memory, like the server)
{
  const mem0 = emptyMemory()
  const step = (s: AppState, msg: string, m = mem0) => { const r = runCommand(s, msg, now, m); return { r, s: r.state, m: r.memory } }
  const check = (ok: boolean, why: string, got?: unknown) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}${ok ? '' : `\n     got: ${JSON.stringify(got)}`}`) }

  const x = step(base, 'bro i took 500 yesterday from frnd add them in debt', emptyMemory())
  check(x.s.finance.debtTotal === base.finance.debtTotal + 500 && x.s.expenses.length === 0, 'borrowing adds to debt, not spending', x.r.reply)
  check(x.s.tasks.some((t) => t.title === 'repay ₹500 to friend' && !t.done), 'a reminder to repay the friend', x.s.tasks.map((t) => t.title))
  for (const m of ['borrowed 500 from rahul', 'rahul gave me 500', 'add 500 to debt', 'i owe ravi 500']) {
    const y = step(base, m, emptyMemory())
    check(y.s.finance.debtTotal === base.finance.debtTotal + 500 && y.s.expenses.length === 0, `"${m}" adds ₹500 to debt`, y.r.reply)
  }
  check(step(base, 'borrowed 500 from rahul', emptyMemory()).s.tasks.some((t) => t.title === 'repay ₹500 to rahul'), 'lender name kept')
  check(step(base, 'took 500 from atm', emptyMemory()).s.finance.debtTotal === base.finance.debtTotal, 'an ATM withdrawal is not a loan')
  const owe = step(x.s, 'how much i owe people', x.m)
  check(owe.r.reply.includes('₹500 to friend'), 'debt answer lists who you owe', owe.r.reply)
  const back = step(x.s, 'paid back 500 to friend', x.m)
  check(back.s.expenses.length === 0 && back.s.debtPayments.length === 1 && back.s.tasks.find((t) => t.title === 'repay ₹500 to friend')?.done === true, 'repaying is a debt payment, ticks the reminder', back.r.reply)
  check(step(base, 'returned 500 to rahul', emptyMemory()).s.debtPayments.length === 1, '"returned" is a repayment')

  let w = step(base, 'i have 400 in wallet for next payday', emptyMemory())
  check(w.r.reply.includes('₹400') && w.r.reply.includes('12 days'), 'cash noted with days to payday', w.r.reply)
  const plan = step(w.s, 'eggs i will take full  tray so it will be idk might cost 170 and aslo small oil packet may be idk how much it cost', w.m)
  check(plan.s.expenses.length === 0 && plan.r.reply.includes('₹230'), 'a plan is judged against the cash, never logged', plan.r.reply)
  const rant = step(w.s, 'bro for eggs it is 170 it will i dont know for oil packet how did u logged ? i havent bought yet and when i said i domnt know oil packet rate cant u check the price and tell me', w.m)
  check(rant.s.expenses.length === 0, 'a long message with a "?" is never logged', rant.r.reply)
  w = step(w.s, 'bought eggs tray 170', w.m)
  check(w.r.reply.includes('Cash in hand: ₹230'), 'spending comes off the cash', w.r.reply)
  check(step(w.s, 'how much cash do i have', w.m).r.reply.includes('₹230'), 'cash question answered')
  check(step(w.s, 'today', w.m).r.reply.includes('Cash in hand: ₹230'), 'today shows cash in hand')
  const undo = step(w.s, 'undo', w.m)
  check(step(undo.s, 'how much cash do i have', undo.m).r.reply.includes('₹400'), 'undoing the expense gives the cash back')
  check(!step(w.s, 'salary 25160', w.m).m.wallet, 'salary clears the cash count (the pool takes over)')
}

if (failed) {
  console.error(`\n${failed} phrasing check(s) failed`)
  process.exit(1)
}
console.log('\nall phrasing checks passed')
