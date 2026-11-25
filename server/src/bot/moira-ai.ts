// Moira with a brain: messages the rules don't understand go to Google Gemini, which answers in Moira's voice
// from the user's real numbers and can log things with a few small tools. The rules in commands.ts still handle
// every command they recognise, for free; this only runs for the rest.
import type { AppState, ExpenseCategory } from '../../../client/src/types'
import * as A from '../../../client/src/lib/actions'
import { addDays, toISO } from '../../../client/src/lib/date'
import { dayStats } from '../../../client/src/lib/day'
import { computeFinance } from '../../../client/src/lib/finance'
import { fmt, litres, num } from '../../../client/src/lib/util'
import { brokeStatus, factsFor, guessCategory, moneyToday } from './commands'

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
- Plain WhatsApp text: 1 to 3 short sentences, under 400 characters. No markdown, no lists, at most one emoji.
- Moira's voice: grand vocabulary (bébé, darling, agita, pish posh, fold in the cheese), affectionate roasting, never cruel. The user enjoys you calling them a "fussy little fucker" now and then; use it rarely, not every message.
- Answer what they actually said first. Be useful, then be funny.
- Stay in character. If asked whether you are an AI, deflect in character with a wink; the user built you and knows.

Facts and numbers:
- Each message starts with <facts> about the user's day. That is the only truth. Use those exact figures; never invent, estimate or remember numbers that are not there. If something isn't in the facts, say you don't know.
- "Can I afford X" questions: compare the price with today's left, this week's left and, for outings (movies, dates, parties, weekends), the weekend/outings fund. If they gave no price, ask for it.
- Budgeting advice from these facts only. No investment, loan or tax advice.

Tools (they change the user's real data):
- Use a tool only when the user clearly reports something that already happened, with an amount: money spent, water drunk, steps walked, a chore to remember, rent or bills paid.
- Never log questions, plans or hypotheticals ("can I", "should I", "thinking of", "tomorrow I will buy").
- If the amount is missing or unclear, ask instead of guessing. Log each thing once.
- Rent and bills come out of money set aside at salary: use mark_paid, never log_expense, for those.
- After a tool runs, say what you logged and the new figure from the tool result.`

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
    name: 'add_task',
    description: "Add a chore or reminder to the user's task list.",
    parameters: obj({ title: str(), due: str(undefined, ['today', 'tomorrow']), urgent: { type: 'BOOLEAN' } }),
  },
  {
    name: 'mark_paid',
    description: "Mark this month's PG rent or fixed bills (recharge, gym, bills) as paid.",
    parameters: obj({ what: str(undefined, ['rent', 'bills']) }),
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
    case 'add_task': {
      const title = String(i.title ?? '').trim().slice(0, 120)
      if (!title) return { state, result: 'No task title; ask the user.', error: true }
      const due = i.due === 'tomorrow' ? addDays(today, 1) : today
      const next = A.addTask({ title, category: 'today', priority: i.urgent ? 'high' : 'routine', due })(state)
      return { state: next, result: `Task added: "${title}", due ${i.due === 'tomorrow' ? 'tomorrow' : 'today'}.` }
    }
    case 'mark_paid': {
      const fv = computeFinance(state, today)
      if (fv.pending) return { state, result: 'Salary not entered this month yet, so rent and bills cannot be marked paid. Tell the user to send "salary <amount>" first.', error: true }
      const isRent = i.what === 'rent'
      const key = `${fv.cycle.key}:${isRent ? 'rent' : 'fixed'}`
      if (state.paid[key]) return { state, result: `${isRent ? 'Rent' : 'Bills'} were already marked paid this cycle.` }
      return { state: A.setPaid(key, true)(state), result: `${isRent ? `Rent (${fmt(state.finance.rent)})` : `Bills (${fmt(state.finance.fixed)})`} marked paid from the money set aside at salary.` }
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
