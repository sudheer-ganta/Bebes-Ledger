export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** ₹12,660 — rounds to whole rupees, keeps the minus sign in front. */
export const fmt = (n: number): string => `${n < 0 ? '-' : ''}₹${inr.format(Math.abs(Math.round(n)))}`

export const num = (n: number): string => inr.format(Math.round(n))

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const pct = (part: number, whole: number) => (whole <= 0 ? 0 : clamp((part / whole) * 100, 0, 100))

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/\.?0+$/, '')} L`
