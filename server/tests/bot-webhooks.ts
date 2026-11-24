import crypto from 'node:crypto'
import express from 'express'
import { hydrate } from '../../client/src/lib/hydrate'
import type { AppState } from '../../client/src/types'
import { botRouter, type BotDeps } from '../src/bot/webhooks'

process.env.TZ = 'Asia/Kolkata'
const cfg = {
  whatsapp: { token: 't', phoneId: '123', verifyToken: 'verify-me', appSecret: 'app-secret', allowed: ['919876543210'], apiVersion: 'v23.0' },
  telegram: { token: 'tg', secret: 'tg-secret', allowed: ['555'] },
}

let stored: AppState | null = hydrate(null)
const sent: string[] = []
let saves = 0
const deps: BotDeps = {
  load: async () => stored as unknown as Record<string, unknown> | null,
  save: async (s) => { stored = s; saves++ },
  sendWhatsApp: async (to, text) => { sent.push(`WA→${to}: ${text.split('\n')[0]}`) },
  sendTelegram: async (id, text) => { sent.push(`TG→${id}: ${text.split('\n')[0]}`) },
}

const app = express()
app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf } }))
app.use('/webhook', botRouter(cfg, deps))
const server = app.listen(0)
const base = `http://localhost:${(server.address() as { port: number }).port}/webhook`
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const waBody = (from: string, text: string, id: string) =>
  JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] })
const sign = (body: string, secret = 'app-secret') => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
const post = (path: string, body: string, headers: Record<string, string>) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }).then((r) => r.status)

const results: Array<[string, unknown]> = []
// 1) Meta's one-time verification handshake
let r = await fetch(`${base}/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=CHALLENGE42`)
results.push(['verify ok → 200 + echoes challenge', `${r.status} ${await r.text()}`])
r = await fetch(`${base}/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x`)
results.push(['verify wrong token → 403', r.status])

// 2) genuine message from you
let b = waBody('919876543210', '@spent 120 auto', 'wamid.1')
results.push(['valid signature, your number → 200', await post('/whatsapp', b, { 'x-hub-signature-256': sign(b) })]); await wait(300)
// 3) forged signature
b = waBody('919876543210', '@spent 999 auto', 'wamid.2')
results.push(['forged signature → 401', await post('/whatsapp', b, { 'x-hub-signature-256': sign(b, 'wrong-secret') })])
results.push(['no signature → 401', await post('/whatsapp', b, {})])
// 4) someone else's number (valid signature)
b = waBody('911111111111', '@spent 777 gift', 'wamid.3')
results.push(['valid signature, stranger number → 200 but ignored', await post('/whatsapp', b, { 'x-hub-signature-256': sign(b) })]); await wait(300)
// 5) duplicate delivery (Meta retries)
b = waBody('919876543210', '@spent 120 auto', 'wamid.1')
results.push(['duplicate message id → 200, not applied twice', await post('/whatsapp', b, { 'x-hub-signature-256': sign(b) })]); await wait(300)
// 6) number with + and spaces matches allowlist; second real command
b = waBody('919876543210', '@water 500', 'wamid.4')
await post('/whatsapp', b, { 'x-hub-signature-256': sign(b) }); await wait(300)

// 7) telegram
const tgBody = (chat: number, text: string, uid: number) => JSON.stringify({ update_id: uid, message: { message_id: 1, chat: { id: chat }, text } })
results.push(['telegram wrong secret → 401', await post('/telegram', tgBody(555, 'today', 1), { 'x-telegram-bot-api-secret-token': 'nope' })])
results.push(['telegram right secret, your chat → 200', await post('/telegram', tgBody(555, '@today', 2), { 'x-telegram-bot-api-secret-token': 'tg-secret' })]); await wait(300)
await post('/telegram', tgBody(999, '@spent 500 x', 3), { 'x-telegram-bot-api-secret-token': 'tg-secret' }); await wait(300)

// 8) empty database
stored = null
b = waBody('919876543210', '@today', 'wamid.5')
await post('/whatsapp', b, { 'x-hub-signature-256': sign(b) }); await wait(300)

for (const [k, v] of results) console.log(String(v).padEnd(14), '←', k)
console.log('\nreplies sent:'); sent.forEach((s) => console.log('  ', s))
console.log('\nsaves:', saves, '(expected 2: one expense + one water)')
server.close()
