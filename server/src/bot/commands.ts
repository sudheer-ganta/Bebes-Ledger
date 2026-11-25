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
}

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)]

const userName = (s: AppState): string => (s.profile?.name && s.profile.name !== 'Me' ? s.profile.name : 'Sudheer')

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
  '• 120 auto  (or: spent 120 auto) — Confess an expenditure',
  '• water 500  (or: glass) — Imbibe potable crystalline libations',
  '• walk  (or: steps 3000 / steps set 6000) — Grand perambulations',
  '• ate 3 eggs p20 — Record your protein intake',
  '• task buy soap tomorrow  (or: task pay rent !) — An obligation',
  '• done soap  ·  tasks — Vanquish your to-dos',
  '• savings — Behold your burgeoning untouchable vault',
  '• salary 25160  ·  debt 2000 — Royal allocations',
  '• undo — Erase a tragic fiscal misstep',
].join('\n')

const CATEGORY_WORDS: Array<[ExpenseCategory, RegExp]> = [
  ['Groceries', /\b(veg|vegetable|vegetables|grocery|groceries|eggs?|milk|fruit|fruits|rice|atta|dal|paneer|chicken|curd|kirana|bigbasket|blinkit|zepto)\b/],
  ['Rides', /\b(auto|ola|uber|rapido|metro|bus|cab|bike|petrol|ride|taxi|train)\b/],
  ['Movies/Dates', /\b(movie|movies|cinema|pvr|date|gift|party|show|concert|drinks|pub)\b/],
  ['Outside Food', /\b(chai|tea|coffee|snack|snacks|lunch|dinner|breakfast|biryani|food|swiggy|zomato|restaurant|ordered|juice|dosa|idli|meal|mess)\b/],
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

const guessCategory = (text: string): ExpenseCategory => {
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

function moiraScoldOverspend(name: string, over: number): string {
  const quotes = [
    `😱 Gasp! Over today's allotment by ${fmt(over)}! ${name}, stop acting like a disgruntled pelican! What you did was impulsive, capricious, and melodramatic… but it was also wrong! Tomorrow we must fold in the cheese and tighten our corsets!`,
    `😱 A devastating turn of events, ${name}! The crows don't just have eyes... they have wings! Exceeded by ${fmt(over)}! Tomorrow you shall subsist on ambient lighting and filtered tap water!`,
    `😱 Alack! Over by ${fmt(over)}! Be careful, ${name}, lest you suffer vertigo from the dizzying heights of your moral ground! Tomorrow requires severe theatrical thrift!`,
    `😱 What mercurial madness possessed you to surrender ${fmt(over)} over budget, ${name}?! You little frippet! We are not the Astors! Tomorrow's allowance is slashed!`,
  ]
  return pick(quotes)
}

function moiraPraiseThrift(name: string, left: number, limit: number, weekendPot: number): string {
  const quotes = [
    `💰 Can lavish: ${fmt(left)} of ${fmt(limit)} today.\n🥂 "You are blind to reality, ${name}, and for that I am most proud." A parsimonious triumph, Bébé! Unspent lucre rolls into your Weekend Movie Fund (${fmt(weekendPot)})! Johnny would weep with pride!`,
    `💰 Remaining today: ${fmt(left)} of ${fmt(limit)}.\n🥂 Look at you, ${name}, my disciplined spawn! Guard that Weekend Stash (${fmt(weekendPot)}) for that grand ₹1,500 cinema sojourn!`,
    `💰 Unspent today: ${fmt(left)} of ${fmt(limit)}.\n🥂 "If that's not a cause for celebration, I don't know what is!" Unspent lucre safely transferred to your weekend soiree pool (${fmt(weekendPot)})!`,
  ]
  return pick(quotes)
}

function moiraExpenseReaction(name: string, amount: number): string {
  if (amount >= 1200) {
    return pick([
      `👑 Gasp! A Gatsby-esque indulgence of biblical proportions, ${name}! My wig cabinet trembled at this transaction!`,
      `👑 Fifteen hundred rupees?! Are we financing a local production of Cabaret in our PG bedroom, ${name}?!`,
      `👑 "This wine is awful. Get me another glass." ${fmt(amount)} vanished into the ether, ${name}! An opulent, mercurial disbursement!`,
      `👑 ${name}, what have I told you about putting your lucre on display like cheap trinkets at a flea market?! Never! Never without proper budgeting!`,
    ])
  }
  if (amount >= 400) {
    return pick([
      `🎭 A dramatic expenditure registered, ${name}! Fold in the cheese, darling, because tomorrow we pace ourselves!`,
      `🎭 "Oh, ${name}… it’s a rare gift to strip vanity of its charm, yet here you are." A bold swipe of the card, child!`,
      `🎭 Duly registered in our dramatic annals. A little extravagant for our PG exile, but we shall endure!`,
    ])
  }
  return pick([
    `✨ Duly registered, ${name}. A modest, acceptable disbursement.`,
    `✨ A quaint little expenditure, darling. A mere drop in our artisanal bucket.`,
    `✨ Noted, my child. The books remain steady.`,
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

  const lines = [`🎭 Today with Moira (${dateStr}) — for ${name}`]
  if (fv.pending) {
    lines.push(
      fv.waitingFirst
        ? `Alas ${name}, we await your grand salary! ${fv.cycle.daysToPayday} days until replenishment. Living on ${fmt(fv.plan.pocket / fv.cycle.totalDays)} a day.`
        : `Our coffers are barren, ${name}! Confess your earnings: send "salary 25160".`,
    )
  } else {
    const left = fv.todayLeft
    const weekendPot = Math.max(0, fv.lifestyle.left)
    if (left < 0) {
      lines.push(moiraScoldOverspend(name, -left))
    } else {
      lines.push(moiraPraiseThrift(name, left, fv.dailyLimit, weekendPot))
    }
    lines.push(`🥂 Total Discretionary Pool: ${fmt(fv.remaining)} · ${fv.cycle.daysLeft} days to payday`)
  }

  const waterPct = Math.round((st.waterMl / st.waterTarget) * 100)
  lines.push(`💧 Potable Hydration: ${litres(st.waterMl)} / ${litres(st.waterTarget)} [${progressBar(st.waterMl, st.waterTarget)}] ${waterPct}%`)
  const stepPct = Math.round((st.steps / st.stepTarget) * 100)
  lines.push(`🚶 Perambulations: ${num(st.steps)} / ${num(st.stepTarget)} [${progressBar(st.steps, st.stepTarget)}] ${stepPct}%`)
  lines.push(`🥩 Protein: ${st.proteinG} / ${s.targets.proteinG} g`)

  if (open.length) {
    lines.push(`🎭 Sordid Obligations (${open.length}): ${open.slice(0, 3).map((t) => t.title).join('; ')}${open.length > 3 ? '…' : ''}`)
  } else {
    lines.push(`✨ Not a single sordid obligation remains, ${name}! Glorious! Pick up a glass of the Herb Ertlinger fruit wine and celebrate! 🍷`)
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
    fv.todayLeft >= 0
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

  const lines = [
    `🏛️ Sculpting the Divine Silhouette — ${focus} 🏛️`,
    `"The crows don't just have eyes, ${name}. They have wings! Fold in the iron, Bébé! Strut with the majesty of a gazelle across the Serengeti! A Rose never slouches!"`,
    '',
  ]

  if (key === 'sun') {
    lines.push('Rest, darling! Replenish your radiant vessel with languid slumber and leisurely strolls.')
  } else {
    lines.push(`Today\'s Muscle Masterpiece: ${focus}`)
    lines.push('Ticking off your 60-min round-trip walk? Send: walk (+5,500 steps!)')
  }
  return lines.join('\n')
}

function mealSuggestions(s: AppState, slot?: string): string {
  const name = userName(s)
  const chosenSlot = slot || 'Meal'
  const samples = CRISIS_MEALS.slice(0, 3)

  const lines = [
    `🍳 Gastronomical Inspiration for ${chosenSlot}, ${name}! 🍳`,
    '"What does burning do?! Just fold in the cheese, darling! Turtles do not pets make, but eggs in the boiler make a feast! Even in a PG, we dine like royalty!"',
    '',
  ]

  samples.forEach((m, idx) => {
    lines.push(`${idx + 1}. ${m.title}`)
    lines.push(`   ₹${m.cost} · ${m.protein}g protein · ${m.appliances.join('/')} (${m.minutes} mins)`)
    lines.push(`   "${m.how}"`)
  })

  lines.push('')
  lines.push(`When you have feasted, tell your mother: "ate 3 eggs p20" (or: "ate paneer bhurji p28 ₹60")`)
  return lines.join('\n')
}

function limitLine(s: AppState, now: Date): string {
  const name = userName(s)
  const fv = computeFinance(s, toISO(now))
  if (fv.pending) return '(no pool yet: salary not entered)'
  return fv.todayLeft < 0
    ? `😱 Over today's allotment by ${fmt(-fv.todayLeft)}! ${name}, tomorrow requires theatrical thrift!`
    : `✨ Left today: ${fmt(fv.todayLeft)} · Weekend Fund: ${fmt(Math.max(0, fv.lifestyle.left))}`
}

export function runCommand(state: AppState, input: string, now: Date = new Date()): BotResult {
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
  if (['hi', 'hello', 'hey', 'heyy', 'hola'].includes(cmd)) {
    return noChange(`Ah, ${name}, my dear Bébé! You grace my presence! What financial triumphs or sordid confessions do you bring to my stage today? Might you and I confabulate for a moment? ✨\n\nSend "today" for the grand daily summary, or "help" if you find yourself dripping with ennui!`)
  }
  if (['bye', 'goodbye', 'cya', 'adios'].includes(cmd)) {
    return noChange(`Farewell, ${name}! Perambulate gracefully, keep yourself appropriately habilimented, and do not squander your lucre on frivolous balatrons! 🎭`)
  }
  if (['gn', 'goodnight', 'night', 'sleep'].includes(cmd)) {
    return noChange(`Retire to your chambers, ${name}! Wrap your weary carriage in the finest satin and slumber like an exiled queen. The stage awaits tomorrow! 🌙✨`)
  }
  if (['gm', 'morning', 'goodmorning', 'good morning'].includes(cmd)) {
    return noChange(`Good morning, ${name}, my magnificent creation! The sun ascends! Imbibe your potable crystalline libation, shake off the morning ennui, and seize the day with theatrical flair! 🌅`)
  }
  if (['thanks', 'thank you', 'ty', 'thx'].includes(cmd)) {
    return noChange(`You are exquisitely welcome, ${name}, darling child! One does what one must to keep this household from the clutches of financial insolvency! 🥂`)
  }
  if (lower.includes('how are you') || ['sup', 'wassup', 'whats up'].includes(cmd)) {
    return noChange(`I’m positively bedeviled with meetings, et cetera, ${name}! Languishing in artistic exile, but persevering with supreme elegance! Ready to tally your expenditures and keep our coffers pristine! 🎭`)
  }
  if (lower.includes('crow') || lower.includes('crows')) {
    return noChange(`"The crows don't just have eyes, ${name}. They have... wings." 🦅 A cinematic masterpiece! Now drink some water, darling.`)
  }
  if (lower.includes('wine') || lower.includes('fruit wine') || lower.includes('herb')) {
    return noChange(`"The herb-a-flinge... fruit wine! This wine is awful. Get me another glass!" 🍷 Cheers, ${name}!`)
  }
  if (lower.includes('pelican')) {
    return noChange(`"${name}, stop acting like a disgruntled pelican!" — I believe that is my line, darling! 🎭`)
  }
  if (lower.includes('gossip')) {
    return noChange(`"Gossip is the devil's telephone, ${name}. Best to just hang up." ...Though do tell me what happened! ☎️`)
  }

  if (['today', 'day', 'status', 'balance', 'bal', 'left', 'summary', '/today'].includes(cmd)) return noChange(summary(state, now))
  if (['week', 'weekly', '/week'].includes(cmd)) return noChange(weekSummary(state, now))
  if (['month', 'monthly', '/month'].includes(cmd)) return noChange(monthSummary(state, now))
  if (['gym', 'workout', 'exercise', 'split'].includes(cmd)) return noChange(gymSplit(state, now))
  if (['meals', 'meal', 'food', 'breakfast', 'lunch', 'dinner', 'snack', 'cook'].includes(cmd) && !restTokens.length) {
    return noChange(mealSuggestions(state, cmd !== 'meals' && cmd !== 'meal' && cmd !== 'food' ? cmd : undefined))
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

  // ---- expense: "spent 120 auto" | "120 auto" | "chai 20"
  const isExpenseWord = ['spent', 'spend', 'paid', 'pay', 'exp', 'expense', 'bought', 'buy'].includes(cmd)
  const firstAmount = parseAmount(cmdRaw)
  const tokens = isExpenseWord ? restTokens : text.split(' ')
  const amountIdx = tokens.findIndex((t) => parseAmount(t) !== null)
  const looksLikeExpense =
    isExpenseWord || firstAmount !== null || (amountIdx >= 0 && tokens.length <= 5 && !['task', 'todo', 'add', 'ate', 'water', 'steps', 'salary', 'debt', 'done'].includes(cmd))
  if (looksLikeExpense && amountIdx >= 0) {
    const amount = parseAmount(tokens[amountIdx])!
    const words = tokens.filter((_, i) => i !== amountIdx)
    const tag = words.find((w) => w.startsWith('#'))?.slice(1).toLowerCase()
    const title = words.filter((w) => !w.startsWith('#')).join(' ').trim()
    const category = (tag && TAGS[tag]) || guessCategory(`${title} ${cmd}`)
    const next = A.addExpense({ amount, title: title || category, category, date: today })(state)
    const reaction = moiraExpenseReaction(name, amount)
    return done(next, `${reaction}\nLogged ${fmt(amount)} for ${category}${title ? ` (${title})` : ''}.\n${limitLine(next, now)}`)
  }
  if (isExpenseWord) return noChange(`How much lucre was surrendered, ${name}? Example: spent 120 auto`)

  if (cmd === 'undo') {
    const last = [...state.expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!last) return noChange('There is nothing to undo, darling. The slate is pristine!')
    const next = A.deleteExpense(last.id)(state)
    return done(next, `Expunged ${fmt(last.amount)} (${last.title}) from the record, ${name}!\n${limitLine(next, now)}`)
  }

  // ---- water
  if (cmd === 'glass') {
    const next = A.addWater(today, 250, 'Glass')(state)
    const st = dayStats(next, today)
    const quote = pick([
      `One\'s epidermis rejoices, ${name}!`,
      'Guzzle it down! We cannot afford luxury anti-aging creams right now, child!',
      'Potable hydration is your Crème de la Mer, darling!',
      'Never let the bastards see you dehydrated!',
    ])
    return done(next, `💧 +250 mL ingested! ${quote} (${litres(st.waterMl)} / ${litres(st.waterTarget)})`)
  }
  if (['water', 'w', 'drank', 'drink'].includes(cmd)) {
    const raw = parseAmount(restTokens[0] ?? '')
    if (raw === null) {
      const st = dayStats(state, today)
      const pct = Math.round((st.waterMl / st.waterTarget) * 100)
      return noChange(`💧 Crystalline Potable Libation: ${litres(st.waterMl)} / ${litres(st.waterTarget)} [${progressBar(st.waterMl, st.waterTarget)}] ${pct}%\nGuzzle more, ${name}! No offspring of mine shall walk the earth looking like a desiccated apricot!\nSend: water 500 or glass`)
    }
    const ml = raw <= 10 ? raw * 1000 : raw
    const next = A.addWater(today, ml, 'Water')(state)
    const st = dayStats(next, today)
    return done(next, `💧 Imbibed ${num(ml)} mL, ${name}! Total: ${litres(st.waterMl)} of ${litres(st.waterTarget)}${st.waterMl >= st.waterTarget ? ' 🌟 Magnificently hydrated!' : ''}`)
  }

  // ---- steps / walk
  if (['steps', 'step', 'walked'].includes(cmd)) {
    const isSet = restTokens[0]?.toLowerCase() === 'set' || restTokens[0]?.toLowerCase() === 'total'
    const n = parseAmount(restTokens[isSet ? 1 : 0] ?? '')
    if (n === null) return noChange(`How many peregrinations, ${name}? Example: steps 3000 or steps set 6000`)
    const credit = dayStats(state, today).stepCredit
    const next = isSet ? A.setExtraSteps(today, Math.max(0, n - credit))(state) : A.addSteps(today, n)(state)
    const st = dayStats(next, today)
    return done(next, `🚶 Perambulations: ${num(st.steps)} of ${num(st.stepTarget)}${st.steps >= st.stepTarget ? ` 🏆 The gazelle reaches the summit of Mount Olympus, ${name}!` : ` · ${num(st.stepTarget - st.steps)} paces to go`}`)
  }
  if (cmd === 'walk') {
    const already = !!(state.dayLogs[today]?.habits ?? {}).walk
    const next = already ? state : A.toggleHabit(today, 'walk')(state)
    const st = dayStats(next, today)
    return already
      ? noChange(`Your majestic 60-min gym walk has already been immortalized today, ${name}!`)
      : done(next, `🚶 The 60-min gym pilgrimage is complete! (+5,500 steps). Total: ${num(st.steps)} of ${num(st.stepTarget)}\nA Rose never slouches!`)
  }

  // ---- meals
  if (['ate', 'eat', 'had'].includes(cmd)) {
    if (!rest) return noChange(`What culinary creation did you savor, ${name}? Example: ate 3 eggs p20`)
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
    if (!title) return noChange(`What sordid obligation must we record, ${name}? Example: task buy soap tomorrow`)
    const category = taskCategory(title)
    const next = A.addTask({ title, category, priority, due: due ?? today })(state)
    return done(next, `📜 Enscribed in the registry for ${name}: "${title}" (due ${due && due !== today ? fmtDate(due) : 'today'}${priority === 'high' ? ', urgent!' : ''}) — "I’m positively bedeviled with meetings, et cetera, but we shall conquer this obligation!"`)
  }
  if (['done', 'finished', 'complete', 'completed', 'tick'].includes(cmd)) {
    const q = rest.toLowerCase()
    if (!q) return noChange(`Which chore was vanquished, ${name}? Example: done soap`)
    const t = state.tasks.find((x) => !x.done && x.title.toLowerCase().includes(q))
    if (!t) return noChange(`No open obligation matches "${rest}", ${name}. Send "tasks" to inspect them.`)
    return done(A.toggleTask(t.id)(state), `✨ Vanquished! "${t.title}" is struck from existence! Cinderella could never, ${name}!`)
  }
  if (['tasks', 'list', 'todos'].includes(cmd)) {
    const fv = computeFinance(state, today)
    const open = [...deriveAutoTasks(state, fv, now), ...state.tasks].filter((t) => !t.done)
    return noChange(open.length ? `🎭 Sordid Obligations Awaiting Execution (${open.length}):\n${open.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}${t.priority === 'high' ? ' ⚡' : ''}`).join('\n')}` : `✨ The stage is clear, ${name}! Not a single chore remains! 🥂`)
  }

  // ---- money events
  if (cmd === 'salary') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange(`Confess the grand total, ${name}! Example: salary 25160`)
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
    if (n === null) return noChange(`How much of the debt was banished, ${name}? Example: debt 2000`)
    const next = A.logDebtPayment(n, today)(state)
    if (next === state) return noChange(`The shackles are already gone, ${name}! We owe not a single pence to anyone! 🥂`)
    return done(next, `⚔️ ${fmt(n)} paid down! Still remaining in the shadows: ${fmt(computeFinance(next, today).debt.remaining)}`)
  }

  return noChange(`I could not decipher "${text.length > 40 ? `${text.slice(0, 40)}…` : text}", ${name}.\n\n${HELP}`)
}
