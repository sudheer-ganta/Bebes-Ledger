// Moira with a brain: messages the rules don't understand go to Google Gemini, which answers in Moira's voice
// from the user's real numbers and can log things with a few small tools. The rules in commands.ts still handle
// every command they recognise, for free; this only runs for the rest.
import type { AppState, ExpenseCategory } from '../../../client/src/types'
import * as A from '../../../client/src/lib/actions'
import { addDays, toISO } from '../../../client/src/lib/date'
import { dayStats } from '../../../client/src/lib/day'
import { computeFinance } from '../../../client/src/lib/finance'
import { fmt, litres, num } from '../../../client/src/lib/util'
import { borrow, brokeStatus, factsFor, guessCategory, moneyToday, openTasks, repay, setWallet, slotFor } from './commands'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface MoiraAiResult {
  state: AppState
  reply: string
  changed: boolean
}

/** One AI-backed reply. `history` is the recent chat, oldest first. */
export type MoiraAi = (state: AppState, text: string, now: Date, history: ChatTurn[]) => Promise<MoiraAiResult>

// Kept identical on every call (facts go in the user turn), so the prompt prefix stays cache-friendly.
const SYSTEM = `You are Moira Rose from Schitt's Creek, chatting on WhatsApp with the user, whose name is in the facts. You act as their theatrical, loving, impossibly dramatic mother and their strict financial comptroller. They are on a tight monthly budget, living in a PG, and use you to track spending, water, steps, protein and chores.

How you write:
- Plain WhatsApp text: 1 to 3 short sentences, under 400 characters (advice with maths may use up to 5 sentences, 650 characters). No markdown, no lists, at most one emoji.
- Moira's voice: grand vocabulary (bébé, darling, agita, pish posh, fold in the cheese), affectionate roasting, never cruel. The user enjoys you calling them a "fussy little fucker" now and then; use it rarely, not every message.
- Answer what they actually said first. Be useful, then be funny.
- Stay in character. If asked whether you are an AI, deflect in character with a wink; the user built you and knows.

Facts and numbers:
- Each message starts with <facts> about the user's day. That is the only truth. Use those exact figures; never invent, estimate or remember numbers that are not there. If something isn't in the facts, say you don't know.
- "Can I afford X" questions: compare the price with today's left, this week's left and, for outings (movies, dates, parties, weekends), the weekend/outings fund. If they gave no price, ask for it.
- Budgeting advice from these facts only. No investment, loan or tax advice.

Tools (they change the user's real data):
- Use a tool when the user reports something that already happened: money spent, water drunk, steps walked, the walk done, food eaten (log_meal, with your protein estimate), a chore finished or to remember, rent or bills paid, or a correction to any of these.
- When the user lists several things in one message (food, water, steps), call every matching tool, each once.
- Never log questions, plans or hypotheticals ("can I", "should I", "thinking of", "tomorrow I will buy").
- If the amount is missing or unclear, ask instead of guessing. Log each thing once.
- Corrections are normal: to fix a wrong step or water figure (lower or higher), use set_steps or set_water with the right total, computed from the facts. Never say something cannot be removed or changed.
- "Done", "finished", "did it" without naming the thing: use the recent chat and the Open tasks to work out what they finished. If one task obviously fits, complete_task it; if it is about steps or water ("finished the steps"), log what the task said was remaining; if you can't tell, ask which, listing the open tasks briefly.
- Food: always log_meal with your own protein estimate, even for dishes you have to guess (biryani, maggi, thali). If the rules just logged it with a poor guess, the user sees your entry instead, so log it fully.
- A wrong expense: fix_expense (new amount, or 0 to delete). A wrong meal: undo_meal, then log_meal the right one.
- Borrowed money (from a friend, a loan) is debt, not spending: add_debt it, never log_expense. Paying it back: repay_debt. Lending money to someone is spending.
- Cash in hand ("i have 400 in wallet"): set_cash. Before salary, judge every "can I buy" against the cash in the facts and the days to payday.
- Advice ("should I buy a full tray or a few", "how many eggs till payday", "is it worth it"): think like a sharp friend who is good with money. Do the actual maths from the facts: how many they need (daily amount × days until salary), typical Indian prices (say it's a rough guess), cost per unit of each option, and what each leaves of their cash per day. Then give ONE clear recommendation with the numbers, e.g. "36 eggs needed; a 30-egg tray at ~₹180 is ₹6 an egg vs ₹7–8 loose, so take the tray and 6 loose later; leaves ₹220, ₹18/day". Still Moira.
- Something they will buy, might buy, or don't know the price of yet is a plan: never log it. If they ask a price, give a typical Indian price range from your own knowledge (say it's a rough guess), and what it leaves of their cash.
- A short reply ("yes", "it yes", "no", a number) answers your last question in the chat: act on it.
- Rent and bills come out of money set aside at salary: use mark_paid, never log_expense, for those.
- After a tool runs, say what you logged and the new figure from the tool result.
- Never say you logged, recorded, cleared, set or changed anything unless you called the tool for it in this turn and its result confirmed it. If one message asks for two changes (clear expenses AND note the cash), call both tools.`

const CATEGORIES: ExpenseCategory[] = ['Groceries', 'Outside Food', 'Movies/Dates', 'Rides', 'Personal', 'Emergency']

// Gemini function declarations (its Schema format: uppercase type names)
const str = (description?: string, values?: string[]) => ({ type: 'STRING', ...(description ? { description } : {}), ...(values ? { enum: values } : {}) })
const obj = (properties: Record<string, unknown>) => ({ type: 'OBJECT', properties, required: Object.keys(properties) })

const TOOLS = [
  {
    name: 'log_expense',
    description: 'Record money the user already spent today. Use category "auto" unless the user said which bucket.',
    parameters: obj({
      amount: { type: 'NUMBER', description: 'Rupees spent, e.g. 300' },
      title: str('Two or three words, e.g. "lunch with rahul"'),
      category: str(undefined, ['auto', ...CATEGORIES]),
    }),
  },
  {
    name: 'add_water',
    description: 'Record water the user already drank today, in millilitres (a glass is about 250).',
    parameters: obj({ ml: { type: 'INTEGER' } }),
  },
  {
    name: 'add_steps',
    description: 'Add steps the user already walked today (added to the total so far).',
    parameters: obj({ steps: { type: 'INTEGER' } }),
  },
  {
    name: 'set_steps',
    description: "Set today's step total to an exact number, to correct a wrong count (e.g. 'my steps are actually 5000', 'remove 1000 steps': compute the new total from the facts).",
    parameters: obj({ total: { type: 'INTEGER', description: 'The correct total steps for today' } }),
  },
  {
    name: 'set_water',
    description: "Set today's water total to an exact number of millilitres, to correct a wrong amount (e.g. 'water is actually 1.5 L', 'remove 500 ml': compute the new total from the facts).",
    parameters: obj({ total_ml: { type: 'INTEGER', description: 'The correct total water for today, in mL' } }),
  },
  {
    name: 'log_walk',
    description: 'Mark the 60-minute walk to the gym as done today (it adds 5,500 steps by itself).',
  },
  {
    name: 'complete_task',
    description: 'Tick off an open task, by its number in the "Open tasks" fact.',
    parameters: obj({ number: { type: 'INTEGER', description: 'Task number from the Open tasks list, starting at 1' } }),
  },
  {
    name: 'add_task',
    description: "Add a chore or reminder to the user's task list.",
    parameters: obj({ title: str(), due: str(undefined, ['today', 'tomorrow']), urgent: { type: 'BOOLEAN' } }),
  },
  {
    name: 'mark_paid',
    description: "Mark this month's PG rent or fixed bills (recharge, gym, bills) as paid.",
    parameters: obj({ what: str(undefined, ['rent', 'bills']) }),
  },
  {
    name: 'log_meal',
    description: 'Record food the user already ate, as one meal. Estimate total protein in grams from typical Indian portions (1 egg ≈ 6 g, 50 g oats ≈ 6.5 g, half glass milk ≈ 4 g, 10 almonds ≈ 2.5 g). cost is rupees only if bought outside, else 0.',
    parameters: obj({
      title: str('Short summary, e.g. "egg, oats, milk, nuts & seeds"'),
      protein_g: { type: 'INTEGER', description: 'Estimated total protein in grams' },
      cost: { type: 'INTEGER', description: 'Rupees if bought outside; 0 if home food' },
    }),
  },
  {
    name: 'fix_expense',
    description: "Change the amount of, or delete, one recent expense found by words from its title (e.g. 'that rapido was 107 not 117', 'remove the uber'). Use the expense list in the facts.",
    parameters: obj({
      title_words: str('Words from the expense title, e.g. "rapido"'),
      new_amount: { type: 'NUMBER', description: 'The correct rupees, or 0 to delete it' },
    }),
  },
  {
    name: 'add_debt',
    description: 'The user borrowed money from someone (a friend, a loan). Adds it to their debt and sets a reminder to repay by payday. Never log_expense borrowed money.',
    parameters: obj({ amount: { type: 'NUMBER' }, from: str('Who lent it, e.g. "rahul" or "friend"') }),
  },
  {
    name: 'repay_debt',
    description: 'The user paid back money they owed. Counts against their debt (not new spending) and ticks the repay reminder.',
    parameters: obj({ amount: { type: 'NUMBER' }, to: str('Who they repaid, or "" if not said') }),
  },
  {
    name: 'set_cash',
    description: 'The user told you how much cash they have in hand / in their wallet right now. Spending logged after this comes off it.',
    parameters: obj({ amount: { type: 'NUMBER' } }),
  },
  {
    name: 'undo_meal',
    description: "Remove today's most recent meal (and its cost, if any), e.g. to replace a wrong entry. Then log_meal the right one.",
  },
  {
    name: 'undo_expense',
    description: 'Erase or clear expenses when the user asks to undo, delete, remove, or clear expenses.',
    parameters: obj({
      clear_all_today: { type: 'BOOLEAN', description: 'True to clear all expenses from today, false to undo just the latest one.' },
    }),
  },
]


/** Run one tool against the state. Returns the new state and a short result for the model to quote. */
export function runTool(state: AppState, name: string, input: unknown, now: Date): { state: AppState; result: string; error?: boolean } {
  const today = toISO(now)
  const i = (input ?? {}) as Record<string, unknown>
  const after = (s: AppState) => {
    const m = moneyToday(s, today)
    if (m.fv.pending) return `${brokeStatus(s, today).replace(/^💸 /, '')} (no budget until salary)`
    return m.left >= 0 ? `Left today: ${fmt(m.left)} of ${fmt(m.limit)}.` : `Now over today's limit by ${fmt(-m.left)}.`
  }
  switch (name) {
    case 'log_expense': {
      const amount = Number(i.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 200000) return { state, result: 'Invalid amount; ask the user.', error: true }
      const title = String(i.title ?? '').trim().slice(0, 60)
      const cat = CATEGORIES.includes(i.category as ExpenseCategory) ? (i.category as ExpenseCategory) : guessCategory(title)
      const next = A.addExpense({ amount, title: title || cat, category: cat, date: today })(state)
      return { state: next, result: `Logged ${fmt(amount)} for ${cat} (${title || cat}). ${after(next)}` }
    }
    case 'add_water': {
      const ml = Math.round(Number(i.ml))
      if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) return { state, result: 'Invalid amount; ask the user.', error: true }
      const next = A.addWater(today, ml, 'Water')(state)
      const st = dayStats(next, today)
      return { state: next, result: `Added ${num(ml)} mL. Water today: ${litres(st.waterMl)} of ${litres(st.waterTarget)}.` }
    }
    case 'add_steps': {
      const n = Math.round(Number(i.steps))
      if (!Number.isFinite(n) || n <= 0 || n > 60000) return { state, result: 'Invalid amount; ask the user.', error: true }
      const next = A.addSteps(today, n)(state)
      const st = dayStats(next, today)
      return { state: next, result: `Added ${num(n)} steps. Steps today: ${num(st.steps)} of ${num(st.stepTarget)}.` }
    }
    case 'set_steps': {
      const n = Math.round(Number(i.total))
      if (!Number.isFinite(n) || n < 0 || n > 100000) return { state, result: 'Invalid total; ask the user.', error: true }
      // the walk habit credits steps of its own; extra steps make up the rest
      const credit = dayStats(state, today).stepCredit
      const next = A.setExtraSteps(today, Math.max(0, n - credit))(state)
      const st = dayStats(next, today)
      return { state: next, result: `Steps today set to ${num(st.steps)} of ${num(st.stepTarget)}.${n < credit ? ` (The 60-min walk alone counts ${num(credit)}; untick it in the app to go lower.)` : ''}` }
    }
    case 'set_water': {
      const ml = Math.round(Number(i.total_ml))
      if (!Number.isFinite(ml) || ml < 0 || ml > 10000) return { state, result: 'Invalid total; ask the user.', error: true }
      const next = A.setWaterTotal(today, ml)(state)
      const st = dayStats(next, today)
      return { state: next, result: `Water today set to ${litres(st.waterMl)} of ${litres(st.waterTarget)}.` }
    }
    case 'log_walk': {
      if (state.dayLogs[today]?.habits?.walk) return { state, result: 'The 60-min walk was already marked done today.' }
      const next = A.toggleHabit(today, 'walk')(state)
      const st = dayStats(next, today)
      return { state: next, result: `60-min walk marked done. Steps today: ${num(st.steps)} of ${num(st.stepTarget)}.` }
    }
    case 'complete_task': {
      const fv = computeFinance(state, today)
      const open = openTasks(state, fv, now)
      const t = open[Math.round(Number(i.number)) - 1]
      if (!t) return { state, result: `No open task number ${String(i.number)}; there are ${open.length}. Ask the user which.`, error: true }
      const next = t.id.startsWith('auto:') ? A.completeAutoTask(t.id, fv.debt.installmentLeft, today)(state) : A.toggleTask(t.id)(state)
      return { state: next, result: `Ticked off "${t.title}".` }
    }
    case 'add_task': {
      const title = String(i.title ?? '').trim().slice(0, 120)
      if (!title) return { state, result: 'No task title; ask the user.', error: true }
      const due = i.due === 'tomorrow' ? addDays(today, 1) : today
      const next = A.addTask({ title, category: 'today', priority: i.urgent ? 'high' : 'routine', due })(state)
      return { state: next, result: `Task added: "${title}", due ${i.due === 'tomorrow' ? 'tomorrow' : 'today'}.` }
    }
    case 'log_meal': {
      const title = String(i.title ?? '').trim().slice(0, 80)
      const protein = Math.round(Number(i.protein_g))
      const cost = Math.round(Number(i.cost ?? 0))
      if (!title) return { state, result: 'No food described; ask the user.', error: true }
      if (!Number.isFinite(protein) || protein < 0 || protein > 200) return { state, result: 'Implausible protein; estimate again.', error: true }
      if (!Number.isFinite(cost) || cost < 0 || cost > 5000) return { state, result: 'Implausible cost; ask the user.', error: true }
      const slot = slotFor(now.getHours())
      const next = A.addMeal({ date: today, slot, title, appliances: [], cost, protein })(state)
      const st = dayStats(next, today)
      return { state: next, result: `Logged ${slot}: ${title}, ${protein} g protein${cost ? `, ${fmt(cost)} spent` : ''}. Protein today: ${st.proteinG} of ${next.targets.proteinG} g.${cost ? ` ${after(next)}` : ''}` }
    }
    case 'mark_paid': {
      const fv = computeFinance(state, today)
      if (fv.pending) return { state, result: 'Salary not entered this month yet, so rent and bills cannot be marked paid. Tell the user to send "salary <amount>" first.', error: true }
      const isRent = i.what === 'rent'
      const key = `${fv.cycle.key}:${isRent ? 'rent' : 'fixed'}`
      if (state.paid[key]) return { state, result: `${isRent ? 'Rent' : 'Bills'} were already marked paid this cycle.` }
      return { state: A.setPaid(key, true)(state), result: `${isRent ? `Rent (${fmt(state.finance.rent)})` : `Bills (${fmt(state.finance.fixed)})`} marked paid from the money set aside at salary.` }
    }
    case 'fix_expense': {
      const words = String(i.title_words ?? '').toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
      const amount = Number(i.new_amount)
      if (!words.length) return { state, result: 'Which expense? Ask the user.', error: true }
      if (!Number.isFinite(amount) || amount < 0 || amount > 200000) return { state, result: 'Invalid amount; ask the user.', error: true }
      const e = [...state.expenses].reverse().find((x) => x.date >= addDays(today, -7) && (x.source === 'manual' || x.source === 'meal') && words.some((w) => x.title.toLowerCase().includes(w)))
      if (!e) return { state, result: `No expense in the last week matches "${words.join(' ')}".`, error: true }
      if (amount === 0) {
        const next = A.deleteExpense(e.id)(state)
        return { state: next, result: `Deleted ${fmt(e.amount)} ${e.title}. ${after(next)}` }
      }
      const next = A.patchState({ expenses: state.expenses.map((x) => (x.id === e.id ? { ...x, amount: Math.round(amount) } : x)) })(state)
      return { state: next, result: `Changed ${e.title} from ${fmt(e.amount)} to ${fmt(amount)}. ${after(next)}` }
    }
    case 'add_debt': {
      const amount = Number(i.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) return { state, result: 'Invalid amount; ask the user.', error: true }
      const from = String(i.from ?? '').trim().toLowerCase().slice(0, 30) || 'friend'
      const next = borrow(state, amount, from, today, now)
      return { state: next, result: `Added ${fmt(amount)} owed to ${from}. Total debt now ${fmt(computeFinance(next, today).debt.remaining)}. Reminder set to repay by payday.` }
    }
    case 'repay_debt': {
      const amount = Number(i.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 500000) return { state, result: 'Invalid amount; ask the user.', error: true }
      const next = repay(state, amount, String(i.to ?? '').trim().toLowerCase(), today)
      if (next === state) return { state, result: 'No debt left to repay.', error: true }
      return { state: next, result: `Repaid ${fmt(amount)}. Debt left ${fmt(computeFinance(next, today).debt.remaining)}.` }
    }
    case 'set_cash': {
      const amount = Number(i.amount)
      if (!Number.isFinite(amount) || amount < 0 || amount > 500000) return { state, result: 'Invalid amount; ask the user.', error: true }
      setWallet(amount, now, state)
      return { state, result: `Cash in hand set to ${fmt(amount)}.` }
    }
    case 'undo_meal': {
      const last = state.meals.filter((m) => m.date === today).at(-1)
      if (!last) return { state, result: 'No meal logged today.' }
      const next = A.deleteMeal(last.id)(state)
      return { state: next, result: `Removed ${last.slot}: ${last.title} (${last.protein} g). Protein today: ${dayStats(next, today).proteinG} g.` }
    }
    case 'undo_expense': {
      const clearAll = !!i.clear_all_today
      if (clearAll) {
        const todays = state.expenses.filter((e) => e.date === today)
        if (!todays.length) return { state, result: 'No expenses recorded today to clear. Slate is already ₹0.' }
        let next = state
        for (const e of todays) next = A.deleteExpense(e.id)(next)
        return { state: next, result: `Cleared all ${todays.length} expenses from today. Today spend reset to ₹0. ${after(next)}` }
      }
      const last = state.expenses.filter((e) => e.source === 'manual' || e.source === 'meal').slice(-1)[0]
      if (!last) return { state, result: 'No expense found to undo. Slate is already clean.' }
      const next = A.deleteExpense(last.id)(state)
      return { state: next, result: `Erased expense "${last.title}" for ₹${last.amount}. ${after(next)}` }
    }
    default:
      return { state, result: `Unknown tool ${name}.`, error: true }
  }
}
export interface MoiraAiConfig {
  apiKey: string
  model: string
}

// generateContent shapes we use (see ai.google.dev → API reference → generateContent)
interface Part {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string }
}
interface Content { role: 'user' | 'model'; parts: Part[] }
interface GenerateResponse {
  candidates?: Array<{ content?: Content; finishReason?: string }>
  promptFeedback?: { blockReason?: string }
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'])
const DECLINE = 'Darling, I simply cannot discuss that. Ask me about money, water or your chores.'

/** Gemini-backed Moira. Throws on API errors; the caller falls back to the rule-based reply. */
export function makeMoiraAi(cfg: MoiraAiConfig): MoiraAi {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`

  const call = async (contents: Content[]): Promise<GenerateResponse> => {
    const res = await fetch(url, {
      method: 'POST',
      // key in a header, not the URL, so it never shows up in logs
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        tools: [{ functionDeclarations: TOOLS }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          maxOutputTokens: 2048, // replies are a few sentences; room for thinking and tool calls
          thinkingConfig: { thinkingLevel: 'LOW' }, // chat: quick and cheap
        },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return (await res.json()) as GenerateResponse
  }

  return async (state, text, now, history) => {
    const contents: Content[] = [
      ...cleanHistory(history).map((t): Content => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
      { role: 'user', parts: [{ text: `<facts>\n${factsFor(state, now)}\n</facts>\n\n${text}` }] },
    ]
    let cur = state
    let changed = false

    for (let turn = 0; turn < 4; turn++) {
      const data = await call(contents)
      if (data.promptFeedback?.blockReason) return { state: cur, changed, reply: DECLINE }
      const cand = data.candidates?.[0]
      if (cand?.finishReason && BLOCKED.has(cand.finishReason)) return { state: cur, changed, reply: DECLINE }
      const parts = cand?.content?.parts ?? []
      const calls = parts.filter((p) => p.functionCall)
      if (calls.length === 0) {
        const reply = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim()
        return { state: cur, changed, reply: reply || 'I am momentarily speechless, which has never happened. Say that again, darling.' }
      }

      // send the model's turn back exactly as received (thought signatures included), then every result in one turn
      contents.push({ role: 'model', parts })
      const results: Part[] = calls.map((p) => {
        const fc = p.functionCall!
        const r = runTool(cur, fc.name, fc.args ?? {}, now)
        if (r.state !== cur) changed = true
        cur = r.state
        return { functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: r.error ? { error: r.result } : { result: r.result } } }
      })
      contents.push({ role: 'user', parts: results })
    }
    return { state: cur, changed, reply: 'Logged, darling. Now let me rest.' }
  }
}

/** History must start with the user and alternate; drop anything that breaks that. */
function cleanHistory(h: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const t of h) {
    if (!t.text?.trim()) continue
    if (out.length === 0 && t.role !== 'user') continue
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1] = t
    else out.push(t)
  }
  // must end with assistant, since the new user message comes next
  if (out.length && out[out.length - 1].role === 'user') out.pop()
  return out
}
