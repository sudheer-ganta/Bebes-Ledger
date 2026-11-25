// The Gemini client itself, against a fake Google server (stubbed fetch): no network, no key, no cost.
import { hydrate } from '../../client/src/lib/hydrate'
import { runCommand } from '../src/bot/commands'
import { makeMoiraAi } from '../src/bot/moira-ai'

process.env.TZ = 'Asia/Kolkata'
const now = new Date(2026, 10, 25, 15, 0)
const state = runCommand(hydrate(null), 'salary 25160', now).state
let failed = 0
const check = (ok: boolean, why: string, got?: unknown) => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${why}${ok ? '' : `\n     got: ${JSON.stringify(got)?.slice(0, 400)}`}`)
}

const sent: Array<{ url: string; headers: Record<string, string>; body: any }> = []
let script: unknown[] = []
globalThis.fetch = (async (url: string, init: RequestInit) => {
  sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
  const next = script.shift()
  if (next === 500) return new Response('boom', { status: 500 })
  return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

const ai = makeMoiraAi({ apiKey: 'test-key', model: 'gemini-3.8-flash' })

// 1) tool call, then a text reply
script = [
  { candidates: [{ content: { role: 'model', parts: [
    { thoughtSignature: 'sig-1', functionCall: { id: 'c1', name: 'log_expense', args: { amount: 300, title: 'lunch with rahul', category: 'auto' } } },
  ] }, finishReason: 'STOP' }] },
  { candidates: [{ content: { role: 'model', parts: [{ text: 'thinking...', thought: true }, { text: 'Logged ₹300, darling.' }] }, finishReason: 'STOP' }] },
]
const r = await ai(state, 'treated rahul to lunch, 300 gone', now, [
  { role: 'user', text: 'hi' }, { role: 'assistant', text: 'What do you want?' },
])
check(r.changed && r.state.expenses.at(-1)?.amount === 300, 'function call logs the expense', r.state.expenses.at(-1))
check(r.reply === 'Logged ₹300, darling.', 'reply skips thought parts', r.reply)
check(sent[0].url.endsWith('/models/gemini-3.8-flash:generateContent') && !sent[0].url.includes('key='), 'right endpoint, key not in URL', sent[0].url)
check(sent[0].headers['x-goog-api-key'] === 'test-key', 'key sent in x-goog-api-key header')
check(sent[0].body.contents.map((c: any) => c.role).join(',') === 'user,model,user', 'history mapped to user/model roles', sent[0].body.contents)
check(sent[0].body.contents.at(-1).parts[0].text.includes('<facts>'), 'facts in the latest user turn')
check(sent[0].body.tools[0].functionDeclarations.length === 6, 'six tools declared')
const second = sent[1].body.contents
check(second.at(-2).role === 'model' && second.at(-2).parts[0].thoughtSignature === 'sig-1', 'model turn echoed back with its thought signature', second.at(-2))
const fr = second.at(-1).parts[0].functionResponse
check(second.at(-1).role === 'user' && fr.name === 'log_expense' && fr.id === 'c1' && /Logged ₹300/.test(fr.response.result), 'function result sent back with matching id', second.at(-1))

// 2) safety block → polite in-character decline, nothing changed
script = [{ candidates: [{ finishReason: 'SAFETY' }] }]
const b = await ai(state, 'something unsafe', now, [])
check(!b.changed && b.reply.startsWith('Darling, I simply cannot'), 'safety block gives a decline', b.reply)

// 3) HTTP error throws (so the bot falls back to the rule reply)
script = [500]
let threw = false
try { await ai(state, 'hello there', now, []) } catch { threw = true }
check(threw, 'HTTP error throws for the fallback')

if (failed) {
  console.error(`\n${failed} Gemini client check(s) failed`)
  process.exit(1)
}
console.log('\nall Gemini client checks passed')
