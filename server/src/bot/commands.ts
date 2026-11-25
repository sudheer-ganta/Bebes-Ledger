// Chat command handler in the voice of Moira Rose (Schitt's Creek)
// Directed as a loving, dramatic aristocratic mother and strict financial comptroller for Sudheer.
import type { AppState, ExpenseCategory, MealSlot, Priority, TaskCategory, DayKey } from '../../../client/src/types'
import * as A from '../../../client/src/lib/actions'
import { addDays, fmtDate, toISO } from '../../../client/src/lib/date'
import { dayStats } from '../../../client/src/lib/day'
import { computeFinance } from '../../../client/src/lib/finance'
import { deriveAutoTasks } from '../../../client/src/lib/smart'
import { fmt, litres, num } from '../../../client/src/lib/util'
import { CRISIS_MEALS, DAY_FOCUS, DAY_KEYS } from '../../../client/src/lib/defaults'

export interface BotResult {
  state: AppState
  reply: string
  changed: boolean
  /** true when the rules didn't really understand the message (Gemini may answer instead) */
  fallback?: boolean
}

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)]

export const userName = (s: AppState): string => (s.profile?.name && s.profile.name !== 'Me' ? s.profile.name : 'Sudheer')

export const HELP = [
  '🎭 Bébé\'s Ledger — Directed by Moira Rose 🎭',
  '"One must maintain standards, even when cast down into pecuniary exile!"',
  '',
  'Command your theatrical mother & financial comptroller, Sudheer:',
  '• today / day — The grand state of our daily affairs',
  '• week — The weekly budget & your Weekend Movie Fund!',
  '• month — The royal coffers (salary, rent, savings)',
  '• gym — Today\'s anatomical sculpting split (strut like a gazelle!)',
  '• meals / breakfast / lunch / dinner — PG culinary inspirations',
  '• 120 auto  (or: gave 300 to rahul for lunch) — Confess an expenditure',
  '• what did i spend today  ·  can i afford a movie for 400 — Ask your mother',
  '• how am i doing  ·  good night — The day reviewed, mercilessly',
  '• water 500  (or: glass) — Imbibe potable crystalline libations',
  '• walk  (or: steps 3000 / steps set 6000) — Grand perambulations',
  '• ate 3 eggs p20 — Record your protein intake',
  '• task buy soap tomorrow  (or: task pay rent !) — An obligation',
  '• done soap  ·  tasks — Vanquish your to-dos',
  '• savings — Behold your burgeoning untouchable vault',
  '• salary 25160  ·  debt 2000 — Royal allocations',
  '• undo — Erase a tragic fiscal misstep',
].join('\n')

// first match wins: rides, outings, cooked/ordered food, then raw groceries (so "chicken biryani" is Outside Food)
const CATEGORY_WORDS: Array<[ExpenseCategory, RegExp]> = [
  ['Rides', /\b(auto|ola|uber|rapido|metro|bus|cab|bike|petrol|ride|taxi|train)\b/],
  ['Movies/Dates', /\b(movie|movies|cinema|pvr|date|gift|party|show|concert|drinks|pub)\b/],
  ['Outside Food', /\b(chai|tea|coffee|snack|snacks|lunch|dinner|breakfast|biryani|food|swiggy|zomato|restaurant|ordered|juice|dosa|idli|meal|mess)\b/],
  ['Groceries', /\b(veg|vegetable|vegetables|grocery|groceries|eggs?|milk|fruit|fruits|rice|atta|dal|paneer|chicken|curd|kirana|bigbasket|blinkit|zepto)\b/],
]
const TAGS: Record<string, ExpenseCategory> = {
  groceries: 'Groceries', grocery: 'Groceries', food: 'Outside Food', outside: 'Outside Food',
  movies: 'Movies/Dates', movie: 'Movies/Dates', date: 'Movies/Dates', dates: 'Movies/Dates',
  rides: 'Rides', ride: 'Rides', personal: 'Personal', emergency: 'Emergency',
}

function parseAmount(tok: string): number | null {
  const m = /^(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?$/i.exec(tok.trim())
  if (!m) return null
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? n : null
}

export const guessCategory = (text: string): ExpenseCategory => {
  const t = text.toLowerCase()
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(t)) return cat
  return 'Personal'
}

function slotFor(hour: number): MealSlot {
  if (hour < 7) return 'Pre-Workout'
  if (hour < 11) return 'Breakfast'
  if (hour < 16) return 'Lunch'
  if (hour < 19) return 'Evening Snack'
  return 'Dinner'
}

const taskCategory = (t: string): TaskCategory => {
  if (/\b(buy|get|restock|pick|order|grocer\w*|soap|detergent)\b/i.test(t)) return 'errands'
  if (/\b(pay|recharge|rent|bill|emi|transfer|salary)\b/i.test(t)) return 'finance'
  if (/\b(code|work|project|resume|interview|report|deploy|study|course|office)\b/i.test(t)) return 'dev'
  if (/\b(call|date|gift|birthday|mom|dad|friend|party)\b/i.test(t)) return 'personal'
  return 'today'
}

function progressBar(current: number, target: number, length = 8): string {
  if (target <= 0) return '░'.repeat(length)
  const ratio = Math.min(1, Math.max(0, current / target))
  const filled = Math.round(ratio * length)
  return '█'.repeat(filled) + '░'.repeat(length - filled)
}

/**
 * What Moira remembers between messages. Kept in its own MongoDB document (not in the app's data), so it
 * survives free Render going to sleep and the web app's sync never overwrites it.
 */
export interface BotMemory {
  /** recent line numbers per reply group, so she doesn't repeat herself */
  picks: Record<string, number[]>
  morning: { count: number; at: number }
  /** recent chat, oldest first, so Gemini can follow the conversation */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
  /** Gemini calls today, for the daily cap */
  ai?: { day: string; count: number }
}
export const emptyMemory = (): BotMemory => ({ picks: {}, morning: { count: 0, at: 0 } })

// runCommand is synchronous and messages are handled one at a time, so a module-level "current memory" is safe
let mem: BotMemory = emptyMemory()

/** Random line, avoiding the last few used in the same group. */
function pickNoRepeat(key: string, arr: string[]): string {
  if (arr.length <= 1) return arr[0] ?? ''
  const recent = mem.picks[key] ?? []
  const avoid = new Set(recent.slice(-Math.min(3, arr.length - 1)))
  const options = arr.map((_, i) => i).filter((i) => !avoid.has(i))
  const next = options[Math.floor(Math.random() * options.length)]
  mem.picks[key] = [...recent, next].slice(-5)
  return arr[next]
}

/** Whole-word / whole-phrase match, so "folder" doesn't trigger "fold" or "machine" trigger "shine". */
const hasWord = (text: string, ...words: string[]): boolean =>
  words.some((w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text))

const UNITS = new Set(['g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'ml', 'l', 'ltr', 'litre', 'litres', 'liter', 'pc', 'pcs', 'dozen', 'packet', 'packets', 'x'])
/** Words that mean the message is about steps/protein, not money ("i walked 5000 steps"). */
const NOT_MONEY = /\b(steps?|paces|protein)\b/i

/** Auto tasks first, then yours: the order the "tasks" list shows and "done 2" counts in. */
const openTasks = (s: AppState, fv: ReturnType<typeof computeFinance>, now: Date) =>
  [...deriveAutoTasks(s, fv, now), ...s.tasks].filter((t) => !t.done)

const spendToday = (s: AppState, date: string): number =>
  s.expenses.filter((e) => e.date === date).reduce((acc, e) => acc + e.amount, 0)

/** Today's allowance and what's left, before or after salary. */
export function moneyToday(s: AppState, today: string) {
  const fv = computeFinance(s, today)
  const spent = spendToday(s, today)
  if (fv.pending) {
    const limit = Math.round(fv.plan.pocket / fv.cycle.totalDays)
    return { fv, spent, limit, left: limit - spent, week: null as number | null }
  }
  return { fv, spent, limit: Math.round(fv.dailyLimit), left: fv.todayLeft, week: fv.weekLeft }
}

const partOfDay = (h: number) => (h < 5 ? 'late' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'late')
const clock = (now: Date) => now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })

/**
 * One short line about how your day is actually going (money first, then water, walk, protein),
 * so chatty replies talk about you instead of being random. Empty when there's nothing worth saying.
 */
function nudge(s: AppState, now: Date): string {
  const name = userName(s)
  const today = toISO(now)
  const h = now.getHours()
  const m = moneyToday(s, today)
  const st = dayStats(s, today)
  const walked = !!s.dayLogs[today]?.habits?.walk

  if (m.left < 0) {
    return pickNoRepeat('n_over', [
      `And you're ${fmt(-m.left)} over today's ${fmt(m.limit)} already. Agita, ${name}. Pure agita.`,
      `We are ${fmt(-m.left)} past today's limit, darling. The purse is closed.`,
      `${fmt(-m.left)} over budget today. I've seen more restraint at a Rose family open bar.`,
    ])
  }
  // water: expect a steady climb from 7am to 9pm
  const expected = st.waterTarget * Math.min(1, Math.max(0, (h - 7) / 14))
  if (h >= 11 && st.waterMl < expected - 500) {
    return pickNoRepeat('n_water', [
      `Only ${litres(st.waterMl)} of water by ${clock(now)}? You'll shrivel like a forgotten raisin, ${name}.`,
      `${litres(st.waterMl)} of ${litres(st.waterTarget)} water. Drink, ${name}, before you become jerky.`,
      `Your water is at ${litres(st.waterMl)}. A desiccated apricot has more moisture.`,
    ])
  }
  if (h >= 17 && !walked && st.steps < st.stepTarget) {
    return pickNoRepeat('n_walk', [
      `And the 60-minute walk, ${name}? Still waiting. ${num(st.steps)} steps is not a performance.`,
      `${num(st.steps)} of ${num(st.stepTarget)} steps. The evening promenade awaits, darling.`,
    ])
  }
  if (h >= 20 && st.proteinG < s.targets.proteinG * 0.6) {
    return pickNoRepeat('n_protein', [
      `Protein at ${st.proteinG} of ${s.targets.proteinG} g. Eggs, ${name}. Eggs are not optional.`,
      `${st.proteinG} g protein today. Muscles are not built on optimism, darling.`,
    ])
  }
  if (h >= 12 && m.left > 0) {
    return pickNoRepeat('n_good', [
      `${fmt(m.left)} of today's ${fmt(m.limit)} still intact. I'm almost proud, ${name}.`,
      `You've spent ${fmt(m.spent)} today and kept ${fmt(m.left)}. Restraint suits you.`,
      `${fmt(m.left)} left today. Guard it like my wig collection.`,
    ])
  }
  return ''
}

/**
 * Plain-text facts about the user's day, handed to Gemini so it answers from real numbers only.
 * Everything Moira-with-Gemini is allowed to say about money comes from here.
 */
export function factsFor(s: AppState, now: Date): string {
  const today = toISO(now)
  const m = moneyToday(s, today)
  const fv = m.fv
  const st = dayStats(s, today)
  const walked = !!s.dayLogs[today]?.habits?.walk
  const todays = s.expenses.filter((e) => e.date === today)
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => {
    const total = spendToday(s, d)
    return `${fmtDate(d, { weekday: 'short', day: 'numeric' })} ${fmt(total)}`
  })
  const open = openTasks(s, fv, now).slice(0, 8)
  return [
    `Name: ${userName(s)}`,
    `Now: ${fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${clock(now)} (India time)`,
    fv.pending
      ? `Salary: NOT yet received this month; payday in ${fv.cycle.daysToPayday} day(s). Spending follows a planned ${fmt(m.limit)}/day until then.`
      : `Salary: received. Pocket pool left ${fmt(fv.remaining)} for ${fv.cycle.daysLeft} more day(s) until payday.`,
    `Today: limit ${fmt(m.limit)}, spent ${fmt(m.spent)}, ${m.left >= 0 ? `left ${fmt(m.left)}` : `OVER by ${fmt(-m.left)}`}`,
    fv.pending ? '' : `This week left: ${fmt(fv.weekLeft)} · Weekend/outings fund left: ${fmt(fv.lifestyle.left)} · Groceries left: ${fmt(fv.groceries.left)} · Emergency buffer: ${fmt(fv.buffer.left)}`,
    `Today's expenses: ${todays.length ? todays.map((e) => `${fmt(e.amount)} ${e.title} (${e.category})`).join('; ') : 'none'}`,
    `Spending, last 7 days: ${week.join(', ')}`,
    `Water ${litres(st.waterMl)} of ${litres(st.waterTarget)} · Steps ${num(st.steps)} of ${num(st.stepTarget)} · 60-min walk ${walked ? 'done' : 'not done'} · Protein ${st.proteinG} of ${s.targets.proteinG} g`,
    `Debt left: ${fmt(fv.debt.remaining)} · Rent ${fv.pending ? 'n/a' : s.paid[`${fv.cycle.key}:rent`] ? 'paid' : 'not paid'} this cycle`,
    `Open tasks: ${open.length ? open.map((t, i) => `${i + 1}. ${t.title}`).join('; ') : 'none'}`,
  ].filter(Boolean).join('\n')
}

/** "₹120 auto · ₹20 chai" list of one day's expenses. */
function dayExpenses(s: AppState, date: string, label: string, name: string): string {
  const list = s.expenses.filter((e) => e.date === date)
  if (!list.length) return `Not a single rupee spent ${label}, ${name}. Either a miracle or you forgot to tell me.`
  const total = list.reduce((a, e) => a + e.amount, 0)
  const lines = list.slice(-8).map((e) => `• ${fmt(e.amount)} ${e.title}`)
  return [`🧾 ${label[0].toUpperCase() + label.slice(1)}: ${fmt(total)} across ${list.length}`, ...lines, list.length > 8 ? `…and ${list.length - 8} more.` : ''].filter(Boolean).join('\n')
}

/** Words that carry no meaning in an expense title: "gave 300 to rahul for lunch" → "rahul lunch". */
const FILLER = new Set(['i', 'just', 'to', 'for', 'on', 'at', 'the', 'a', 'an', 'my', 'of', 'rs', 'rs.', 'rupees', 'inr', '₹', 'today', 'spent', 'spend', 'paid', 'pay', 'gave', 'give', 'bought', 'buy', 'ordered', 'order', 'cost', 'costs', 'was', 'it'])
const MONEY_VERB = /\b(gave|give|spent|spend|paid|pay|bought|buy|ordered|cost|costs)\b|₹|\brs\.?\s*\d|\brupees\b/i
const QUESTION = /\?\s*$|^(can|could|should|shall|will|would|how|what|why|is|am|do|did)\b/i

function moiraScoldOverspend(name: string, over: number): string {
  const quotes = [
    `😱 Over by ${fmt(over)}! You fussy little fucker, ${name}! Never let the bastards get you down.`,
    `😱 Ruined today's plan by ${fmt(over)}! You fussy little fucker, ${name}! Fold in the cheese tomorrow.`,
    `😱 Exceeded by ${fmt(over)}, ${name}! Stop acting like a disgruntled pelican!`,
    `😱 Over by ${fmt(over)}, ${name}! You're giving me agita, but never let the bastards get you down!`,
    `😱 Over by ${fmt(over)}! Pish-posh on your spreadsheet, ${name}. Tomorrow we tighten our belts!`,
    `😱 Over by ${fmt(over)}, ${name}! I am suddenly overwhelmed by a wave of apathy!`,
  ]
  return pickNoRepeat('overspend', quotes)
}

function moiraPraiseThrift(name: string, left: number, limit: number, weekendPot: number): string {
  const quotes = [
    `💰 Left: ${fmt(left)} of ${fmt(limit)}. Surviving on photosynthesis, ${name}? How delightfully monastic.`,
    `💰 Left: ${fmt(left)}. You are blind to reality, ${name}, and for that I am most proud.`,
    `💰 Left: ${fmt(left)}. Johnny would weep. Weekend fund sits at ${fmt(weekendPot)} — guard it for the cinema nonsense.`,
    `💰 Left: ${fmt(left)}. Look at you, my little financial ascetic. Don't blow it tonight.`,
  ]
  return pickNoRepeat('thrift', quotes)
}

function moiraExpenseReaction(name: string, amount: number): string {
  if (amount >= 1200) {
    return pickNoRepeat('exp_high', [
      `Are we financing a local production of Cabaret, ${name}? Stop acting like a disgruntled pelican!`,
      `Vanished into the ether! You're giving me agita, ${name}. What you did was impulsive, capricious, and wrong.`,
      `I am incapable of dealing with this level of mediocrity, darling.`,
    ])
  }
  if (amount >= 400) {
    return pickNoRepeat('exp_med', [
      `It’s a rare gift to strip vanity of its charm, ${name}, yet here you are.`,
      `Fold in the cheese tomorrow, Bébé. You're bleeding us dry.`,
      `Have I been let go? Because this is borderline offensive, ${name}.`,
    ])
  }
  return pickNoRepeat('exp_low', [
    `Try not to make poverty a lifestyle, ${name}.`,
    `Stop pettifogging over pennies and earn some real money, ${name}.`,
    `Fine, noted. Don't look at me like that, ${name}.`,
  ])
}

function summary(s: AppState, now: Date): string {
  const name = userName(s)
  const today = toISO(now)
  const fv = computeFinance(s, today)
  const st = dayStats(s, today)
  const auto = deriveAutoTasks(s, fv, now)
  const open = [...auto, ...s.tasks].filter((t) => !t.done)
  const dateStr = fmtDate(today, { weekday: 'short', day: 'numeric', month: 'short' })

  const lines = [`🎭 ${name} — ${dateStr}`]
  if (fv.pending) {
    const plannedPerDay = Math.round(fv.plan.pocket / fv.cycle.totalDays)
    const spent = spendToday(s, today)
    const leftToday = plannedPerDay - spent
    lines.push(
      leftToday < 0
        ? `😱 Over planned limit by ${fmt(-leftToday)}! You fussy little fucker, ${name}!`
        : `💰 Plan: ${fmt(plannedPerDay)}/day (awaiting salary in ${fv.cycle.daysToPayday}d). Left today: ${fmt(leftToday)}.`
    )
  } else {
    const left = fv.todayLeft
    const weekendPot = Math.max(0, fv.lifestyle.left)
    lines.push(left < 0 ? moiraScoldOverspend(name, -left) : moiraPraiseThrift(name, left, fv.dailyLimit, weekendPot))
    lines.push(`💰 Pool: ${fmt(fv.remaining)} (${fv.cycle.daysLeft}d left)`)
  }

  lines.push(`💧 Water: ${litres(st.waterMl)} / ${litres(st.waterTarget)}`)
  lines.push(`🚶 Steps: ${num(st.steps)} / ${num(st.stepTarget)}`)
  lines.push(`🥩 Protein: ${st.proteinG} / ${s.targets.proteinG}g`)

  if (open.length) {
    lines.push(`🎭 Chores: ${open.slice(0, 2).map((t) => t.title).join('; ')}${open.length > 2 ? '…' : ''}`)
  }
  return lines.join('\n')
}

function weekSummary(s: AppState, now: Date): string {
  const name = userName(s)
  const today = toISO(now)
  const fv = computeFinance(s, today)
  if (fv.pending) return `${name}, Bébé, how can we review the week when your salary has not yet graced our books? Send "salary 25160".`

  const lines = [
    `🥂 Moira's Weekly Financial Soirée for ${name} 🥂`,
    '"Never let the bastards get you down, but do watch the weekend budget, darling!"',
    '',
    `• Safe Weekly Pace: ${fmt(fv.weekPace)}`,
    `• Left for this week: ${fmt(Math.max(0, fv.weekLeft))}`,
    `• Weekend Outing / Movie Fund: ${fmt(Math.max(0, fv.lifestyle.left))} (protect this for that ₹1.5k cinema extravagance, ${name}!)`,
    `• Groceries & Sustenance Left: ${fmt(Math.max(0, fv.groceries.left))}`,
    `• Emergency Buffer: ${fmt(Math.max(0, fv.buffer.left))}`,
    '',
    fv.weekLeft >= 0
      ? `✨ A magnificent display of maternal restraint, ${name}! Your weekend self will weep with gratitude!`
      : `⚠️ Alack! A slight indulgence this week, ${name} — let us practice theatrical thrift over the coming days!`
  ]
  return lines.join('\n')
}

function monthSummary(s: AppState, now: Date): string {
  const name = userName(s)
  const today = toISO(now)
  const fv = computeFinance(s, today)
  const a = fv.alloc
  const lines = [
    `🏰 The Grand Monthly Vault of Affairs — ${name} 🏰`,
    '"I may be impoverished, Bébé, but I shall never be unkempt!"',
    '',
    `• Monthly Inflow: ${fmt(a.salary)}`,
    `• PG Sanctum Rent: ${fmt(a.rent)} (shelter is non-negotiable)`,
    `• Fixed Commitments (Gym/Bills): ${fmt(a.fixed)}`,
    `• Debt Obligation: ${fmt(a.debt)} (Remaining: ${fmt(fv.debt.remaining)})`,
    `• Sacred Savings (untouchable!): ${fmt(a.savings)}`,
    `• Pocket Discretionary Pool: ${fmt(fv.poolTotal)} (Remaining: ${fmt(fv.remaining)})`,
    '',
    `⏳ ${fv.cycle.daysLeft} days until the next payday curtain rises.`
  ]
  return lines.join('\n')
}

function gymSplit(s: AppState, now: Date): string {
  const name = userName(s)
  const dayIndex = now.getDay()
  const keyMap: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const key = keyMap[dayIndex]
  const focus = DAY_FOCUS[key]

  const gymQuotes = [
    `Off to the dungeon, ${name}? We want Renaissance statue, not Baltic dockworker. Don't slouch!`,
    `Tread lightly, ${name}. Nothing ruins an entrance like hobbling in like a newborn foal on marble.`,
    `Sculpt those deltoids, darling. Slouching is for defeated tax auditors—neither of which you are.`,
    `Pop in your pods and block out the grunting balatrons, ${name}.`,
  ]

  if (key === 'sun') {
    return `Rest today, ${name}. Languish in bed and don't bother me.`
  }
  return `🏛️ ${focus} — ${name}\n${pick(gymQuotes)}\nDid you walk your 60 minutes, or are you lounging like a frippet?`
}

function mealSuggestions(s: AppState, now: Date, slot?: string): string {
  const name = userName(s)
  const chosenSlot = slot ? slot[0].toUpperCase() + slot.slice(1) : slotFor(now.getHours())
  // rotate through the cheap meals by day and slot instead of always showing the same two
  const start = (now.getDate() * 2 + chosenSlot.length) % CRISIS_MEALS.length
  const samples = [CRISIS_MEALS[start], CRISIS_MEALS[(start + 1) % CRISIS_MEALS.length]]

  const lines = [
    `🍳 ${chosenSlot} — ${name}`,
    `"What does burning do?! Just fold in the cheese, darling! I will not have you looking like a Victorian orphan."`,
    ...samples.map((m, i) => `${i + 1}. ${m.title} (₹${m.cost} · ${m.protein}g protein)`),
    `Eat properly, ${name}. You may as well tie a leash around a raw chicken cutlet.`,
  ]
  return lines.join('\n')
}

function limitLine(s: AppState, now: Date): string {
  const name = userName(s)
  const today = toISO(now)
  const fv = computeFinance(s, today)
  if (fv.pending) {
    const plannedPerDay = Math.round(fv.plan.pocket / fv.cycle.totalDays)
    const spent = spendToday(s, today)
    const left = plannedPerDay - spent
    return left < 0
      ? `😱 Over planned limit by ${fmt(-left)}! You fussy little fucker, ${name}! Never let the bastards get you down.`
      : `✨ Left today: ${fmt(left)} of ${fmt(plannedPerDay)} (awaiting salary in ${fv.cycle.daysToPayday}d)`
  }
  return fv.todayLeft < 0
    ? `😱 Over by ${fmt(-fv.todayLeft)}! You fussy little fucker, ${name}! Never let the bastards get you down.`
    : `✨ Left today: ${fmt(fv.todayLeft)} · Weekend Fund: ${fmt(Math.max(0, fv.lifestyle.left))}`
}

/**
 * Handle one chat message. Pass `memory` (loaded from the database) to keep Moira's memory across server
 * restarts; the updated copy comes back on the result. Without it, memory lasts only while the server runs.
 */
export function runCommand(state: AppState, input: string, now: Date = new Date(), memory?: BotMemory): BotResult & { memory: BotMemory } {
  if (memory) mem = structuredClone({ ...emptyMemory(), ...memory })
  const r = handle(state, input, now)
  return { ...r, memory: mem }
}

function handle(state: AppState, input: string, now: Date): BotResult {
  const text = input.trim().replace(/^[@/!]+\s*/, '').replace(/\s+/g, ' ')
  const lower = text.toLowerCase()
  const today = toISO(now)
  const name = userName(state)
  const noChange = (reply: string): BotResult => ({ state, reply, changed: false })
  const done = (next: AppState, reply: string): BotResult => ({ state: next, reply, changed: true })
  if (!text) return noChange(HELP)

  const [cmdRaw, ...restTokens] = text.split(' ')
  const cmd = cmdRaw.toLowerCase().replace(/[:,.]$/, '')
  const rest = restTokens.join(' ')

  if (['help', '?', 'menu', 'start', '/start', '/help'].includes(cmd)) return noChange(HELP)

  // ---- Moira Conversational Easter Eggs & Greetings
  // the whole message must be a greeting: "500 gm paneer" or "task morning run" are not
  const isMorning =
    !/\d/.test(lower) &&
    /^(?:(?:good|top of the)\s+)?(?:morning|mrng|morrow|gm|bon matin)(?:\s+(?:mom|ma|moira|darling|bebe|bébé))?[\s!.🌅☀️]*$/iu.test(lower)
  if (isMorning) {
    // greetings hours apart are a new morning, not spam
    if (now.getTime() - mem.morning.at > 6 * 3600_000) mem.morning.count = 0
    mem.morning.at = now.getTime()
    mem.morning.count++
    if (mem.morning.count >= 3) {
      return noChange(
        pickNoRepeat('morning_spam', [
          `${name} you fusssssssyyyyy little fuckerrrrrrrrrrr go away!`,
          `What do you want now?! You've said morning ${mem.morning.count} times!`,
          `Are you stuck on a loop, ${name}?! Stop shouting greetings and tell me what you spent!`,
        ])
      )
    }
    const morningQuotes = [
      `${name} you fusssssssyyyyy little fuckerrrrrrrrrrr go away!`,
      `What do you want now?!`,
      `Bébé, good mrng. Stop barking at me and tell me what you spent.`,
      `Morning, ${name}. Did we wake up in a worse tax bracket? That sweater looks like a cry for help. 🌅`,
      `Bon matin, ${name}. Keep your voice down, my eyes are still adjusting to the glare of poverty. ☀️`,
      `Top of the morning. Tell me you brewed something potable, I refuse to face you unmedicated. ☕`,
      `Bébé, good mrng. Stop acting like a disgruntled pelican and tell me what you bought.`,
    ]
    const h = now.getHours()
    if (h >= 12) {
      return noChange(pickNoRepeat('morning_late', [
        `Morning? It's ${clock(now)}, ${name}. Half the day has already been squandered.`,
        `"Good morning" at ${clock(now)}? Even I have been awake since the croissants, darling.`,
      ]))
    }
    // the first greeting of the day also tells you the plan
    const m = moneyToday(state, today)
    const plan = mem.morning.count === 1
      ? `\n💰 Today: ${fmt(Math.max(0, m.left))} to spend${m.week !== null ? ` · ${fmt(Math.max(0, m.week))} left this week` : ''}. 💧 Start with a glass of water.`
      : ''
    return noChange(pickNoRepeat('morning', morningQuotes) + plan)
  }
  mem.morning.count = 0

  if (['today', 'day', 'status', 'balance', 'bal', 'left', 'summary', '/today'].includes(cmd)) return noChange(summary(state, now))
  if (['week', 'weekly', '/week'].includes(cmd)) return noChange(weekSummary(state, now))
  if (['month', 'monthly', '/month'].includes(cmd)) return noChange(monthSummary(state, now))
  if (['gym', 'workout', 'exercise', 'split'].includes(cmd)) return noChange(gymSplit(state, now))
  if (['meals', 'meal', 'food', 'breakfast', 'lunch', 'dinner', 'snack', 'cook'].includes(cmd) && !restTokens.length) {
    return noChange(mealSuggestions(state, now, cmd !== 'meals' && cmd !== 'meal' && cmd !== 'food' ? cmd : undefined))
  }
  if (cmd === 'savings' || cmd === 'vault') {
    const fv = computeFinance(state, today)
    return noChange([
      `🏰 The Sacred Vault of Moira — for ${name} 🏰`,
      `• Untouchable Savings Floor: ${fmt(fv.savings.floorNow)}`,
      `• Debt Cleared: ${fmt(fv.debt.paidSoFar)} / ${fmt(fv.debt.total)} (Owed: ${fmt(fv.debt.remaining)})`,
      `• Emergency Stash: ${fmt(fv.buffer.left)}`,
      '',
      `"One does not pilfer from the vault, ${name}. It is our fortress against penury!"`
    ].join('\n'))
  }

  if (cmd === 'undo') {
    // only things you log by hand or by chat; grocery checkouts and crisis entries are undone in the app
    // newest by time; ties (same millisecond) go to the one added last
    const last = state.expenses
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.source === 'manual' || e.source === 'meal')
      .sort((a, b) => b.e.createdAt.localeCompare(a.e.createdAt) || b.i - a.i)[0]?.e
    if (!last) return noChange('There is nothing to undo, darling. The slate is pristine!')
    const next = A.deleteExpense(last.id)(state)
    return done(next, `Expunged ${fmt(last.amount)} (${last.title}) from the record, ${name}!\n${limitLine(next, now)}`)
  }

  // ---- water
  if (cmd === 'glass') {
    const next = A.addWater(today, 250, 'Glass')(state)
    const st = dayStats(next, today)
    return done(next, `💧 +250 mL. Guzzle it, ${name}. We can't afford luxury anti-aging creams right now. (${litres(st.waterMl)} / ${litres(st.waterTarget)})`)
  }
  if (['water', 'w', 'drank', 'drink'].includes(cmd)) {
    const raw = parseAmount(restTokens[0] ?? '')
    if (raw === null) {
      const st = dayStats(state, today)
      return noChange(`💧 Water: ${litres(st.waterMl)} / ${litres(st.waterTarget)}\nGuzzle more, ${name}! No offspring of mine shall walk the earth looking like a desiccated apricot!`)
    }
    const ml = raw <= 10 ? raw * 1000 : raw
    const next = A.addWater(today, ml, 'Water')(state)
    const st = dayStats(next, today)
    return done(next, `💧 +${num(ml)} mL logged. Total: ${litres(st.waterMl)} / ${litres(st.waterTarget)}. Try not to look like a sun-dried apricot, ${name}.`)
  }

  // ---- steps / walk
  if (['steps', 'step', 'walked'].includes(cmd)) {
    const isSet = restTokens[0]?.toLowerCase() === 'set' || restTokens[0]?.toLowerCase() === 'total'
    const n = parseAmount(restTokens[isSet ? 1 : 0] ?? '')
    if (n === null) return noChange(`How many paces did you march, ${name}? Confess!`)
    const credit = dayStats(state, today).stepCredit
    const next = isSet ? A.setExtraSteps(today, Math.max(0, n - credit))(state) : A.addSteps(today, n)(state)
    const st = dayStats(next, today)
    return done(next, `🚶 ${num(st.steps)} / ${num(st.stepTarget)} paces. A Rose never slouches, ${name}.`)
  }
  if (cmd === 'walk') {
    const already = !!(state.dayLogs[today]?.habits ?? {}).walk
    const next = already ? state : A.toggleHabit(today, 'walk')(state)
    const st = dayStats(next, today)
    const walkQuotes = [
      `🚶 60-min walk logged (+5,500). Total: ${num(st.steps)} paces. A pilgrimage of penance, ${name}! Don't slouch.`,
      `🚶 60-min walk done (+5,500). Shield your face on the return, ${name}, lest you look like a boiled langoustine!`,
    ]
    return already
      ? noChange(`Your 60-min walk is already recorded, ${name}. Go collapse in deshabille.`)
      : done(next, pick(walkQuotes))
  }

  // ---- meals
  if (['ate', 'eat', 'had'].includes(cmd)) {
    if (!rest) return noChange(`What did you feed yourself, ${name}? And please tell me there was actual protein involved!`)
    let protein = 0
    let cost = 0
    const words: string[] = []
    for (const w of restTokens) {
      const p = /^p(\d{1,3})$/i.exec(w) ?? /^(\d{1,3})g$/i.exec(w)
      const c = /^₹(\d+)$/.exec(w)
      if (p) protein = Number(p[1])
      else if (c) cost = Number(c[1])
      else words.push(w)
    }
    const slot = slotFor(now.getHours())
    const next = A.addMeal({ date: today, slot, title: words.join(' '), appliances: [], cost, protein })(state)
    const st = dayStats(next, today)
    return done(next, `🍽️ ${slot}: ${words.join(' ')}${protein ? ` · ${protein}g protein` : ''}${cost ? ` · ${fmt(cost)} Outside Food` : ''}\nProtein tally: ${st.proteinG} / ${next.targets.proteinG} g. Sustenance for my favorite offspring, ${name}!`)
  }

  // ---- tasks
  if (['task', 'todo', 'add', 'remind'].includes(cmd)) {
    let due: string | undefined
    let priority: Priority = 'routine'
    const words: string[] = []
    for (const w of restTokens) {
      const lw = w.toLowerCase()
      if (lw === 'tomorrow' || lw === 'tmrw' || lw === 'tmr') due = addDays(today, 1)
      else if (lw === 'today') due = today
      else if (w === '!' || lw === 'urgent' || lw === 'high') priority = 'high'
      else words.push(w)
    }
    const title = words.join(' ').trim()
    if (!title) return noChange(`What sordid obligation must we record, ${name}? Name the chore, darling!`)
    const category = taskCategory(title)
    const next = A.addTask({ title, category, priority, due: due ?? today })(state)
    return done(next, `📜 Enscribed in the registry for ${name}: "${title}" (due ${due && due !== today ? fmtDate(due) : 'today'}${priority === 'high' ? ', urgent!' : ''}) — "I’m positively bedeviled with meetings, et cetera, but we shall conquer this obligation!"`)
  }
  if (['done', 'finished', 'complete', 'completed', 'tick'].includes(cmd)) {
    const q = rest.toLowerCase()
    if (!q) return noChange(`Which chore was vanquished, ${name}? Tell your mother!`)
    // same list, same order as the "tasks" reply, so "done 2" means item 2 there
    const fv = computeFinance(state, today)
    const open = openTasks(state, fv, now)
    const n = /^#?(\d{1,2})$/.exec(q)
    // by words: your own tasks first, so "done recharge" ticks your task rather than marking the bills paid
    const byWords = (x: (typeof open)[number]) => x.title.toLowerCase().includes(q)
    const t = n ? open[Number(n[1]) - 1] : (open.find((x) => !x.id.startsWith('auto:') && byWords(x)) ?? open.find(byWords))
    if (!t) {
      return noChange(n
        ? `There is no obligation number ${n[1]}, ${name}. Send "tasks" to see the list.`
        : `No open obligation matches "${rest}", ${name}! Are you inventing phantom chores?`)
    }
    const next = t.id.startsWith('auto:')
      ? A.completeAutoTask(t.id, fv.debt.installmentLeft, today)(state)
      : A.toggleTask(t.id)(state)
    return done(next, `✨ Vanquished! "${t.title}" is struck from existence! Cinderella could never, ${name}!`)
  }
  if (['tasks', 'list', 'todos'].includes(cmd)) {
    const fv = computeFinance(state, today)
    const open = openTasks(state, fv, now)
    return noChange(open.length ? `🎭 Sordid Obligations Awaiting Execution (${open.length}):\n${open.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}${t.priority === 'high' ? ' ⚡' : ''}`).join('\n')}` : `✨ The stage is clear, ${name}! Not a single chore remains! 🥂`)
  }

  // ---- money events
  if (cmd === 'salary') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange(`Confess the grand total, ${name}! What did they replenish our coffers with?`)
    const fv = computeFinance(state, today)
    const next = A.receiveSalary(fv.cycle.key, n, today)(state)
    const a = computeFinance(next, today).alloc
    const perDay = a.pocket / fv.cycle.totalDays
    return done(
      next,
      `🎉 Oh, the bounty! ${fmt(n)} has descended into our coffers, ${name}!\nSanctum Rent: ${fmt(a.rent)} · Commitments: ${fmt(a.fixed)} · Debt: ${fmt(a.debt)} · Sacred Savings: ${fmt(a.savings)}\nPocket Discretionary Pool: ${fmt(a.pocket)} (≈ ${fmt(perDay)}/day · ${fmt(perDay * 7)}/week)\nOur dynasty will rise again!`,
    )
  }
  if (cmd === 'debt') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange(`How much of the debt did you pay down, ${name}? Confess the figure!`)
    const next = A.logDebtPayment(n, today)(state)
    if (next === state) return noChange(`The shackles are already gone, ${name}! We owe not a single pence to anyone! 🥂`)
    return done(next, `⚔️ ${fmt(n)} paid down! Still remaining in the shadows: ${fmt(computeFinance(next, today).debt.remaining)}`)
  }

  // ---- money questions: "what did I spend today", "can I afford a movie for 400", "how am I doing"
  const isQuestion = QUESTION.test(lower)
  const spentQ = /\b(what|how much)\b.*\b(did i|have i|i)\s+(spend|spent)\b|\b(my )?(spending|expenses)\b|^spent (today|yesterday)\??$/i
  if (spentQ.test(lower) && !/\b(week|month)\b/.test(lower)) {
    const yday = /\byesterday\b/.test(lower)
    return noChange(dayExpenses(state, yday ? addDays(today, -1) : today, yday ? 'yesterday' : 'today', name))
  }
  if (/\bafford\b/.test(lower) || (isQuestion && /^(can|could|should|shall) i (spend|buy|get|order|go|have)\b/.test(lower))) {
    const m = moneyToday(state, today)
    const amtTok = text.split(' ').find((t) => parseAmount(t) !== null)
    const want = amtTok ? parseAmount(amtTok)! : null
    const isOuting = /\b(movie|movies|cinema|date|party|pub|drinks|concert|outing|weekend)\b/.test(lower)
    const fun = m.fv.pending ? null : Math.max(0, m.fv.lifestyle.left)
    if (want === null) {
      return noChange(`You have ${fmt(Math.max(0, m.left))} left today${m.week !== null ? ` and ${fmt(Math.max(0, m.week))} this week` : ''}${isOuting && fun !== null ? `; the weekend fund holds ${fmt(fun)}` : ''}. Tell me the price, ${name}, and I'll rule on it.`)
    }
    if (isOuting && fun !== null) {
      return noChange(want <= fun
        ? `Yes. ${fmt(want)} from the weekend fund leaves ${fmt(fun - want)}. Go, ${name}, but wear something worthy of being seen in. 🎬`
        : `No, darling. The weekend fund has ${fmt(fun)}, you want ${fmt(want)}. Find a cheaper show or a richer friend.`)
    }
    if (want <= m.left) {
      return noChange(`Yes, ${name}. ${fmt(want)} leaves ${fmt(m.left - want)} of today's ${fmt(m.limit)}. Spend it as though someone is watching. I am.`)
    }
    if (m.week !== null && want <= m.week) {
      return noChange(`Today only has ${fmt(Math.max(0, m.left))}. It fits this week's ${fmt(m.week)}, but the coming days get tighter by ${fmt(want - Math.max(0, m.left))}. Is it worth it, ${name}?`)
    }
    return noChange(`Absolutely not. ${fmt(want)} against ${fmt(Math.max(0, m.left))} left today${m.week !== null ? ` and ${fmt(Math.max(0, m.week))} this week` : ''}. Put it back, ${name}.`)
  }
  if (/\b(how am i doing|how'?s my day|how is my day|how did i do|am i (doing )?(ok|okay|good|fine))\b/.test(lower)) {
    const m = moneyToday(state, today)
    const st = dayStats(state, today)
    const verdict = m.left < 0 ? `Over budget by ${fmt(-m.left)}.` : `${fmt(m.spent)} spent, ${fmt(m.left)} left.`
    return noChange(`📋 ${verdict} 💧 ${litres(st.waterMl)}/${litres(st.waterTarget)} · 🚶 ${num(st.steps)}/${num(st.stepTarget)} · 🥩 ${st.proteinG}/${state.targets.proteinG} g\n${nudge(state, now) || `A respectable showing, ${name}. Don't let it go to your head.`}`)
  }

  // ---- expense: "spent 120 auto" | "120 auto" | "chai 20" | "gave 300 to rahul for lunch"
  const isExpenseWord = ['spent', 'spend', 'paid', 'pay', 'exp', 'expense', 'bought', 'buy', 'gave', 'ordered'].includes(cmd)
  const firstAmount = parseAmount(cmdRaw)
  const tokens = isExpenseWord ? restTokens : text.split(' ')
  // "500 gm paneer 120": 500 is a quantity (followed by a unit), 120 is the price
  const amountIdx = tokens.findIndex((t, i) => parseAmount(t) !== null && !UNITS.has((tokens[i + 1] ?? '').toLowerCase()))
  // short messages with a number are expenses; longer ones need a money word ("spent", "gave", "₹")
  const looksLikeExpense =
    (isExpenseWord || firstAmount !== null || (amountIdx >= 0 && (tokens.length <= 5 || MONEY_VERB.test(lower)))) &&
    !NOT_MONEY.test(lower) && !isQuestion
  // rent and bills are already set aside from salary: mark them paid instead of spending pocket money twice
  if ((isExpenseWord || looksLikeExpense) && /\b(rent|bills?)\b/i.test(lower)) {
    const fv = computeFinance(state, today)
    if (!fv.pending) {
      const isRent = /\brent\b/i.test(lower)
      const key = `${fv.cycle.key}:${isRent ? 'rent' : 'fixed'}`
      if (state.paid[key]) return noChange(`${isRent ? 'Rent' : 'The bills'} already marked paid this cycle, ${name}. Paying twice is not generosity, it is madness.`)
      return done(
        A.setPaid(key, true)(state),
        `✅ ${isRent ? `PG rent (${fmt(state.finance.rent)})` : `Bills (${fmt(state.finance.fixed)})`} marked paid — it came from the money set aside at salary, not your pocket pool, ${name}.\n${limitLine(state, now)}`,
      )
    }
  }
  if (looksLikeExpense && amountIdx >= 0) {
    const amount = parseAmount(tokens[amountIdx])!
    const words = tokens.filter((_, i) => i !== amountIdx)
    const tag = words.find((w) => w.startsWith('#'))?.slice(1).toLowerCase()
    const title = words.filter((w) => !w.startsWith('#') && !FILLER.has(w.toLowerCase())).join(' ').trim()
    const category = (tag && TAGS[tag]) || guessCategory(lower)
    const next = A.addExpense({ amount, title: title || category, category, date: today })(state)
    const reaction = moiraExpenseReaction(name, amount)
    return done(next, `✨ Logged ${fmt(amount)} for ${category}${title ? ` (${title})` : ''}. ${reaction}\n${limitLine(next, now)}`)
  }
  if (isExpenseWord) return { ...noChange(`How much lucre was surrendered, ${name}? Tell me the damage, darling!`), fallback: true }

  // ---- conversation: only reached when the message was not a command or an expense
  // a long sentence that only tripped a keyword ("I went to a party and...") wasn't really understood
  const longText = text.split(' ').length > 6
  const chat = (reply: string): BotResult => ({ ...noChange(reply), fallback: longText })
  if (hasWord(lower, 'did you sleep') || hasWord(lower, 'did u slept') || hasWord(lower, 'slept last night') || hasWord(lower, 'sleep last night')) {
    return chat(`Sleep? In this establishment, ${name}?! I was kept awake by the tragic acoustics and Johnny's fitful tossing. What do you want?`)
  }
  if (hasWord(lower, 'rude')) {
    return chat(`Rude? I am not rude, ${name}, I am an artist starved of glamour. Now what did you want?`)
  }
  if (hasWord(lower, "didn't blow") || hasWord(lower, "didnt blow") || hasWord(lower, "haven't spent") || hasWord(lower, "havent spent")) {
    return chat(`You didn't blow our money? Well, miracles never cease. Tell me what's left or confess your damage, ${name}.`)
  }
  if (['what', 'why', 'huh', 'what?', 'why?'].includes(cmd) && text.length <= 10) {
    return chat(`What do you mean "what", ${name}? Use your words, darling! Did we spend money or not?`)
  }
  if (['fine', 'ok', 'okay', 'k', 'sure', 'alright'].includes(cmd) && text.length <= 10) {
    return chat(`Good. Now hydrate and let me languish in peace, or tell me what you bought.`)
  }
  if (hasWord(lower, 'are you an ai') || hasWord(lower, 'are you ai') || hasWord(lower, 'are you a bot') || hasWord(lower, 'are you bot') || hasWord(lower, 'who are you')) {
    return chat(`An AI? A bot?! How dare you, ${name}! I am Moira Rose, award-winning actress of stage and screen, reduced to overseeing your dismal purse strings. Now log your pennies!`)
  }
  if (['hi', 'hii', 'hello', 'hey', 'heyy', 'hola', 'yo'].includes(cmd) && restTokens.length <= 2) {
    const greet: Record<string, string[]> = {
      morning: [
        `Oh, it's you. Morning, ${name}. I haven't even finished my face.`,
        `${name}! Before noon? Either you need money or advice. Possibly both.`,
      ],
      afternoon: [
        `What do you want, ${name}? "I'm trying very hard not to connect with people right now."`,
        `Afternoon, ${name}. I was mid-rehearsal. This had better be about money.`,
      ],
      evening: [
        `Evening, ${name}. Report: what has the day cost us?`,
        `Ah, the prodigal returns at dusk. Speak, ${name}.`,
      ],
      late: [
        `It's ${clock(now)}, ${name}. Decent people are asleep. Indecent people are spending. Which are you?`,
        `Why are you awake, ${name}? Nothing good is purchased this late.`,
      ],
    }
    const part = partOfDay(now.getHours())
    const n = nudge(state, now)
    return chat(pickNoRepeat(`hi_${part}`, greet[part]) + (n ? `\n${n}` : ''))
  }
  if (['bye', 'goodbye', 'cya', 'adios'].includes(cmd)) {
    return chat(`Goodbye, ${name}. Try not to squander our coins on frivolous balatrons.`)
  }
  if (['gn', 'goodnight', 'night', 'sleep', 'bonne nuit'].includes(cmd) || lower.startsWith('good night') || lower.startsWith('bonne nuit')) {
    const nightQuotes = [
      `Good night, ${name}. Stop spiraling over trivialities, your worry lines are giving me agita. 🌙`,
      `Bonne nuit, ${name}. Put away that rectangle and don't wander off with local strays. 🛌`,
      `Good night, ${name}. Extinguish the lights and wake me only if our fortune returns. 😴`,
    ]
    // close the day with its numbers and a verdict
    const m = moneyToday(state, today)
    const st = dayStats(state, today)
    const wins = [m.left >= 0, st.waterMl >= st.waterTarget, st.steps >= st.stepTarget || !!state.dayLogs[today]?.habits?.walk].filter(Boolean).length
    const verdict = wins === 3
      ? `A flawless day. I shall tell no one, lest it go to your head.`
      : wins === 2 ? `Two out of three. Respectable, not legendary.`
      : wins === 1 ? `One out of three, ${name}. Tomorrow we do better.`
      : `A catastrophe in three acts. Sleep it off.`
    return chat(`${pickNoRepeat('night', nightQuotes)}\n📋 ${m.left < 0 ? `${fmt(-m.left)} over` : `${fmt(m.spent)} spent, ${fmt(m.left)} kept`} · 💧 ${litres(st.waterMl)}/${litres(st.waterTarget)} · 🚶 ${num(st.steps)}/${num(st.stepTarget)}\n${verdict}`)
  }
  if (['thanks', 'thank you', 'ty', 'thx'].includes(cmd)) {
    return chat(`You're welcome, ${name}. Don't expect applause for the bare minimum.`)
  }
  if (hasWord(lower, 'water') && /\b(how much|status|left)\b/.test(lower)) {
    const st = dayStats(state, today)
    return chat(`💧 Water: ${litres(st.waterMl)} / ${litres(st.waterTarget)}. Drink up, ${name}.`)
  }
  if (hasWord(lower, 'budget') || hasWord(lower, 'how much') || hasWord(lower, 'can i spend') || hasWord(lower, 'allowance')) {
    const fv = computeFinance(state, today)
    const spentToday = spendToday(state, today)
    if (fv.pending) {
      const plannedPerDay = Math.round(fv.plan.pocket / fv.cycle.totalDays)
      const leftToday = plannedPerDay - spentToday
      return chat(
        leftToday < 0
          ? `😱 Over planned limit by ${fmt(-leftToday)}, ${name}! Stop spending!`
          : `💰 Plan is ${fmt(plannedPerDay)} a day. You have ${fmt(leftToday)} left today (awaiting salary in ${fv.cycle.daysToPayday}d). Try not to blow it on nonsense.`
      )
    }
    const leftToday = fv.todayLeft
    return chat(
      leftToday < 0
        ? `😱 Over budget by ${fmt(-leftToday)}, ${name}! Stop spending!`
        : `💰 Today's limit: ${fmt(fv.dailyLimit)}. Left today: ${fmt(leftToday)}. Try not to blow it on nonsense.`
    )
  }
  if (hasWord(lower, 'how are you') || ['sup', 'wassup', 'whats up'].includes(cmd)) {
    return chat(`I’m bedeviled with meetings and suffering from your financial choices, ${name}. What do you need?`)
  }
  if (hasWord(lower, 'pish') || hasWord(lower, 'posh')) {
    return chat(`"Pish posh, ${name}! You can't put a price on style, my dear! When one of us shines, all of us shine!" 💅`)
  }
  if (hasWord(lower, 'mediocrity') || hasWord(lower, 'allergic')) {
    return chat(`"I am allergic to mediocrity, ${name}! Darling, I am incapable of doing anything with subtlety!" 👑`)
  }
  if (hasWord(lower, 'rsvp') || hasWord(lower, 'party')) {
    return chat(`"I would be pleased to RSVP as pending, ${name}. I would never throw a party without a theme—that's just barbaric!" 🍸`)
  }
  if (hasWord(lower, 'style') || hasWord(lower, 'fashion') || hasWord(lower, 'sweater') || hasWord(lower, 'dress')) {
    return chat(`"You can't put a price on style, my dear ${name}! I do not merely walk through life, I perform it!" 👠✨`)
  }
  if (hasWord(lower, 'subtlety') || hasWord(lower, 'subtle')) {
    return chat(`"Darling, I am incapable of doing anything with subtlety! One must champagne oneself and say: I am ready for this!" 🍾`)
  }
  if (hasWord(lower, 'champagne')) {
    return chat(`"One must champagne oneself, ${name}, and say: I am ready for this!" 🥂`)
  }
  if (hasWord(lower, 'shine')) {
    return chat(`"When one of us shines, all of us shine, ${name}!" ✨`)
  }
  if (hasWord(lower, 'perform')) {
    return chat(`"I do not merely walk through life, ${name}. I perform it!" 🎭`)
  }
  if (hasWord(lower, 'crow') || hasWord(lower, 'crows')) {
    return chat(`"The crows don't just have eyes, ${name}. They have... wings." 🦅 A cinematic triumph! Now drink some water, darling.`)
  }
  if (hasWord(lower, 'wine') || hasWord(lower, 'fruit wine') || hasWord(lower, 'herb')) {
    return chat(`"The herb-a-flinge... fruit wine! This wine is awful. Give me another glass!" 🍷 Cheers, ${name}!`)
  }
  if (hasWord(lower, 'pelican')) {
    return chat(`"${name}, stop acting like a disgruntled pelican!" — I believe that is my line, darling! 🎭`)
  }
  if (hasWord(lower, 'gossip')) {
    return chat(`"Gossip is the devil's telephone, ${name}. Best to just hang up." ...Though do tell me what happened! ☎️`)
  }
  if (hasWord(lower, 'turtle')) {
    return chat(`"Turtles do not pets make, ${name}. The poor things are riddled with a myriad of diseases. You may as well tie a leash around a raw chicken cutlet." 🐢`)
  }
  if (hasWord(lower, 'shoes') || hasWord(lower, 'skate')) {
    return chat(`"I don’t skate through life, ${name}. I walk through life in really nice shoes." 👠`)
  }
  if (hasWord(lower, 'cheese') || hasWord(lower, 'fold')) {
    return chat(`"What does 'fold in the cheese' mean, ${name}?! YOU FOLD IT IN! I cannot show you everything! Well, can you show me one thing?!" 🧀`)
  }
  if (hasWord(lower, 'condom')) {
    return chat(`"I'm sorry I'm not a condom, ${name}!" 🎭`)
  }
  if (hasWord(lower, 'apathy')) {
    return chat(`"I am suddenly overwhelmed by a wave of apathy, ${name}." 💅`)
  }
  if (hasWord(lower, 'towel')) {
    return chat(`"I have asked you thrice now for a towel so that I may wash this town off my body, ${name}!" 🧖‍♀️`)
  }
  if (hasWord(lower, 'thumb')) {
    return chat(`"I’m not going to sit here and take this from someone who looks like a thumb, ${name}!" 🎭`)
  }

  const chatFallbacks = [
    `Pish posh, ${name}! I am allergic to mediocrity. Did you blow our money, or are you just here to distract me?`,
    `Stop acting like a disgruntled pelican, ${name}. What did you buy?`,
    `I would be pleased to RSVP as pending to whatever nonsense you're babbling about, ${name}.`,
    `You fussy little fucker, ${name}. Drink some water and tell me if you've ruined our budget today.`,
    `You're giving me agita, ${name}. Speak plainly or let me languish in peace.`,
    `Gossip is the devil's telephone, ${name}. Did you spend lucre, or are you just testing my patience?`,
    `I am suddenly overwhelmed by a wave of apathy, ${name}. Log an expense or go away.`,
    `You are dripping with ennui, ${name}. Perambulate or confess your damage!`,
    `Darling, I am incapable of doing anything with subtlety. Tell me what you need before I have an apoplexy.`,
    `Look at you, ${name}. A walking cry for help. Drink some water and fold in the cheese.`,
  ]
  // when she doesn't understand, she at least talks about your day
  const n = nudge(state, now)
  return { ...noChange(pickNoRepeat('fallbacks', chatFallbacks) + (n ? `\n${n}` : '')), fallback: true }
}
