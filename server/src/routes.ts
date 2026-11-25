import { Router, type NextFunction, type Request, type Response } from 'express'
import mongoose from 'mongoose'
import { env } from './env.js'
import {
  Config, CrisisEvent, DayLog, DebtPayment, Expense, GroceryCheckout, Journal, MealLog, PoolTopup, Sweep, Task,
  WorkoutLog, type AnyModel,
} from './models.js'
import { loadSnapshot, saveSnapshot, SnapshotZ, touchConfig } from './state.js'
import { botDiagnostics } from './bot/webhooks.js'

export const api = Router()

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next)

// ---------- health (no auth: lets the client detect the server) ----------
api.get('/health', (_req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 })
})

// ---------- optional API key ----------
api.use((req, res, next) => {
  if (!env.apiKey) return next()
  if (req.header('x-api-key') === env.apiKey) return next()
  res.status(401).json({ error: 'Invalid or missing x-api-key' })
})

// bot diagnostics sit behind the API key: they show your number and message times
api.get('/bot-status', (_req, res) => {
  res.json(botDiagnostics)
})

// ---------- whole-state sync used by the web app ----------
api.get('/bootstrap', wrap(async (_req, res) => {
  const state = await loadSnapshot()
  res.json(state ? { empty: false, state } : { empty: true })
}))

api.put('/sync', wrap(async (req, res) => {
  const parsed = SnapshotZ.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid snapshot', issues: parsed.error.issues.slice(0, 10) })
  }
  // last-write-wins: ignore a snapshot older than what is already stored
  const current = await Config.findOne({ key: 'me' }).select('updatedAt').lean<{ updatedAt?: string }>()
  if (current?.updatedAt && current.updatedAt > parsed.data.updatedAt) {
    return res.status(409).json({ error: 'Server has newer data', updatedAt: current.updatedAt })
  }
  await saveSnapshot(parsed.data)
  res.json({ ok: true, updatedAt: parsed.data.updatedAt })
}))

// ---------- singleton config: profile, finance numbers, targets, settings, gym plan, pantry… ----------
api.get('/config', wrap(async (_req, res) => {
  const cfg = await Config.findOne({ key: 'me' }).select('-_id -key').lean()
  if (!cfg) return res.status(404).json({ error: 'Not initialised yet — PUT /api/sync or /api/config first' })
  res.json(cfg)
}))

api.put('/config', wrap(async (req, res) => {
  const body = { ...(req.body as Record<string, unknown>), key: 'me', updatedAt: new Date().toISOString() }
  const cfg = await Config.findOneAndUpdate({ key: 'me' }, { $set: body }, { upsert: true, new: true, runValidators: true })
    .select('-_id -key')
    .lean()
  res.json(cfg)
}))

// ---------- generic CRUD for list resources (keyed by client-generated `id`) ----------
function crud(path: string, Model: AnyModel, dateField?: string) {
  api.get(`/${path}`, wrap(async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string }
    const filter: Record<string, unknown> = {}
    if (dateField && (from || to)) {
      filter[dateField] = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    }
    res.json(await Model.find(filter).select('-_id').sort(dateField ? { [dateField]: -1 } : {}).lean())
  }))

  api.post(`/${path}`, wrap(async (req, res) => {
    const doc = await Model.create(req.body)
    await touchConfig()
    const { _id, ...rest } = doc.toObject()
    void _id
    res.status(201).json(rest)
  }))

  api.patch(`/${path}/:id`, wrap(async (req, res) => {
    const doc = await Model.findOneAndUpdate({ id: req.params.id }, { $set: req.body }, { new: true, runValidators: true })
      .select('-_id').lean()
    if (!doc) return res.status(404).json({ error: 'Not found' })
    await touchConfig()
    res.json(doc)
  }))

  api.delete(`/${path}/:id`, wrap(async (req, res) => {
    const r = await Model.deleteOne({ id: req.params.id })
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' })
    await touchConfig()
    res.status(204).end()
  }))
}

crud('expenses', Expense, 'date')
crud('tasks', Task, 'due')
crud('debt-payments', DebtPayment, 'date')
crud('pool-topups', PoolTopup, 'date')
crud('sweeps', Sweep, 'date')
crud('meals', MealLog, 'date')
crud('grocery-checkouts', GroceryCheckout, 'date')
crud('crisis-events', CrisisEvent, 'date')

// ---------- one-document-per-day resources: GET/PUT /api/<name>/:date ----------
function perDay(path: string, Model: AnyModel) {
  api.get(`/${path}`, wrap(async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string }
    const filter = from || to ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}
    res.json(await Model.find(filter).select('-_id').sort({ date: -1 }).lean())
  }))
  api.get(`/${path}/:date`, wrap(async (req, res) => {
    const doc = await Model.findOne({ date: req.params.date }).select('-_id').lean()
    if (!doc) return res.status(404).json({ error: 'Nothing logged for that date' })
    res.json(doc)
  }))
  api.put(`/${path}/:date`, wrap(async (req, res) => {
    const doc = await Model.findOneAndUpdate(
      { date: req.params.date }, { $set: { ...req.body, date: req.params.date } },
      { upsert: true, new: true, runValidators: true },
    ).select('-_id').lean()
    await touchConfig()
    res.json(doc)
  }))
}

perDay('day-logs', DayLog) // water, steps, habits, minimum-day flag
perDay('workouts', WorkoutLog) // sets / reps / weight per exercise
perDay('journal', Journal)
