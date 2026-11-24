import 'dotenv/config'

export const isProd = process.env.NODE_ENV === 'production'

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/life-os',
  apiKey: process.env.API_KEY?.trim() || undefined,
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
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
