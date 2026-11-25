// Moira's own brain: a small intent matcher "trained" on example phrases, answering from the app's data.
// No AI service, no cost. It handles typos (one wrong letter), synonyms and word order; anything it isn't sure
// about falls through to the rules' fallback (or Gemini, if switched on). You can teach it new phrases from chat.
import type { AppState, DayKey, ExpenseCategory, ISODate } from '../../../client/src/types'
import { addDays, diffDays, fmtDate, toISO, weekStartOf } from '../../../client/src/lib/date'
import { dayStats, splitKeyFor } from '../../../client/src/lib/day'
import { CRISIS_MEALS, DAY_FOCUS, GROCERY_WEEKS } from '../../../client/src/lib/defaults'
import { computeFinance } from '../../../client/src/lib/finance'
import { currentWeekIndex, outOfStockItems, weekKeyOf, weekTotals } from '../../../client/src/lib/groceries'
import { deriveAutoTasks } from '../../../client/src/lib/smart'
import { fmt, litres, num, sum } from '../../../client/src/lib/util'

// ---------------------------------------------------------------- training data

/** Example phrases per intent. Add more here (or "teach" from chat) and she gets better. */
export const TRAINING: Record<string, string[]> = {
  money: ['how much money do i have', 'what is my balance', 'money left', 'how much can i spend', 'remaining budget', 'funds left', 'what is left', 'am i broke', 'how much cash do i have', 'pocket money left', 'paisa kitna bacha', 'kitne paise hai', 'paise bache'],
  spent: ['how much did i spend', 'total spent', 'spending this week', 'what did i spend this month', 'expenses last week', 'how much have i spent so far', 'spent yesterday', 'my spending', 'how much money went', 'kitna kharcha hua', 'aaj kitna kharcha', 'kharcha kitna'],
  breakdown: ['where did my money go', 'spending breakdown', 'what am i spending most on', 'which category', 'biggest expense', 'top expenses', 'category wise spending', 'where is my money going'],
  compare: ['am i spending more than last week', 'compare spending', 'better than last week', 'spending vs last week', 'am i improving with money'],
  debt: ['how much debt left', 'loan status', 'when will my debt be cleared', 'how much do i owe', 'debt progress', 'emi left'],
  savings: ['how much have i saved', 'my savings', 'savings status', 'emergency fund', 'vault', 'how much is saved'],
  payday: ['when is salary', 'when do i get paid', 'payday', 'how many days to salary', 'when will salary come', 'salary date'],
  bills: ['is rent paid', 'rent due', 'bills due', 'what bills are pending', 'did i pay rent', 'when is rent'],
  weekend: ['weekend fund', 'can i go out this weekend', 'movie money', 'date budget', 'outing money', 'fun money left'],
  groceries: ['what groceries to buy', 'shopping list', 'grocery list this week', 'what should i buy', 'groceries this week', 'what to buy from market'],
  restock: ['what is out of stock', 'what ran out', 'restock list', 'what finished in kitchen', 'out of stock items'],
  meals_today: ['what did i ate today', 'my meals today', 'how much protein today', 'protein status', 'food log', 'what have i eaten', 'what i had today'],
  meal_idea: ['what should i eat', 'dinner idea', 'cheap meal idea', 'what to cook', 'what to cook tonight', 'suggest food', 'high protein meal', 'breakfast idea', 'recipe', 'what can i make'],
  gym: ['what workout today', 'gym plan', 'which muscle today', 'tomorrow workout', 'workout plan', 'what exercises today', 'leg day'],
  water: ['how much water', 'water status', 'am i hydrated', 'how much water left', 'water today'],
  steps: ['how many steps', 'steps today', 'did i walk', 'step count', 'how much did i walk'],
  tasks: ['what are my tasks', 'what do i have to do', 'pending work', 'todo list', 'overdue tasks', 'what is due today', 'my chores'],
  mood: ['how was my mood', 'mood this week', 'how am i feeling lately', 'my journal', 'my wins this week', 'journal summary', 'how have i been feeling'],
  week_review: ['weekly review', 'how was my week', 'week summary', 'review my week', 'how did this week go'],
  joke: ['tell me a joke', 'make me laugh', 'say something funny', 'i am bored', 'entertain me', 'cheer me up'],
  capabilities: ['what can you do', 'what can i ask you', 'how do you work', 'list your features', 'what do you know'],
}

// words that mean the same thing to her
const SYNONYMS: Record<string, string> = {
  spent: 'spend', spending: 'spend', spends: 'spend', expense: 'spend', expenses: 'spend', kharcha: 'spend', kharch: 'spend', paid: 'spend', blew: 'spend',
  cash: 'money', balance: 'money', funds: 'money', fund: 'money', budget: 'money', rupees: 'money', paisa: 'money', paise: 'money', pese: 'money', bacha: 'left', bache: 'left', bacha_hai: 'left',
  grocery: 'groceries', kirana: 'groceries', market: 'groceries', vegetables: 'groceries', veggies: 'groceries',
  workout: 'gym', exercise: 'gym', exercises: 'gym', training: 'gym', muscle: 'gym',
  eat: 'food', meal: 'food', meals: 'food', dinner: 'food', lunch: 'food', breakfast: 'food', ate: 'ate', eaten: 'ate', had: 'ate', cooking: 'cook', recipe: 'cook', recipes: 'cook', make: 'cook', idea: 'cook', ideas: 'cook', suggest: 'cook',
  loan: 'debt', emi: 'debt', owe: 'debt', borrowed: 'debt',
  saved: 'savings', save: 'savings', saving: 'savings', vault: 'savings',
  salary: 'payday', paycheck: 'payday', paid_day: 'payday',
  todo: 'tasks', todos: 'tasks', task: 'tasks', chores: 'tasks', chore: 'tasks', work: 'tasks',
  feeling: 'mood', feel: 'mood', felt: 'mood', journal: 'mood', emotions: 'mood',
  walk: 'steps', walked: 'steps', walking: 'steps', step: 'steps',
  hydrated: 'water', drink: 'water', drank: 'water',
  movie: 'weekend', movies: 'weekend', outing: 'weekend', date: 'weekend', party: 'weekend',
}
const STOP = new Set(['i', 'me', 'my', 'the', 'a', 'an', 'is', 'am', 'are', 'do', 'did', 'does', 'to', 'of', 'for', 'on', 'in', 'so', 'far', 'have', 'has', 'what', 'how', 'much', 'many', 'can', 'please', 'mom', 'moira', 'darling', 'bro', 'tell', 'show', 'give', 'just', 'it', 'be', 'will', 'was', 'any', 'some', 'should', 'could', 'would', 'shall', 'get', 'go', 'with', 'about', 'this', 'that'])

const norm = (w: string) => {
  let t = w.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (SYNONYMS[t]) return SYNONYMS[t]
  if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1)
  return SYNONYMS[t] ?? t
}
const tokens = (text: string) => text.split(/\s+/).map(norm).filter((t) => t && !STOP.has(t))

// one wrong / missing / extra letter, for words of 5+ letters (so "fold" never becomes "food") ("monye", "grocries", "saivngs")
function close(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

interface Model { examples: Array<{ intent: string; toks: string[] }>; idf: Map<string, number>; vocab: string[] }

/** "Training": tokenise every example and weigh rare words higher (idf). Cheap enough to redo per message. */
export function train(learned: Array<{ phrase: string; intent: string }> = []): Model {
  const examples = [
    ...Object.entries(TRAINING).flatMap(([intent, list]) => list.map((p) => ({ intent, toks: tokens(p) }))),
    ...learned.filter((l) => TRAINING[l.intent]).map((l) => ({ intent: l.intent, toks: tokens(l.phrase) })),
  ].filter((e) => e.toks.length)
  const df = new Map<string, number>()
  for (const e of examples) for (const t of new Set(e.toks)) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + examples.length / n)]))
  return { examples, idf, vocab: [...df.keys()] }
}

/** Best intent and a 0..1 confidence (weighted overlap with the closest example). */
export function classify(text: string, model: Model): { intent: string | null; score: number } {
  // snap typos onto known words
  const toks = tokens(text).map((t) => (model.idf.has(t) ? t : model.vocab.find((v) => close(t, v)) ?? t))
  if (!toks.length) return { intent: null, score: 0 }
  const w = (t: string) => model.idf.get(t) ?? 0
  const mine = new Set(toks)
  let best = { intent: null as string | null, score: 0 }
  for (const ex of model.examples) {
    const theirs = new Set(ex.toks)
    const shared = [...mine].filter((t) => theirs.has(t))
    if (!shared.length) continue
    const both = sum(shared.map(w))
    // harmonic mix of "how much of my message matched" and "how much of the example matched"
    // words she has never seen count as much as typical words, so long off-topic sentences score low
    const p = both / sum([...mine].map((t) => w(t) || 3))
    const r = both / sum([...theirs].map(w))
    let score = (2 * p * r) / (p + r)
    // a long message sharing a single word with an example is probably about something else
    if (mine.size >= 4 && shared.length === 1) score *= 0.6
    if (score > best.score) best = { intent: ex.intent, score }
  }
  return best
}

export const CONFIDENT = 0.5

// ---------------------------------------------------------------- answers

export interface BrainCtx {
  s: AppState
  now: Date
  name: string
  /** Moira line picker that avoids repeats (from commands.ts) */
  pick: (key: string, lines: string[]) => string
  /** pre-salary status line (from commands.ts) */
  broke: () => string
}

type Period = { from: ISODate; to: ISODate; label: string }
function periodOf(text: string, today: ISODate, cycleStart: ISODate): Period {
  const t = text.toLowerCase()
  if (/\byesterday\b/.test(t)) { const d = addDays(today, -1); return { from: d, to: d, label: 'yesterday' } }
  if (/\blast week\b/.test(t)) { const ws = addDays(weekStartOf(today), -7); return { from: ws, to: addDays(ws, 6), label: 'last week' } }
  if (/\b(month|cycle|so far)\b/.test(t)) return { from: cycleStart, to: today, label: 'since payday' }
  if (/\bweek\b/.test(t)) return { from: weekStartOf(today), to: today, label: 'this week' }
  return { from: today, to: today, label: 'today' }
}

const spentIn = (s: AppState, p: Period) => s.expenses.filter((e) => e.date >= p.from && e.date <= p.to)

export function answer(intent: string, text: string, c: BrainCtx): string | null {
  const { s, now, name, pick } = c
  const today = toISO(now)
  const fv = computeFinance(s, today)
  const st = dayStats(s, today)

  switch (intent) {
    case 'money': {
      if (fv.pending) return `We are between engagements, ${name}.\n${c.broke()}`
      return `💰 ${fv.todayLeft >= 0 ? `${fmt(fv.todayLeft)} left today` : `${fmt(-fv.todayLeft)} over today`} · ${fmt(Math.max(0, fv.weekLeft))} this week · ${fmt(fv.remaining)} in the pool for ${fv.cycle.daysLeft} days.`
    }
    case 'spent': {
      const p = periodOf(text, today, fv.cycle.start)
      const list = spentIn(s, p)
      const total = sum(list.map((e) => e.amount))
      if (!list.length) return `Not a rupee ${p.label}, ${name}. Either sainthood or amnesia.`
      const top = [...list].sort((a, b) => b.amount - a.amount).slice(0, 3).map((e) => `${fmt(e.amount)} ${e.title}`).join(', ')
      return `🧾 ${fmt(total)} spent ${p.label} across ${list.length}. Biggest: ${top}.\n${pick('b_spent', [`Every rupee has a story, ${name}. Most of yours are tragedies.`, `I've seen thriftier sailors on shore leave.`, `Noted, catalogued, and judged.`])}`
    }
    case 'breakdown': {
      const p = periodOf(text, today, fv.cycle.start)
      const period = p.label === 'today' && !/\btoday\b/i.test(text) ? { from: fv.cycle.start, to: today, label: 'since payday' } : p
      const list = spentIn(s, period)
      if (!list.length) return `Nothing spent ${period.label}, ${name}. The ledger is pristine.`
      const by = new Map<ExpenseCategory, number>()
      for (const e of list) by.set(e.category, (by.get(e.category) ?? 0) + e.amount)
      const total = sum([...by.values()])
      const rows = [...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => `• ${k}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`)
      const [topCat] = [...by].sort((a, b) => b[1] - a[1])[0]
      return [`📊 Where it went, ${period.label} (${fmt(total)}):`, ...rows, pick('b_break', [`${topCat} is clearly your one true love, ${name}.`, `${topCat}. Of course it's ${topCat}.`, `I'd stage an intervention for ${topCat}.`])].join('\n')
    }
    case 'compare': {
      const thisW = { from: weekStartOf(today), to: today, label: 'this week' }
      const days = diffDays(today, thisW.from) + 1
      const lastFrom = addDays(thisW.from, -7)
      const lastSame = { from: lastFrom, to: addDays(lastFrom, days - 1), label: 'same days last week' }
      const a = sum(spentIn(s, thisW).map((e) => e.amount))
      const b = sum(spentIn(s, lastSame).map((e) => e.amount))
      const diff = a - b
      return `📈 This week so far ${fmt(a)} vs ${fmt(b)} on the same ${days} day${days === 1 ? '' : 's'} last week.\n${diff > 0 ? `${fmt(diff)} more, ${name}. We are sliding backwards in heels.` : diff < 0 ? `${fmt(-diff)} less. Growth! I may weep.` : `Exactly the same. Consistency, if not virtue.`}`
    }
    case 'debt': {
      const d = fv.debt
      if (d.cleared || d.remaining <= 0) return `🥂 Debt cleared, ${name}. We owe not a single paisa to anyone.`
      return `⚔️ Debt left ${fmt(d.remaining)} of ${fmt(d.total)} (${fmt(d.paidSoFar)} paid). About ${d.monthsLeft} month${d.monthsLeft === 1 ? '' : 's'} to go${d.installmentLeft > 0 ? `; ${fmt(d.installmentLeft)} still due this cycle` : '; this cycle is paid'}.`
    }
    case 'savings':
      return `🏰 Savings floor ${fmt(fv.savings.floorNow)} · emergency buffer ${fmt(Math.max(0, fv.buffer.left))}${fv.savings.withdrawals ? ` · ${fmt(fv.savings.withdrawals)} pulled out this cycle` : ''}.\n"One does not pilfer from the vault, ${name}."`
    case 'payday': {
      const c2 = fv.cycle
      if (fv.pending && !fv.waitingFirst) return `Salary day was ${fmtDate(c2.start, { day: 'numeric', month: 'short' })}. Send "salary <amount>" once it lands, ${name}.`
      return `📅 Next salary: ${fmtDate(c2.nextPayday, { weekday: 'short', day: 'numeric', month: 'short' })}, in ${c2.daysToPayday} day${c2.daysToPayday === 1 ? '' : 's'}. ${pick('b_pay', ['Hold the line, bébé.', 'The curtain rises soon.', 'Until then, we perform poverty with dignity.'])}`
    }
    case 'bills': {
      if (fv.pending) return `Nothing to pay from until salary lands, ${name}.\n${c.broke()}`
      const key = fv.cycle.key
      const rent = s.paid[`${key}:rent`] ? 'paid ✅' : `not paid (${fmt(s.finance.rent)}, due on the ${s.finance.rentDueDay}th)`
      const bills = s.paid[`${key}:fixed`] ? 'paid ✅' : `not paid (${fmt(s.finance.fixed)}, due on the ${s.finance.fixedDueDay}th)`
      return `🏠 Rent: ${rent}\n📱 Bills (recharge, gym): ${bills}`
    }
    case 'weekend': {
      if (fv.pending) return `A weekend fund requires a salary, darling.\n${c.broke()}`
      const left = Math.max(0, fv.lifestyle.left)
      return `🎬 Weekend/outings fund: ${fmt(left)} of ${fmt(fv.lifestyle.budget)} left. ${left >= 400 ? `A film is permissible, ${name}. Popcorn is not.` : left > 0 ? 'Enough for chai and a stroll. Wear something fabulous.' : 'Empty. We stay in and perform for each other.'}`
    }
    case 'groceries': {
      const wi = currentWeekIndex(s, today)
      const week = GROCERY_WEEKS[wi]
      if (!week) return null
      const t = weekTotals(s, week, weekKeyOf(today), today)
      if (t.checkedOut) return `🛒 This week's groceries (${week.title}) are already bought: ${fmt(t.checkedOut.total)} on ${fmtDate(t.checkedOut.date)}.`
      const items = t.toBuy.slice(0, 12).map((i) => `${i.name} (${i.qty})`).join(', ')
      return `🛒 ${week.title} — ${week.focus}\nTo buy${t.shoppingTotal > 0 ? ` (~${fmt(t.shoppingTotal)})` : ''}: ${items}${t.toBuy.length > 12 ? '…' : ''}${t.stockSavings > 0 ? `\nAlready in the kitchen saves ${fmt(t.stockSavings)}.` : ''}`
    }
    case 'restock': {
      const oos = outOfStockItems(s)
      return oos.length ? `🧺 Out of stock: ${oos.map((i) => i.name).join(', ')}.` : `Nothing marked out of stock, ${name}. The pantry stands proud.`
    }
    case 'meals_today': {
      const meals = s.meals.filter((m) => m.date === today)
      const protein = `🥩 Protein ${st.proteinG} of ${s.targets.proteinG} g`
      if (!meals.length) return `${protein}. No meals logged today, ${name}. Are we photosynthesising?`
      return `🍽️ Today: ${meals.map((m) => `${m.slot}: ${m.title}${m.protein ? ` (${m.protein}g)` : ''}`).join(' · ')}\n${protein}${st.proteinG < s.targets.proteinG ? ` — ${s.targets.proteinG - st.proteinG} g to go. Eggs, darling.` : '. Magnificent.'}`
    }
    case 'meal_idea': {
      const need = Math.max(0, s.targets.proteinG - st.proteinG)
      const picks = [...CRISIS_MEALS].sort((a, b) => (need > 30 ? b.protein - a.protein : a.cost - b.cost)).slice(0, 2)
      return `🍳 ${need > 30 ? `You still need ${need} g protein, so:` : 'Cheap and decent:'}\n${picks.map((m, i) => `${i + 1}. ${m.title} — ₹${m.cost}, ${m.protein} g (${m.minutes} min)`).join('\n')}`
    }
    case 'gym': {
      const tomorrow = /\btomorrow\b/i.test(text)
      const date = tomorrow ? addDays(today, 1) : today
      const key: DayKey = splitKeyFor(s, date)
      const plan = s.gymPlan[key] ?? []
      const focus = DAY_FOCUS[key]
      if (!plan.length) return `🏛️ ${tomorrow ? 'Tomorrow' : 'Today'}: ${focus}. Rest, stretch, and do not speak to me of squats.`
      return `🏛️ ${tomorrow ? 'Tomorrow' : 'Today'}: ${focus}\n${plan.slice(0, 6).map((e) => `• ${e.name} ${e.sets}×${e.reps}`).join('\n')}\n${pick('b_gym', ['Renaissance statue, not Baltic dockworker.', 'Lift with drama, darling.', 'Do not slouch between sets.'])}`
    }
    case 'water':
      return `💧 ${litres(st.waterMl)} of ${litres(st.waterTarget)}${st.waterMl < st.waterTarget ? ` — ${litres(st.waterTarget - st.waterMl)} to go. Send "glass" each time.` : '. Dewy and triumphant.'}`
    case 'steps': {
      const walked = !!s.dayLogs[today]?.habits?.walk
      return `🚶 ${num(st.steps)} of ${num(st.stepTarget)} steps · 60-min walk ${walked ? 'done ✅' : 'not yet'}${!walked ? '. Send "walk" when you do it.' : ''}`
    }
    case 'tasks': {
      const open = [...deriveAutoTasks(s, fv, now), ...s.tasks].filter((t) => !t.done)
      if (!open.length) return `✨ Not a single chore remains, ${name}. 🥂`
      const overdue = open.filter((t) => t.due && t.due < today).length
      return `📜 ${open.length} open${overdue ? `, ${overdue} overdue` : ''}:\n${open.slice(0, 8).map((t, i) => `${i + 1}. ${t.title}${t.due && t.due < today ? ' ⏰' : t.priority === 'high' ? ' ⚡' : ''}`).join('\n')}\nSend "done 2" to tick one.`
    }
    case 'mood': {
      const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter((d) => s.journal[d])
      if (!days.length) return `No journal this week, ${name}. Send "mood 4" or "win: got the interview" and I'll keep the record.`
      const moods = days.map((d) => s.journal[d].mood)
      const avg = sum(moods) / moods.length
      const wins = days.map((d) => s.journal[d].wins).filter(Boolean).slice(0, 3)
      const struggles = days.map((d) => s.journal[d].struggles).filter(Boolean).slice(0, 2)
      return [`📓 Mood this week: ${avg.toFixed(1)}/5 over ${days.length} day${days.length === 1 ? '' : 's'}.`, wins.length ? `Wins: ${wins.join('; ')}` : '', struggles.length ? `Struggles: ${struggles.join('; ')}` : '', avg >= 3.5 ? 'You are glowing, darling.' : avg >= 2.5 ? 'Middling. We have survived worse sets.' : 'A difficult week, bébé. Be gentle with yourself.'].filter(Boolean).join('\n')
    }
    case 'week_review': {
      const ws = weekStartOf(today)
      const days = Array.from({ length: diffDays(today, ws) + 1 }, (_, i) => addDays(ws, i))
      const spent = sum(s.expenses.filter((e) => e.date >= ws && e.date <= today).map((e) => e.amount))
      const stats = days.map((d) => dayStats(s, d))
      const waterDays = stats.filter((x) => x.waterMl >= x.waterTarget).length
      const stepDays = stats.filter((x, i) => x.steps >= x.stepTarget || !!s.dayLogs[days[i]]?.habits?.walk).length
      const done = s.tasks.filter((t) => t.doneAt && t.doneAt.slice(0, 10) >= ws).length
      return `🗓️ Week so far (${days.length} day${days.length === 1 ? '' : 's'}): ${fmt(spent)} spent · water goal ${waterDays}/${days.length} · steps ${stepDays}/${days.length} · ${done} task${done === 1 ? '' : 's'} done.\n${waterDays + stepDays >= days.length * 1.5 ? `A strong showing, ${name}.` : `We can do better, and we shall.`}`
    }
    case 'joke':
      return pick('b_joke', [
        `I once played a woman so poor she had to rent her own shadow. Method acting, ${name}. I lived it.`,
        `Why did the PG landlord cross the road? To raise the rent on the other side, darling.`,
        `Your budget and my career have one thing in common: both were once glamorous.`,
        `I asked the universe for abundance. It sent you, ${name}, and a ₹40 auto ride.`,
        `They say money can't buy happiness. They've clearly never seen me in a sequinned cape.`,
        `Darling, I've had more comebacks than your bank balance has had deposits.`,
      ])
    case 'capabilities':
      return [
        `I know everything, ${name}. Ask me:`,
        '• money: "how much money", "spent this week", "where did my money go", "compare with last week"',
        '• bills: "debt left", "savings", "is rent paid", "when is salary", "weekend fund"',
        '• food: "grocery list", "what ran out", "what did I eat", "dinner idea"',
        '• body: "gym today", "water", "steps"',
        '• life: "tasks", "how was my mood", "weekly review"',
        '• teach me: "teach money how much paisa left"',
      ].join('\n')
  }
  return null
}

export const INTENTS = Object.keys(TRAINING)
