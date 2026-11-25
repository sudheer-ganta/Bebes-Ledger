// Chat command handler in the voice of Moira Rose (Schitt's Creek).
// Shared by WhatsApp and Telegram bots. Reuses web app logic (client/src/lib).
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

export const HELP = [
  '🎭 Bébé\'s Ledger — Directed by Moira Rose 🎭',
  '',
  'Command your theatrical comptroller, darling:',
  '• today / day — The grand daily state of affairs',
  '• week — The weekly budget & your Weekend Movie Fund!',
  '• month — The monthly coffers (salary, rent, savings)',
  '• gym — Today\'s anatomical sculpting session',
  '• meals / breakfast / lunch / dinner — Gastronomical inspirations',
  '• 120 auto  (or: spent 120 auto) — Confess an expenditure',
  '• water 500  (or: glass) — Imbibe crystalline libations',
  '• walk  (or: steps 3000 / steps set 6000) — Perambulations',
  '• ate 3 eggs p20 — Record your protein intake',
  '• task buy soap tomorrow  (or: task pay rent !) — An obligation',
  '• done soap  ·  tasks — Vanquish your to-dos',
  '• savings — Behold your burgeoning vault',
  '• salary 25160  ·  debt 2000 — Royal allocations',
  '• undo — Erase a tragic mistake',
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

function summary(s: AppState, now: Date): string {
  const today = toISO(now)
  const fv = computeFinance(s, today)
  const st = dayStats(s, today)
  const auto = deriveAutoTasks(s, fv, now)
  const open = [...auto, ...s.tasks].filter((t) => !t.done)
  const dateStr = fmtDate(today, { weekday: 'short', day: 'numeric', month: 'short' })

  const lines = [`🎭 Today with Moira (${dateStr})`]
  if (fv.pending) {
    lines.push(
      fv.waitingFirst
        ? `Alas Bébé, we await your grand salary! ${fv.cycle.daysToPayday} days until replenishment. Living on ${fmt(fv.plan.pocket / fv.cycle.totalDays)} a day.`
        : 'Our coffers are barren, Bébé! Confess your earnings: send "salary 25160".',
    )
  } else {
    const left = fv.todayLeft
    if (left < 0) {
      lines.push(`😱 Gasp! Over today's allotment by ${fmt(-left)}! Tomorrow we must fold in the cheese and tighten our corsets!`)
    } else {
      lines.push(`💰 Can lavish: ${fmt(left)} of ${fmt(fv.dailyLimit)} today`)
    }
    const weekendPot = Math.max(0, fv.lifestyle.left)
    lines.push(`🥂 Weekend & Fun Stash: ${fmt(weekendPot)} · Total Pool: ${fmt(fv.remaining)} · ${fv.cycle.daysLeft} days to payday`)
  }

  const waterPct = Math.round((st.waterMl / st.waterTarget) * 100)
  lines.push(`💧 Hydration: ${litres(st.waterMl)} / ${litres(st.waterTarget)} [${progressBar(st.waterMl, st.waterTarget)}] ${waterPct}%`)
  const stepPct = Math.round((st.steps / st.stepTarget) * 100)
  lines.push(`🚶 Perambulations: ${num(st.steps)} / ${num(st.stepTarget)} [${progressBar(st.steps, st.stepTarget)}] ${stepPct}%`)
  lines.push(`🥩 Protein: ${st.proteinG} / ${s.targets.proteinG} g`)

  if (open.length) {
    lines.push(`🎭 Sordid Obligations (${open.length}): ${open.slice(0, 3).map((t) => t.title).join('; ')}${open.length > 3 ? '…' : ''}`)
  } else {
    lines.push('✨ Not a single sordid obligation remains, darling! Glorious!')
  }
  return lines.join('\n')
}

function weekSummary(s: AppState, now: Date): string {
  const today = toISO(now)
  const fv = computeFinance(s, today)
  if (fv.pending) return 'Bébé, how can we review the week when your salary has not yet graced our books? Send "salary 25160".'

  const lines = [
    '🥂 Moira\'s Weekly Financial Soirée 🥂',
    '',
    `• Safe Weekly Pace: ${fmt(fv.weekPace)}`,
    `• Left for this week: ${fmt(Math.max(0, fv.weekLeft))}`,
    `• Weekend Outing / Movie Fund: ${fmt(Math.max(0, fv.lifestyle.left))} (protect this for that 1.5k cinema extravagance, Bébé!)`,
    `• Groceries Budget Left: ${fmt(Math.max(0, fv.groceries.left))}`,
    `• Emergency Buffer: ${fmt(Math.max(0, fv.buffer.left))}`,
    '',
    fv.todayLeft >= 0
      ? '✨ A magnificent display of restraint! Your weekend self will weep with gratitude.'
      : '⚠️ Alack! A slight indulgence this week — let us practice theatrical thrift over the coming days!'
  ]
  return lines.join('\n')
}

function monthSummary(s: AppState, now: Date): string {
  const today = toISO(now)
  const fv = computeFinance(s, today)
  const a = fv.alloc
  const lines = [
    '🏰 The Grand Monthly Vault of Affairs 🏰',
    '',
    `• Monthly Inflow: ${fmt(a.salary)}`,
    `• PG Sanctum Rent: ${fmt(a.rent)}`,
    `• Fixed Commitments (Gym/Bills): ${fmt(a.fixed)}`,
    `• Debt Obligation: ${fmt(a.debt)} (Remaining: ${fmt(fv.debt.remaining)})`,
    `• Sacred Savings (untouchable!): ${fmt(a.savings)}`,
    `• Pocket Discretionary Pool: ${fmt(fv.poolTotal)} (Remaining: ${fmt(fv.remaining)})`,
    '',
    `⏳ ${fv.cycle.daysLeft} days until the next payday curtain rises.`
  ]
  return lines.join('\n')
}

function gymSplit(now: Date): string {
  const dayIndex = now.getDay()
  const keyMap: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const key = keyMap[dayIndex]
  const focus = DAY_FOCUS[key]

  const lines = [
    `🏛️ Sculpting the Divine Silhouette — ${focus} 🏛️`,
    'Fold in the iron, Bébé! Strut with the majesty of a gazelle!',
    '',
  ]

  if (key === 'sun') {
    lines.push('Rest, darling! Replenish your radiant vessel with languid slumber and leisurely strolls.')
  } else {
    lines.push(`Focus: ${focus}`)
    lines.push('Ticking off your 60-min round-trip walk? Send: walk (+5,500 steps!)')
  }
  return lines.join('\n')
}

function mealSuggestions(slot?: string): string {
  const chosenSlot = slot || 'Meal'
  const samples = CRISIS_MEALS.slice(0, 3)

  const lines = [
    `🍳 Gastronomical Inspiration for ${chosenSlot}, Bébé! 🍳`,
    'Even in the humble kitchenette of a PG, one must dine like nobility!',
    '',
  ]

  samples.forEach((m, idx) => {
    lines.push(`${idx + 1}. ${m.title}`)
    lines.push(`   ₹${m.cost} · ${m.protein}g protein · ${m.appliances.join('/')} (${m.minutes} mins)`)
    lines.push(`   "${m.how}"`)
  })

  lines.push('')
  lines.push('When you have feasted, tell me: "ate 3 eggs p20" (or: "ate paneer bhurji p28 ₹60")')
  return lines.join('\n')
}

function limitLine(s: AppState, now: Date): string {
  const fv = computeFinance(s, toISO(now))
  if (fv.pending) return '(no pool yet: salary not entered)'
  return fv.todayLeft < 0
    ? `😱 Over today's allotment by ${fmt(-fv.todayLeft)}! Tomorrow requires theatrical thrift!`
    : `✨ Left today: ${fmt(fv.todayLeft)} · Weekend Fund: ${fmt(Math.max(0, fv.lifestyle.left))}`
}

export function runCommand(state: AppState, input: string, now: Date = new Date()): BotResult {
  const text = input.trim().replace(/^[@/!]+\s*/, '').replace(/\s+/g, ' ')
  const lower = text.toLowerCase()
  const today = toISO(now)
  const noChange = (reply: string): BotResult => ({ state, reply, changed: false })
  const done = (next: AppState, reply: string): BotResult => ({ state: next, reply, changed: true })
  if (!text) return noChange(HELP)

  const [cmdRaw, ...restTokens] = text.split(' ')
  const cmd = cmdRaw.toLowerCase().replace(/[:,.]$/, '')
  const rest = restTokens.join(' ')

  if (['help', '?', 'menu', 'start', '/start', '/help'].includes(cmd)) return noChange(HELP)
  if (['hi', 'hello', 'hey', 'heyy', 'hola'].includes(cmd)) {
    return noChange('Ah, Bébé! You grace my presence! What financial triumphs or sordid confessions do you bring to my stage today? ✨\n\nSend "today" for the grand daily summary, or "help" if you find yourself momentarily discombobulated!')
  }
  if (['bye', 'goodbye', 'cya', 'adios'].includes(cmd)) {
    return noChange('Farewell, darling! Perambulate gracefully, protect your purse strings, and do not squander your lucre on frivolous trifles! 🎭')
  }
  if (['gn', 'goodnight', 'night', 'sleep'].includes(cmd)) {
    return noChange('Retire to your chambers, Bébé! Wrap your weary carriage in the finest satin and slumber like an exiled queen. The stage awaits tomorrow! 🌙✨')
  }
  if (['gm', 'morning', 'goodmorning', 'good morning'].includes(cmd)) {
    return noChange('Good morning, my magnificent creation! The sun ascends! Imbibe your crystalline water, nourish your vessel, and seize the day with theatrical flair! 🌅')
  }
  if (['thanks', 'thank you', 'ty', 'thx'].includes(cmd)) {
    return noChange('You are exquisitely welcome, darling child! One does what one must to keep this household from the clutches of financial insolvency! 🥂')
  }
  if (lower.includes('how are you') || ['sup', 'wassup', 'whats up'].includes(cmd)) {
    return noChange('Languishing in artistic exile, but persevering with supreme elegance, Bébé! Ready to tally your expenditures and keep our coffers pristine! 🎭')
  }
  if (['today', 'day', 'status', 'balance', 'bal', 'left', 'summary', '/today'].includes(cmd)) return noChange(summary(state, now))
  if (['week', 'weekly', '/week'].includes(cmd)) return noChange(weekSummary(state, now))
  if (['month', 'monthly', '/month'].includes(cmd)) return noChange(monthSummary(state, now))
  if (['gym', 'workout', 'exercise', 'split'].includes(cmd)) return noChange(gymSplit(now))
  if (['meals', 'meal', 'food', 'breakfast', 'lunch', 'dinner', 'snack', 'cook'].includes(cmd) && !restTokens.length) {
    return noChange(mealSuggestions(cmd !== 'meals' && cmd !== 'meal' && cmd !== 'food' ? cmd : undefined))
  }
  if (cmd === 'savings' || cmd === 'vault') {
    const fv = computeFinance(state, today)
    return noChange([
      '🏰 The Sacred Vault of Moira 🏰',
      `• Untouchable Savings Floor: ${fmt(fv.savings.floorNow)}`,
      `• Debt Cleared: ${fmt(fv.debt.paidSoFar)} / ${fmt(fv.debt.total)} (Owed: ${fmt(fv.debt.remaining)})`,
      `• Emergency Stash: ${fmt(fv.buffer.left)}`,
      '',
      'One does not pilfer from the vault, Bébé. It is our fortress against penury!'
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
    const reaction = amount >= 1000
      ? '👑 A lavish, Gatsby-esque indulgence, Bébé!'
      : amount >= 300
      ? '🎭 A dramatic expenditure registered!'
      : '✨ Duly noted, darling.'
    return done(next, `${reaction} Logged ${fmt(amount)} for ${category}${title ? ` (${title})` : ''}.\n${limitLine(next, now)}`)
  }
  if (isExpenseWord) return noChange('How much lucre was surrendered, Bébé? Example: spent 120 auto')

  if (cmd === 'undo') {
    const last = [...state.expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!last) return noChange('There is nothing to undo, darling. The slate is pristine!')
    const next = A.deleteExpense(last.id)(state)
    return done(next, `Expunged ${fmt(last.amount)} (${last.title}) from the record!\n${limitLine(next, now)}`)
  }

  // ---- water
  if (cmd === 'glass') {
    const next = A.addWater(today, 250, 'Glass')(state)
    const st = dayStats(next, today)
    return done(next, `💧 +250 mL ingested! One\'s epidermis rejoices, Bébé! (${litres(st.waterMl)} / ${litres(st.waterTarget)})`)
  }
  if (['water', 'w', 'drank', 'drink'].includes(cmd)) {
    const raw = parseAmount(restTokens[0] ?? '')
    if (raw === null) {
      const st = dayStats(state, today)
      const pct = Math.round((st.waterMl / st.waterTarget) * 100)
      return noChange(`💧 Crystalline Libations: ${litres(st.waterMl)} / ${litres(st.waterTarget)} [${progressBar(st.waterMl, st.waterTarget)}] ${pct}%\nGuzzle more, Bébé! Send: water 500 or glass`)
    }
    const ml = raw <= 10 ? raw * 1000 : raw
    const next = A.addWater(today, ml, 'Water')(state)
    const st = dayStats(next, today)
    return done(next, `💧 Imbibed ${num(ml)} mL! Total: ${litres(st.waterMl)} of ${litres(st.waterTarget)}${st.waterMl >= st.waterTarget ? ' 🌟 Magnificently hydrated!' : ''}`)
  }

  // ---- steps / walk
  if (['steps', 'step', 'walked'].includes(cmd)) {
    const isSet = restTokens[0]?.toLowerCase() === 'set' || restTokens[0]?.toLowerCase() === 'total'
    const n = parseAmount(restTokens[isSet ? 1 : 0] ?? '')
    if (n === null) return noChange('How many peregrinations, Bébé? Example: steps 3000 or steps set 6000')
    const credit = dayStats(state, today).stepCredit
    const next = isSet ? A.setExtraSteps(today, Math.max(0, n - credit))(state) : A.addSteps(today, n)(state)
    const st = dayStats(next, today)
    return done(next, `🚶 Perambulations: ${num(st.steps)} of ${num(st.stepTarget)}${st.steps >= st.stepTarget ? ' 🏆 The gazelle reaches the summit!' : ` · ${num(st.stepTarget - st.steps)} paces to go`}`)
  }
  if (cmd === 'walk') {
    const already = !!(state.dayLogs[today]?.habits ?? {}).walk
    const next = already ? state : A.toggleHabit(today, 'walk')(state)
    const st = dayStats(next, today)
    return already
      ? noChange('Your majestic 60-min gym walk has already been immortalized today, darling!')
      : done(next, `🚶 The 60-min gym pilgrimage is complete! (+5,500 steps). Total: ${num(st.steps)} of ${num(st.stepTarget)}`)
  }

  // ---- meals
  if (['ate', 'eat', 'had'].includes(cmd)) {
    if (!rest) return noChange('What culinary creation did you savor, Bébé? Example: ate 3 eggs p20')
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
    return done(next, `🍽️ ${slot}: ${words.join(' ')}${protein ? ` · ${protein}g protein` : ''}${cost ? ` · ${fmt(cost)} Outside Food` : ''}\nProtein tally: ${st.proteinG} / ${next.targets.proteinG} g`)
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
    if (!title) return noChange('What sordid obligation must we record, Bébé? Example: task buy soap tomorrow')
    const category = taskCategory(title)
    const next = A.addTask({ title, category, priority, due: due ?? today })(state)
    return done(next, `📜 Enscribed in the registry: "${title}" (due ${due && due !== today ? fmtDate(due) : 'today'}${priority === 'high' ? ', urgent!' : ''})`)
  }
  if (['done', 'finished', 'complete', 'completed', 'tick'].includes(cmd)) {
    const q = rest.toLowerCase()
    if (!q) return noChange('Which chore was vanquished? Example: done soap')
    const t = state.tasks.find((x) => !x.done && x.title.toLowerCase().includes(q))
    if (!t) return noChange(`No open obligation matches "${rest}", darling. Send "tasks" to inspect them.`)
    return done(A.toggleTask(t.id)(state), `✨ Vanquished! "${t.title}" is struck from existence!`)
  }
  if (['tasks', 'list', 'todos'].includes(cmd)) {
    const fv = computeFinance(state, today)
    const open = [...deriveAutoTasks(state, fv, now), ...state.tasks].filter((t) => !t.done)
    return noChange(open.length ? `🎭 Sordid Obligations Awaiting Execution (${open.length}):\n${open.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}${t.priority === 'high' ? ' ⚡' : ''}`).join('\n')}` : '✨ The stage is clear, darling! Not a single chore remains! 🥂')
  }

  // ---- money events
  if (cmd === 'salary') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange('Confess the grand total, Bébé! Example: salary 25160')
    const fv = computeFinance(state, today)
    const next = A.receiveSalary(fv.cycle.key, n, today)(state)
    const a = computeFinance(next, today).alloc
    const perDay = a.pocket / fv.cycle.totalDays
    return done(
      next,
      `🎉 Oh, the bounty! ${fmt(n)} has descended into our coffers!\nSanctum Rent: ${fmt(a.rent)} · Commitments: ${fmt(a.fixed)} · Debt: ${fmt(a.debt)} · Sacred Savings: ${fmt(a.savings)}\nPocket Discretionary Pool: ${fmt(a.pocket)} (≈ ${fmt(perDay)}/day · ${fmt(perDay * 7)}/week)`,
    )
  }
  if (cmd === 'debt') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange('How much of the debt was banished? Example: debt 2000')
    const next = A.logDebtPayment(n, today)(state)
    if (next === state) return noChange('The shackles are already gone! We owe not a single pence to anyone! 🥂')
    return done(next, `⚔️ ${fmt(n)} paid down! Still remaining in the shadows: ${fmt(computeFinance(next, today).debt.remaining)}`)
  }

  return noChange(`I could not decipher "${text.length > 40 ? `${text.slice(0, 40)}…` : text}", Bébé.\n\n${HELP}`)
}
