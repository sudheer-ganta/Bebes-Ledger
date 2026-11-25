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
  /** API key for Gemini (used for voice note transcription and AI chat) */
  geminiKey?: string
  /** show "typing…" (WhatsApp also marks the message read: blue ticks); optional, failures ignored */
  typingWhatsApp?: (messageId: string) => Promise<void>
  typingTelegram?: (chatId: string) => Promise<void>
  /** wait a little before replying so the typing dots are visible, like a person; off in tests */
  humanPause?: boolean
}

/** Roughly how long a person takes to type the reply: 1–3.5 s, minus the time already spent thinking. */
const pauseFor = (reply: string, spentMs: number) => Math.max(0, Math.min(3500, 900 + reply.length * 12) - spentMs)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Typing dots → work out the reply → short human pause → send. */
async function replyLikeAPerson(text: string, deps: BotDeps, typing: () => Promise<void> | undefined, send: (reply: string) => Promise<void>) {
  const started = Date.now()
  await typing()?.catch(() => undefined) // cosmetic: never block the reply on it
  const reply = await handleText(text, deps)
  if (deps.humanPause) await sleep(pauseFor(reply, Date.now() - started))
  await send(reply)
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

async function transcribeWhatsAppAudio(mediaId: string, apiVersion: string, waToken: string, geminiKey: string): Promise<string> {
  const metaRes = await fetch(`https://graph.facebook.com/${apiVersion}/${mediaId}`, {
    headers: { Authorization: `Bearer ${waToken}` },
  })
  if (!metaRes.ok) throw new Error(`Meta media metadata error: ${metaRes.status}`)
  const metaJson = (await metaRes.json()) as { url: string; mime_type?: string }

  const fileRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${waToken}` },
  })
  if (!fileRes.ok) throw new Error(`Meta media download error: ${fileRes.status}`)
  const buf = await fileRes.arrayBuffer()
  const base64Audio = Buffer.from(buf).toString('base64')
  const mimeType = metaJson.mime_type || 'audio/ogg'

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Audio,
                },
              },
              {
                text: 'Transcribe this voice message verbatim into English or Hinglish. If the speaker mentions expenses, numbers, food, water, steps, or gym, capture the exact items and numbers. Return ONLY the transcribed text, without any explanations or quotes.',
              },
            ],
          },
        ],
      }),
    }
  )

  if (!geminiRes.ok) {
    throw new Error(`Gemini transcription error: ${geminiRes.status} ${await geminiRes.text()}`)
  }
  const resJson = (await geminiRes.json()) as any
  const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  return text || ''
}

async function analyzeWhatsAppImage(
  mediaId: string,
  apiVersion: string,
  waToken: string,
  geminiKey: string,
  caption?: string
): Promise<string> {
  const metaRes = await fetch(`https://graph.facebook.com/${apiVersion}/${mediaId}`, {
    headers: { Authorization: `Bearer ${waToken}` },
  })
  if (!metaRes.ok) throw new Error(`Meta media metadata error: ${metaRes.status}`)
  const metaJson = (await metaRes.json()) as { url: string; mime_type?: string }

  const fileRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${waToken}` },
  })
  if (!fileRes.ok) throw new Error(`Meta media download error: ${fileRes.status}`)
  const buf = await fileRes.arrayBuffer()
  const base64Img = Buffer.from(buf).toString('base64')
  const mimeType = metaJson.mime_type || 'image/jpeg'

  const prompt = [
    'Analyze this image sent to an expense tracker bot.',
    'It could be a bill, restaurant receipt, UPI payment screenshot (Google Pay, PhonePe, Paytm), or grocery slip.',
    caption ? `The user also sent this caption: "${caption}"` : '',
    'Find the total amount paid in Rupees and what it was for (Merchant, store, food, ride, veg, etc.).',
    'Return ONLY a short command formatted as: "<amount> <short item/merchant name>" (e.g. "240 Swiggy" or "150 veg" or "35 chai").',
    'If you cannot find any payment or expense amount in the image, reply with "CANNOT_READ".',
  ]
    .filter(Boolean)
    .join('\n')

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Img,
                },
              },
              { text: prompt },
            ],
          },
        ],
      }),
    }
  )

  if (!geminiRes.ok) {
    throw new Error(`Gemini image error: ${geminiRes.status} ${await geminiRes.text()}`)
  }
  const resJson = (await geminiRes.json()) as any
  const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  return text || 'CANNOT_READ'
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
          id: string; from: string; type: string; text?: { body: string }; audio?: { id: string; mime_type?: string }; image?: { id: string; mime_type?: string; caption?: string }
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
        const send = (reply: string) => deps.sendWhatsApp(m.from, reply)
        let work: Promise<void>
        if (m.type === 'text' && m.text?.body) {
          work = replyLikeAPerson(m.text.body, deps, () => deps.typingWhatsApp?.(m.id), send)
        } else if (m.type === 'audio' && m.audio?.id) {
          if (!deps.geminiKey) {
            work = send(`Darling, I received your voice note, but my ear trumpets are indisposed! To enable voice transcription, add GEMINI_API_KEY to your Render environment variables. Send text for now!`)
          } else {
            work = (async () => {
              try {
                await deps.typingWhatsApp?.(m.id)
                const transcribed = await transcribeWhatsAppAudio(m.audio!.id, wa.apiVersion, wa.token, deps.geminiKey!)
                if (!transcribed) {
                  await send(`I heard only the tragic acoustics of your room, darling! Speak up or text me.`)
                  return
                }
                await replyLikeAPerson(transcribed, deps, () => deps.typingWhatsApp?.(m.id), async (reply) => {
                  await send(`🎙️ "${transcribed}"\n\n${reply}`)
                })
              } catch (e) {
                console.error('Audio transcription failed', e)
                await send(`My ears deceive me! I could not decipher that recording. Speak plainly or text me!`)
              }
            })()
          }
        } else if (m.type === 'image' && m.image?.id) {
          if (!deps.geminiKey) {
            work = send(`Darling, I received your photograph, but my bifocals are missing! To enable receipt & bill scanning, add GEMINI_API_KEY to your Render environment variables. Send text for now!`)
          } else {
            work = (async () => {
              try {
                await deps.typingWhatsApp?.(m.id)
                const command = await analyzeWhatsAppImage(m.image!.id, wa.apiVersion, wa.token, deps.geminiKey!, m.image?.caption)
                if (!command || command === 'CANNOT_READ') {
                  await send(`I examined your photograph, Sudheer, but found no legible bill or payment amount! Send a clearer picture or type the number.`)
                  return
                }
                await replyLikeAPerson(command, deps, () => deps.typingWhatsApp?.(m.id), async (reply) => {
                  await send(`🧾 Found in image: "${command}"\n\n${reply}`)
                })
              } catch (e) {
                console.error('Image analysis failed', e)
                await send(`My vision failed me, darling! I could not process that image. Type the amount for now!`)
              }
            })()
          }
        } else {
          work = send('I only understand text messages, voice notes, and receipt photos for now. Send "help" to see what I can do.')
        }
        work.catch((e) => console.error('whatsapp bot error', e))
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
      const send = (reply: string) => deps.sendTelegram(chatId, reply)
      const work = msg.text
        ? replyLikeAPerson(msg.text, deps, () => deps.typingTelegram?.(chatId), send)
        : send('I only understand text messages for now.')
      work.catch((e) => console.error('telegram bot error', e))
    })
  }

  return r
}

// ---------- real network senders ----------

export function makeSenders(cfg: BotConfig): Pick<BotDeps, 'sendWhatsApp' | 'sendTelegram' | 'typingWhatsApp' | 'typingTelegram'> {
  return {
    // Meta: marks your message read (blue ticks) and shows "typing…" until the reply or 25 s
    async typingWhatsApp(messageId) {
      const wa = cfg.whatsapp
      if (!wa) return
      const res = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
      })
      if (!res.ok) console.error('WhatsApp typing indicator failed', res.status, (await res.text()).slice(0, 200))
    },
    async typingTelegram(chatId) {
      const tg = cfg.telegram
      if (!tg) return
      await fetch(`https://api.telegram.org/bot${tg.token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      })
    },
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
