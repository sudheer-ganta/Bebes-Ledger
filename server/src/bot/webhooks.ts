import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import type { AppState } from '../../../client/src/types'
import { hydrate } from '../../../client/src/lib/hydrate'
import { toISO } from '../../../client/src/lib/date'
import type { MoiraAi } from './moira-ai'
import { emptyMemory, runCommand, type BotMemory } from './commands'

export interface BotConfig {
  whatsapp?: { token: string; phoneId: string; verifyToken: string; appSecret: string; allowed: string[]; apiVersion: string }
  telegram?: { token: string; secret: string; allowed: string[] }
}

/** Storage + network seams, so the whole flow can be tested without MongoDB or the internet. */
export interface BotDeps {
  load: () => Promise<Record<string, unknown> | null>
  save: (s: AppState) => Promise<void>
  sendWhatsApp: (to: string, text: string) => Promise<void>
  sendTelegram: (chatId: string, text: string) => Promise<void>
  now?: () => Date
  /** Moira's memory between messages; optional, and a failure here never blocks a reply */
  loadMemory?: () => Promise<BotMemory | null>
  saveMemory?: (m: BotMemory) => Promise<void>
  /** Gemini-backed Moira for messages the rules don't understand; off when not set */
  askMoira?: MoiraAi
  /** most Gemini replies per day (protects the API bill); default 30 */
  aiDailyLimit?: number
}

const HISTORY_TURNS = 12 // 6 back-and-forths

export const digits = (s: string) => s.replace(/\D/g, '')

// one message at a time, so two quick messages can't overwrite each other's change
let chain: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

export function handleText(text: string, deps: BotDeps): Promise<string> {
  return serial(async () => {
    let raw: Record<string, unknown> | null
    try {
      raw = await deps.load()
    } catch {
      return 'The database is not reachable right now. Try again in a minute.'
    }
    if (!raw) return 'No data on the server yet. Open Life OS once, go to Settings → Data & sync and connect it, then try again.'
    const now = deps.now?.() ?? new Date()
    const memory = (await deps.loadMemory?.().catch(() => null)) ?? emptyMemory()
    const state = hydrate(raw as Partial<AppState>)
    let result: { state: AppState; reply: string; changed: boolean; fallback?: boolean; memory: BotMemory } =
      runCommand(state, text, now, memory)
    const mem = result.memory
    const history = mem.history ?? []

    // the rules didn't understand: let Gemini answer, within today's cap; on any error keep the rule reply
    const day = toISO(now)
    const used = mem.ai?.day === day ? mem.ai.count : 0
    // only real sentences (4+ words) our own brain could not place; "hmm" or "ok la" never costs anything
    const worthAsking = text.trim().split(/\s+/).length >= 4
    if (result.fallback && worthAsking && deps.askMoira && used < (deps.aiDailyLimit ?? 30)) {
      try {
        const ai = await deps.askMoira(state, text, now, history)
        mem.ai = { day, count: used + 1 }
        result = { ...ai, memory: mem }
      } catch (e) {
        console.error('bot: Gemini failed, using rule reply', e instanceof Error ? e.message : e)
      }
    }

    mem.history = [...history, { role: 'user' as const, text: text.slice(0, 500) }, { role: 'assistant' as const, text: result.reply.slice(0, 500) }].slice(-HISTORY_TURNS)
    await deps.saveMemory?.(mem).catch((e) => console.error('bot: memory save failed', e))
    if (result.changed) {
      try {
        await deps.save(result.state)
      } catch (e) {
        console.error('bot: save failed', e)
        return 'I understood that but could not save it. Please try again.'
      }
    }
    return result.reply
  })
}

const seen = new Set<string>()
const remember = (id: string) => {
  if (seen.has(id)) return false
  seen.add(id)
  if (seen.size > 500) seen.delete(seen.values().next().value as string)
  return true
}

function validSignature(req: Request, secret: string): boolean {
  const header = req.header('x-hub-signature-256') ?? ''
  const raw = (req as Request & { rawBody?: Buffer }).rawBody
  if (!raw || !header.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const got = header.slice('sha256='.length)
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

export const botDiagnostics = {
  lastIncoming: null as any,
  lastOutgoing: null as any,
  configured: {
    whatsapp: false,
    phoneId: '',
    allowed: [] as string[],
    tokenLength: 0,
  },
}

export function botRouter(cfg: BotConfig, deps: BotDeps): Router {
  const r = Router()

  if (cfg.whatsapp) {
    const wa = cfg.whatsapp
    botDiagnostics.configured = {
      whatsapp: true,
      phoneId: wa.phoneId,
      allowed: wa.allowed,
      tokenLength: wa.token.length,
    }

    // Meta calls this once when you save the webhook in the developer dashboard.
    r.get('/whatsapp', (req: Request, res: Response) => {
      if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === wa.verifyToken) {
        return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''))
      }
      res.sendStatus(403)
    })

    r.post('/whatsapp', (req: Request, res: Response) => {
      // Only Meta knows the app secret, so a valid signature proves the request is genuine.
      if (!validSignature(req, wa.appSecret)) return res.sendStatus(401)
      res.sendStatus(200) // answer fast; Meta retries if we are slow
      const messages =
        (req.body?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.messages ?? [])) as Array<{
          id: string; from: string; type: string; text?: { body: string }
        }>
      botDiagnostics.lastIncoming = {
        at: new Date().toISOString(),
        count: messages.length,
        froms: messages.map((m) => m.from),
        // lengths only: message text (amounts, plans) never leaves the server
        textLengths: messages.map((m) => m.text?.body?.length ?? 0),
      }
      for (const m of messages) {
        if (!remember(m.id)) continue
        if (!wa.allowed.includes(digits(m.from))) continue // silently ignore everyone except you
        void (async () => {
          const reply = m.type === 'text' && m.text?.body ? await handleText(m.text.body, deps) : 'I only understand text messages for now. Send "help" to see what I can do.'
          await deps.sendWhatsApp(m.from, reply)
        })().catch((e) => console.error('whatsapp bot error', e))
      }
    })
  }

  if (cfg.telegram) {
    const tg = cfg.telegram
    r.post('/telegram', (req: Request, res: Response) => {
      const given = req.header('x-telegram-bot-api-secret-token') ?? ''
      const ok = given.length === tg.secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(tg.secret))
      if (!ok) return res.sendStatus(401)
      res.sendStatus(200)
      const msg = req.body?.message as { message_id: number; chat: { id: number }; text?: string } | undefined
      if (!msg) return
      const chatId = String(msg.chat.id)
      if (!remember(`tg:${req.body.update_id}`)) return
      if (!tg.allowed.includes(chatId)) return
      void (async () => {
        const reply = msg.text ? await handleText(msg.text, deps) : 'I only understand text messages for now.'
        await deps.sendTelegram(chatId, reply)
      })().catch((e) => console.error('telegram bot error', e))
    })
  }

  return r
}

// ---------- real network senders ----------

export function makeSenders(cfg: BotConfig): Pick<BotDeps, 'sendWhatsApp' | 'sendTelegram'> {
  return {
    async sendWhatsApp(to, text) {
      const wa = cfg.whatsapp
      if (!wa) return
      try {
        const res = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000) } }),
        })
        const body = await res.text()
        botDiagnostics.lastOutgoing = {
          at: new Date().toISOString(),
          to,
          status: res.status,
          ok: res.ok,
          response: body.slice(0, 500),
        }
        if (!res.ok) console.error('WhatsApp send failed', res.status, body.slice(0, 300))
      } catch (err: any) {
        botDiagnostics.lastOutgoing = {
          at: new Date().toISOString(),
          to,
          error: err.message,
        }
        console.error('WhatsApp fetch error', err)
      }
    },
    async sendTelegram(chatId, text) {
      const tg = cfg.telegram
      if (!tg) return
      const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
      })
      if (!res.ok) console.error('Telegram send failed', res.status, (await res.text()).slice(0, 300))
    },
  }
}
