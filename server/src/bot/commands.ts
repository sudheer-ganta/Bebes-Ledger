// Chat command handler shared by the WhatsApp and Telegram bots.
// It reuses the web app's own logic (client/src/lib) so a number in chat always matches what the app shows.
import type { AppState, ExpenseCategory, MealSlot, Priority, TaskCategory } from '../../../client/src/types'
import * as A from '../../../client/src/lib/actions'
import { addDays, fmtDate, toISO } from '../../../client/src/lib/date'
import { dayStats } from '../../../client/src/lib/day'
import { computeFinance } from '../../../client/src/lib/finance'
import { deriveAutoTasks } from '../../../client/src/lib/smart'
import { fmt, litres, num } from '../../../client/src/lib/util'

export interface BotResult {
  state: AppState
  reply: string
  changed: boolean
}

export const HELP = [
  'Life OS bot. Send things like:',
  '• spent 120 auto  (or just: 120 auto)',
  '• chai 20  ·  veg 150 #groceries',
  '• water 500  ·  water 2 (litres)  ·  glass',
  '• steps 3000  ·  steps set 6000  ·  walk',
  '• ate 3 eggs p20  (p20 = 20 g protein)',
  '• task buy soap tomorrow  ·  task pay rent !',
  '• done soap  ·  tasks',
  '• salary 25160  ·  debt 2000',
  '• today  ·  undo  ·  help',
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

/** "120", "₹1,200", "1.5k" → number, or null. */
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

function summary(s: AppState, now: Date): string {
  const today = toISO(now)
  const fv = computeFinance(s, today)
  const st = dayStats(s, today)
  const auto = deriveAutoTasks(s, fv, now)
  const open = [...auto, ...s.tasks].filter((t) => !t.done)
  const lines = [`Today (${fmtDate(today, { weekday: 'short', day: 'numeric', month: 'short' })})`]
  if (fv.pending) {
    lines.push(
      fv.waitingFirst
        ? `Waiting for salary: ${fv.cycle.daysToPayday} days to payday. Plan: ${fmt(fv.plan.pocket / fv.cycle.totalDays)} a day.`
        : 'Salary not entered yet. Send: salary 25160',
    )
  } else {
    const left = fv.todayLeft
    lines.push(left < 0 ? `Over today's limit by ${fmt(-left)} (limit ${fmt(fv.dailyLimit)})` : `Can spend: ${fmt(left)} of ${fmt(fv.dailyLimit)} today`)
    lines.push(`This week left: ${fmt(Math.max(0, fv.weekLeft))} · Pool: ${fmt(fv.remaining)} · ${fv.cycle.daysLeft} days to payday`)
  }
  lines.push(`Water ${litres(st.waterMl)} / ${litres(st.waterTarget)} · Steps ${num(st.steps)} / ${num(st.stepTarget)}`)
  if (open.length) {
    lines.push(`To-dos (${open.length}): ${open.slice(0, 4).map((t) => t.title).join('; ')}${open.length > 4 ? '…' : ''}`)
  }
  return lines.join('\n')
}

function limitLine(s: AppState, now: Date): string {
  const fv = computeFinance(s, toISO(now))
  if (fv.pending) return '(no pool yet: salary not entered)'
  return fv.todayLeft < 0
    ? `Over today's limit by ${fmt(-fv.todayLeft)}`
    : `Left today ${fmt(fv.todayLeft)} · this week ${fmt(Math.max(0, fv.weekLeft))}`
}

export function runCommand(state: AppState, input: string, now: Date = new Date()): BotResult {
  // an optional leading "@" (or "/") marks a message as a command: "@spent 120 auto" works the same as "spent 120 auto"
  const text = input.trim().replace(/^[@/!]+\s*/, '').replace(/\s+/g, ' ')
  const lower = text.toLowerCase()
  const today = toISO(now)
  const noChange = (reply: string): BotResult => ({ state, reply, changed: false })
  const done = (next: AppState, reply: string): BotResult => ({ state: next, reply, changed: true })
  if (!text) return noChange(HELP)

  const [cmdRaw, ...restTokens] = text.split(' ')
  const cmd = cmdRaw.toLowerCase().replace(/[:,.]$/, '')
  const rest = restTokens.join(' ')

  if (['help', 'hi', 'hello', 'hey', '?', 'menu', 'start', '/start', '/help'].includes(cmd)) return noChange(HELP)
  if (['today', 'status', 'balance', 'bal', 'left', 'summary', '/today'].includes(cmd)) return noChange(summary(state, now))

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
    return done(next, `Logged ${fmt(amount)} · ${category}${title ? ` (${title})` : ''}\n${limitLine(next, now)}`)
  }
  if (isExpenseWord) return noChange('How much? Example: spent 120 auto')

  if (cmd === 'undo') {
    const last = [...state.expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (!last) return noChange('Nothing to undo.')
    const next = A.deleteExpense(last.id)(state)
    return done(next, `Removed ${fmt(last.amount)} · ${last.title}\n${limitLine(next, now)}`)
  }

  // ---- water
  if (cmd === 'glass') {
    const next = A.addWater(today, 250, 'Glass')(state)
    const st = dayStats(next, today)
    return done(next, `+250 ml · ${litres(st.waterMl)} of ${litres(st.waterTarget)}`)
  }
  if (['water', 'w', 'drank', 'drink'].includes(cmd)) {
    const raw = parseAmount(restTokens[0] ?? '')
    if (raw === null) return noChange('How much? Example: water 500 (ml) or water 2 (litres)')
    const ml = raw <= 10 ? raw * 1000 : raw
    const next = A.addWater(today, ml, 'Water')(state)
    const st = dayStats(next, today)
    return done(next, `+${num(ml)} ml · ${litres(st.waterMl)} of ${litres(st.waterTarget)}${st.waterMl >= st.waterTarget ? ' ✅ target hit' : ''}`)
  }

  // ---- steps / walk
  if (['steps', 'step', 'walked'].includes(cmd)) {
    const isSet = restTokens[0]?.toLowerCase() === 'set' || restTokens[0]?.toLowerCase() === 'total'
    const n = parseAmount(restTokens[isSet ? 1 : 0] ?? '')
    if (n === null) return noChange('How many? Example: steps 3000 (adds) or steps set 6000 (total so far)')
    const credit = dayStats(state, today).stepCredit
    const next = isSet ? A.setExtraSteps(today, Math.max(0, n - credit))(state) : A.addSteps(today, n)(state)
    const st = dayStats(next, today)
    return done(next, `Steps ${num(st.steps)} of ${num(st.stepTarget)}${st.steps >= st.stepTarget ? ' ✅ target hit' : ` · ${num(st.stepTarget - st.steps)} to go`}`)
  }
  if (cmd === 'walk') {
    const already = !!(state.dayLogs[today]?.habits ?? {}).walk
    const next = already ? state : A.toggleHabit(today, 'walk')(state)
    const st = dayStats(next, today)
    return already ? noChange('Gym walk already ticked.') : done(next, `Gym walk ticked (+5,500 steps). Steps ${num(st.steps)} of ${num(st.stepTarget)}`)
  }

  // ---- meals
  if (['ate', 'eat', 'meal', 'had'].includes(cmd)) {
    if (!rest) return noChange('What did you eat? Example: ate 3 eggs p20')
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
    return done(next, `${slot}: ${words.join(' ')}${protein ? ` · ${protein} g protein` : ''}${cost ? ` · ${fmt(cost)} added to Outside Food` : ''}\nProtein today ${st.proteinG} of ${next.targets.proteinG} g`)
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
    if (!title) return noChange('What task? Example: task buy soap tomorrow')
    const category = taskCategory(title)
    const next = A.addTask({ title, category, priority, due: due ?? today })(state)
    return done(next, `Added: ${title} (due ${due && due !== today ? fmtDate(due) : 'today'}${priority === 'high' ? ', high priority' : ''})`)
  }
  if (['done', 'finished', 'complete', 'completed', 'tick'].includes(cmd)) {
    const q = rest.toLowerCase()
    if (!q) return noChange('Which task? Example: done soap')
    const t = state.tasks.find((x) => !x.done && x.title.toLowerCase().includes(q))
    if (!t) return noChange(`No open task matching "${rest}". Send "tasks" to see them.`)
    return done(A.toggleTask(t.id)(state), `Done ✅ ${t.title}`)
  }
  if (['tasks', 'list', 'todos'].includes(cmd)) {
    const fv = computeFinance(state, today)
    const open = [...deriveAutoTasks(state, fv, now), ...state.tasks].filter((t) => !t.done)
    return noChange(open.length ? `To-dos (${open.length}):\n${open.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}${t.priority === 'high' ? ' !' : ''}`).join('\n')}` : 'No open to-dos. 🎉')
  }

  // ---- money events
  if (cmd === 'salary') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange('How much? Example: salary 25160')
    const fv = computeFinance(state, today)
    const next = A.receiveSalary(fv.cycle.key, n, today)(state)
    const a = computeFinance(next, today).alloc
    const perDay = a.pocket / fv.cycle.totalDays
    return done(
      next,
      `Salary ${fmt(n)} allocated\nRent ${fmt(a.rent)} · Bills ${fmt(a.fixed)} · Debt ${fmt(a.debt)} · Savings ${fmt(a.savings)}\nPocket pool ${fmt(a.pocket)} ≈ ${fmt(perDay)}/day · ${fmt(perDay * 7)}/week`,
    )
  }
  if (cmd === 'debt') {
    const n = parseAmount(restTokens[0] ?? '')
    if (n === null) return noChange('How much? Example: debt 2000')
    const next = A.logDebtPayment(n, today)(state)
    if (next === state) return noChange('Debt is already cleared 🎉')
    return done(next, `Debt payment ${fmt(n)} logged. Still owed: ${fmt(computeFinance(next, today).debt.remaining)}`)
  }

  return noChange(`I didn't get "${text.length > 40 ? `${text.slice(0, 40)}…` : text}".\n\n${HELP}`)
}
