// Gemini routing and tools, with a fake Gemini: no network, no API key, no cost.
import { hydrate } from '../../client/src/lib/hydrate'
import type { AppState } from '../../client/src/types'
import { runTool, type ChatTurn, type MoiraAi } from '../src/bot/moira-ai'
import { factsFor, runCommand, type BotMemory } from '../src/bot/commands'
import { handleText, type BotDeps } from '../src/bot/webhooks'

process.env.TZ = 'Asia/Kolkata'
const now = new Date(2026, 10, 25, 15, 0)
let failed = 0
const check = (ok: boolean, why: string, got?: unknown) => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}${ok ? '' : `\n     got: ${JSON.stringify(got)}`}`)
}

let stored: AppState = runCommand(hydrate(null), 'salary 25160', now).state
let memory: BotMemory | null = null
const calls: Array<{ text: string; history: ChatTurn[]; facts: string }> = []
let fakeFails = false
const fake: MoiraAi = async (state, text, n, history) => {
  calls.push({ text, history, facts: factsFor(state, n) })
  if (fakeFails) throw new Error('simulated outage')
  // pretend Gemini decided to log an expense for this one
  if (text.includes('rahul')) {
    const r = runTool(state, 'log_expense', { amount: 300, title: 'lunch with rahul', category: 'auto' }, n)
    return { state: r.state, changed: true, reply: `AI: ${r.result}` }
  }
  return { state, changed: false, reply: 'AI: darling.' }
}
const deps = (limit = 60): BotDeps => ({
  load: async () => stored as unknown as Record<string, unknown>,
  save: async (s) => { stored = s },
  loadMemory: async () => memory,
  saveMemory: async (m) => { memory = structuredClone(m) },
  sendWhatsApp: async () => {},
  sendTelegram: async () => {},
  now: () => now,
  askMoira: fake,
  aiDailyLimit: limit,
})

// commands never reach Gemini
let reply = await handleText('lunch 300', deps())
check(calls.length === 0 && reply.startsWith('✨ Logged'), 'a command is handled by the rules, Gemini not called', reply)
reply = await handleText('today', deps())
check(calls.length === 0, '"today" is handled by the rules')

// free text goes to Gemini, with real facts and the earlier chat
reply = await handleText('honestly my landlord is driving me crazy these days', deps())
check(calls.length === 1 && reply === 'AI: darling.', 'unrecognised sentence goes to Gemini', reply)
check(calls[0].facts.includes('spent ₹300') && calls[0].facts.includes('Water'), 'Gemini gets real numbers in the facts', calls[0].facts)
check(calls[0].history.some((t) => t.text === 'lunch 300'), 'Gemini sees the earlier chat', calls[0].history)

// a long sentence that only tripped a joke keyword still goes to Gemini
await handleText('i went to a party yesterday and it was so loud', deps())
check(calls.length === 2, 'long sentence with "party" goes to Gemini, not the RSVP quote')

// Gemini's tool calls change real data and get saved
const before = stored.expenses.length
reply = await handleText('ugh i had to treat rahul so that cost me', deps())
check(stored.expenses.length === before + 1 && stored.expenses.at(-1)!.amount === 300, 'expense logged by Gemini is saved', reply)

// outage: rule reply instead of an error
fakeFails = true
reply = await handleText('what a strange day it has been honestly', deps())
check(!reply.startsWith('AI:') && reply.length > 0, 'Gemini error falls back to Moira rule reply', reply)
fakeFails = false

// daily cap
const used = memory!.ai?.count ?? 0
const n0 = calls.length
reply = await handleText('tell me something fun please mother dearest', deps(used))
check(calls.length === n0 && !reply.startsWith('AI:'), 'daily cap reached: Gemini not called', reply)

// history is capped
check((memory!.history ?? []).length <= 12, 'history keeps at most 12 turns', memory!.history?.length)

// tools validate input
check(runTool(stored, 'log_expense', { amount: -5, title: 'x', category: 'auto' }, now).error === true, 'negative expense rejected')
check(runTool(stored, 'add_water', { ml: 99999 }, now).error === true, 'absurd water amount rejected')
const paid = runTool(stored, 'mark_paid', { what: 'rent' }, now)
check(!paid.error && Object.values(paid.state.paid).some(Boolean), 'mark_paid rent works after salary')
const cat = runTool(stored, 'log_expense', { amount: 80, title: 'auto to office', category: 'auto' }, now)
check(cat.state.expenses.at(-1)!.category === 'Rides', '"auto" category is guessed from the title')

const up = runTool(stored, 'add_steps', { steps: 6065 }, now).state
const fixed = runTool(up, 'set_steps', { total: 5000 }, now)
check(!fixed.error && fixed.result.includes('5,000'), 'set_steps can lower the step count', fixed.result)
check(runTool(stored, 'set_steps', { total: -1 }, now).error === true, 'negative step total rejected')

// new tools: corrections, the walk, ticking tasks
const w = runTool(stored, 'set_water', { total_ml: 1500 }, now)
check(!w.error && w.result.includes('1.5 L'), 'set_water sets the total', w.result)
const walk = runTool(stored, 'log_walk', {}, now)
check(!walk.error && Object.values(walk.state.dayLogs).some((d) => d.habits?.walk) && walk.result.includes('walk marked done'), 'log_walk ticks the walk', walk.result)
check(runTool(walk.state, 'log_walk', {}, now).result.includes('already'), 'log_walk twice does not untick it')
const withTask = runCommand(stored, 'task buy soap', now).state
const open = factsFor(withTask, now).split('\n').find((l) => l.startsWith('Open tasks'))!
const soapNo = Number(/(\d+)\. buy soap/.exec(open)?.[1])
const ticked = runTool(withTask, 'complete_task', { number: soapNo }, now)
check(!ticked.error && ticked.state.tasks.find((t) => t.title === 'buy soap')?.done === true, 'complete_task ticks the numbered task from the facts', ticked.result)
check(runTool(withTask, 'complete_task', { number: 99 }, now).error === true, 'complete_task with a bad number errors')

// fixing one expense by name, and replacing a wrong meal
const rides = runCommand(stored, 'rapido 117 and uber 112', now).state
const fixed1 = runTool(rides, 'fix_expense', { title_words: 'rapido', new_amount: 107 }, now)
check(!fixed1.error && fixed1.state.expenses.find((e) => e.title === 'rapido')?.amount === 107, 'fix_expense changes the amount', fixed1.result)
const gone = runTool(rides, 'fix_expense', { title_words: 'uber', new_amount: 0 }, now)
check(!gone.error && !gone.state.expenses.some((e) => e.title === 'uber') && gone.state.expenses.some((e) => e.title === 'rapido'), 'fix_expense with 0 deletes only that one', gone.result)
check(runTool(rides, 'fix_expense', { title_words: 'ola', new_amount: 50 }, now).error === true, 'fix_expense with no match errors')
const meal = runCommand(stored, 'ate biryani 250', now).state
const um = runTool(meal, 'undo_meal', {}, now)
check(!um.error && um.state.meals.length === meal.meals.length - 1 && um.state.expenses.length === meal.expenses.length - 1, 'undo_meal removes the meal and its cost', um.result)

// a short answer to her question ("it yes") goes to Gemini with the chat; the same words out of the blue don't
{
  const n0b = calls.length
  memory = { ...(memory as BotMemory), history: [{ role: 'user', text: 'if i took 500 yesterday should it be debt' }, { role: 'assistant', text: 'Is this ₹500 fresh borrowing, bébé?' }] }
  reply = await handleText('it yes', deps())
  check(calls.length === n0b + 1, '"it yes" right after her question goes to Gemini', reply)
  memory = { ...(memory as BotMemory), history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Evening, darling.' }] }
  await handleText('it yes', deps())
  check(calls.length === n0b + 1, '"it yes" with no question before it stays with the rules')
}

// short messages the rules only guessed at go to Gemini too; real commands still don't
const n1 = calls.length
reply = await handleText('done sir', deps())
check(calls.length === n1 + 1 && reply === 'AI: darling.', '"done sir" (2 words, unsure) goes to Gemini', reply)
reply = await handleText('ate maggi', deps())
check(calls.length === n1 + 2, '"ate maggi" (unknown food) goes to Gemini for a protein estimate')
reply = await handleText('remove 1000 steps', deps())
check(calls.length === n1 + 2 && reply.includes('Steps'), '"remove 1000 steps" is exact: rules handle it, no Gemini call', reply)
fakeFails = true
const beforeMeals = stored.meals.length
reply = await handleText('ate poha upma', deps())
check(stored.meals.length === beforeMeals + 1 && reply.includes('🍽️'), "Gemini down: the rules' meal log is kept", reply)
fakeFails = false

if (failed) {
  console.error(`\n${failed} AI check(s) failed`)
  process.exit(1)
}
console.log('\nall AI routing checks passed')
