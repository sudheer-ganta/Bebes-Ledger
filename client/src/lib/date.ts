import type { ISODate } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

export const toISO = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Parse 'YYYY-MM-DD' as a local-midnight Date. */
export const fromISO = (s: ISODate): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (s: ISODate, n: number): ISODate => {
  const d = fromISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export const diffDays = (a: ISODate, b: ISODate): number =>
  Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000)

export const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate()

/** Monday of the week containing s. */
export const weekStartOf = (s: ISODate): ISODate => {
  const d = fromISO(s)
  const dow = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow)
  return toISO(d)
}

export const dayKeyOf = (s: ISODate): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' =>
  (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[fromISO(s).getDay()]

export const isSunday = (s: ISODate) => fromISO(s).getDay() === 0

export const fmtDate = (s: ISODate, opts?: Intl.DateTimeFormatOptions) =>
  fromISO(s).toLocaleDateString('en-IN', opts ?? { day: 'numeric', month: 'short' })

export const fmtLong = (s: ISODate) =>
  fromISO(s).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

export const nowISO = () => new Date().toISOString()
