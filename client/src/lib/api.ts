import type { AppState } from '../types'

// The app is offline-first: localStorage is always the working copy.
// When the Express + MongoDB server is reachable, state is mirrored to it (last-write-wins on `updatedAt`).
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const key = localStorage.getItem('life-os-api-key')
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'x-api-key': key } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function probe(timeoutMs = 2000): Promise<boolean> {
  try {
    const h = await req<{ ok: boolean; db: boolean }>('/health', undefined, timeoutMs)
    return !!h.ok && !!h.db
  } catch {
    return false
  }
}

export async function pull(): Promise<AppState | null> {
  const r = await req<{ empty: boolean; state?: AppState }>('/bootstrap')
  return r.empty || !r.state ? null : r.state
}

export async function push(state: AppState): Promise<void> {
  await req('/sync', { method: 'PUT', body: JSON.stringify(state) }, 15000)
}
