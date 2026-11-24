import 'dotenv/config'

// Dates in the app are "your" dates (payday, today's limit): run the server on Indian time unless told otherwise.
process.env.TZ = process.env.TIMEZONE ?? 'Asia/Kolkata'

export const isProd = process.env.NODE_ENV === 'production'

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/life-os',
  apiKey: process.env.API_KEY?.trim() || undefined,
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
}

const list = (v?: string) => (v ?? '').split(',').map((s) => s.replace(/\s/g, '')).filter(Boolean)
const wa = process.env
// A bot channel is only switched on when everything it needs is set: no secret / no allowlist = no endpoint at all.
export const bots = {
  whatsapp:
    wa.WHATSAPP_TOKEN && wa.WHATSAPP_PHONE_ID && wa.WHATSAPP_VERIFY_TOKEN && wa.WHATSAPP_APP_SECRET && list(wa.WHATSAPP_ALLOWED).length
      ? {
          token: wa.WHATSAPP_TOKEN, phoneId: wa.WHATSAPP_PHONE_ID, verifyToken: wa.WHATSAPP_VERIFY_TOKEN,
          appSecret: wa.WHATSAPP_APP_SECRET, allowed: list(wa.WHATSAPP_ALLOWED).map((n) => n.replace(/\D/g, '')),
          apiVersion: wa.WHATSAPP_API_VERSION ?? 'v25.0',
        }
      : undefined,
  telegram:
    wa.TELEGRAM_TOKEN && wa.TELEGRAM_SECRET && list(wa.TELEGRAM_ALLOWED).length
      ? { token: wa.TELEGRAM_TOKEN, secret: wa.TELEGRAM_SECRET, allowed: list(wa.TELEGRAM_ALLOWED) }
      : undefined,
}

// There is no login screen: the API key is the only thing protecting salary, debt and spending data once the
// server is reachable from the internet. So a production server will not start without a strong one.
if (isProd) {
  if (!env.apiKey || env.apiKey.length < 16) {
    console.error('Refusing to start: set API_KEY to a random string of at least 16 characters (NODE_ENV=production).')
    process.exit(1)
  }
  if (!process.env.MONGODB_URI) {
    console.error('Refusing to start: set MONGODB_URI (NODE_ENV=production).')
    process.exit(1)
  }
}
