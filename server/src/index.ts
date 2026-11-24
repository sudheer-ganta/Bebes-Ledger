import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import { env } from './env.js'
import { api } from './routes.js'

const app = express()
app.disable('x-powered-by')
// helmet's default CSP adds upgrade-insecure-requests, which breaks plain-http use on a home network
app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } } }))
app.use(cors({ origin: env.corsOrigins }))
app.use(express.json({ limit: '5mb' }))
app.use('/api', api)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route' })
})

// In production one server does everything: the API above and the built web app (client/dist) below.
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url))
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, file) {
        // always revalidate the shell so a new deploy shows up right away
        if (/(index\.html|sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  console.log(`Serving the web app from ${clientDist}`)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { name?: string; message?: string; code?: number }
  if (e.name === 'ValidationError' || e.name === 'CastError') {
    return res.status(400).json({ error: e.message })
  }
  if (e.code === 11000) return res.status(409).json({ error: 'Duplicate id' })
  console.error(err)
  res.status(500).json({ error: 'Server error' })
})

// The HTTP server starts even if MongoDB is down: /api/health reports { db:false } and the web app
// keeps working from localStorage until the database is reachable again.
app.listen(env.port, () => {
  console.log(`Life OS API listening on http://localhost:${env.port}`)
})

async function connect() {
  for (;;) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 4000 })
      console.log('MongoDB connected')
      return
    } catch (e) {
      console.error(`MongoDB not reachable (${(e as Error).message.split('\n')[0]}) — retrying in 10 s`)
      await new Promise((r) => setTimeout(r, 10_000))
    }
  }
}
void connect()
