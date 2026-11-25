// Moira's own brain: intent matching, answers from data, teaching, journal and feelings. No network.
import { hydrate } from '../../client/src/lib/hydrate'
import { CONFIDENT, classify, train } from '../src/bot/brain'
import { emptyMemory, runCommand } from '../src/bot/commands'

process.env.TZ = 'Asia/Kolkata'
let failed = 0
const check = (ok: boolean, why: string, got?: unknown) => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}${ok ? '' : `\n     got: ${JSON.stringify(got)}`}`)
}

// 1) phrasing, typos and Hinglish land on the right intent
const model = train()
const expect: Array<[string, string | null]> = [
  ['how much monye left', 'money'], ['paisa kitna bacha', 'money'], ['where did my money go this month', 'breakdown'],
  ['is my rent paid', 'bills'], ['when do i get my salary', 'payday'], ['grocries list', 'groceries'],
  ['what muscle tomorrow', 'gym'], ['how was my week', 'week_review'], ['am i spending more than last week', 'compare'],
  ['how much debt do i still owe', 'debt'], ['how much did i blow yesterday', 'spent'], ['what ran out in the kitchen', 'restock'],
  ['did i drink enough', 'water'], ['tell me a joke', 'joke'], ['how was my mood', 'mood'], ['what should i cook tonight', 'meal_idea'],
  ['what did i eat today', 'meals_today'], ['how much have i saved so far', 'savings'], ['can i go for a movie this weekend', 'weekend'],
  ['kitna kharcha hua', 'spent'], ['hey hai', null], ['hi bhai', null],
  // not ours: must stay below the bar so the fallback (or Gemini) handles them
  ['honestly my landlord is driving me crazy these days', null], ['i went to a party yesterday and it was so loud', null],
  ['should i quit my job', null], ['fold in the cheese', null],
]
for (const [q, want] of expect) {
  const r = classify(q, model)
  const got = r.score >= CONFIDENT ? r.intent : null
  check(got === want, `"${q}" → ${want ?? 'not understood'}`, { got, score: r.score.toFixed(2) })
}

// 2) answers come from real data
const now = new Date(2026, 10, 25, 19, 0)
let s = runCommand(hydrate(null), 'salary 25160', now).state
for (const m of ['lunch 300', 'auto 80']) s = runCommand(s, m, now).state
let mem = emptyMemory()
const say = (m: string) => { const r = runCommand(s, m, now, mem); s = r.state; mem = r.memory; return r }

check(say('where did my money go this month').reply.includes('Outside Food: ₹300'), 'breakdown uses real expenses')
check(say('is my rent paid').reply.includes('not paid'), 'rent status from data')
check(/8 Dec/.test(say('when do i get my salary').reply), 'payday date from finance settings')
check(say('what muscle tomorrow').reply.includes('Triceps'), 'gym plan for tomorrow (Thursday)')

// 3) journal and mood from chat
let r = say('mood 4 good day at work')
check(r.changed && s.journal['2026-11-25']?.mood === 4 && s.journal['2026-11-25'].notes.includes('good day'), '"mood 4 …" saves mood and note')
r = say('win: finished the bot')
check(r.changed && s.journal['2026-11-25'].wins.includes('finished the bot'), '"win: …" saves to wins')
check(say('how was my mood').reply.includes('4.0/5'), 'mood summary reads the journal')

// 4) feelings get warmth, not stats; serious words get a helpline
check(say('i am so tired today').reply.includes('mood 2'), 'sad feeling → comfort + mood hint')
check(say('feeling great today').reply.includes('mood 4'), 'happy feeling → cheer + mood hint')
check(say('i want to die').reply.includes('14416'), 'serious message → helpline, no jokes')

// 5) teach + unknowns
r = say('what is the damage bebe')
check(r.fallback === true && (mem.unknown ?? []).includes('what is the damage bebe'), 'unknown message is remembered')
say('teach money what is the damage bebe')
r = say('what is the damage bebe')
check(!r.fallback && r.reply.startsWith('💰'), 'taught phrase now understood')
check(!(mem.unknown ?? []).includes('what is the damage bebe'), 'taught phrase removed from unknowns')
check(say('teach nonsense hello').reply.startsWith('Teach me like this'), 'teaching a bad intent explains how')

if (failed) {
  console.error(`\n${failed} brain check(s) failed`)
  process.exit(1)
}
console.log('\nall brain checks passed')
