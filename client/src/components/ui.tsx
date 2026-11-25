import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/util'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

export const toneText: Record<Tone, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  danger: 'text-rose-700',
  info: 'text-sky-700',
  neutral: 'text-slate-600',
}
export const toneBg: Record<Tone, string> = {
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-900',
  danger: 'bg-rose-50 border-rose-200 text-rose-800',
  info: 'bg-sky-50 border-sky-200 text-sky-800',
  neutral: 'bg-slate-50 border-slate-200 text-slate-700',
}
export const toneBar: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-slate-400',
}

export function Card({
  title, icon, action, children, className, bodyClass, subtitle,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-paper shadow-[0_1px_2px_rgb(0_0_0/0.04)]', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[17px] font-semibold leading-tight text-slate-900">
              {icon && <span className="text-gold">{icon}</span>}
              <span className="truncate">{title}</span>
            </h3>
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn('px-5 pb-5 pt-3', bodyClass)}>{children}</div>
    </section>
  )
}

type BtnVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'outline' | 'success'
export function Btn({
  variant = 'soft', size = 'md', className, ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 border-slate-900 hover:border-gold shadow-[0_6px_16px_-10px_rgb(23_19_15/0.6)]',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600',
    soft: 'bg-gold-soft/70 text-slate-800 hover:bg-gold-soft border-transparent',
    outline: 'bg-paper text-slate-800 hover:bg-slate-50 hover:border-gold/60 border-line',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 border-rose-600',
  }
  const sz = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm', lg: 'h-11 px-5 text-sm' }[size]
  return (
    <button
      {...p}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        v[variant], sz, className,
      )}
    />
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none', toneBg[tone], className)}>
      {children}
    </span>
  )
}

export function Progress({ value, tone = 'ok', h = 'h-2', className }: { value: number; tone?: Tone; h?: string; className?: string }) {
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-slate-100', h, className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all duration-300', toneBar[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Ring({
  value, size = 84, stroke = 8, tone = 'ok', children,
}: { value: number; size?: number; stroke?: number; tone?: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const colour = { ok: 'var(--color-emerald-600)', warn: 'var(--color-gold)', danger: 'var(--color-rose-600)', info: 'var(--color-sky-500)', neutral: 'var(--color-slate-400)' }[tone]
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

export const inputCls =
  'h-9 w-full rounded-xl border border-line bg-paper px-3 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold-soft'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

export function Segmented<T extends string>({
  options, value, onChange, className,
}: { options: Array<{ value: T; label: ReactNode }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg border border-line bg-slate-50 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === o.value ? 'bg-paper text-slate-900 shadow-sm ring-1 ring-gold/40' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({
  active, onClick, children, tone = 'neutral', className,
}: { active?: boolean; onClick?: () => void; children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'border-slate-900 bg-slate-900 text-white' : cn('border-line bg-paper hover:border-gold/60 hover:bg-slate-50', toneText[tone]),
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Sheet({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('sheet-anim relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-paper shadow-2xl sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper px-5 py-3.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-4 safe-bottom">{children}</div>
      </div>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div>
      <div className="label-couture">{label}</div>
      <div className={cn('tnum mt-1 font-display text-2xl font-semibold', tone ? toneText[tone] : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate-500">{children}</div>
}

export function PageHeader({ title, sub, quote, right }: { title: string; sub?: ReactNode; quote?: string; right?: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          {sub && <p className="mt-1.5 text-sm text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      {quote && <p className="mt-3 max-w-2xl font-display text-[15px] italic text-slate-600">“{quote}”</p>}
      <div className="rule-gold mt-4" />
    </div>
  )
}

/** Two-step destructive button: first tap arms it ("Yes, clear?"), second tap does it. Disarms itself after 4 s. */
export function ConfirmButton({
  label, confirmLabel = 'Yes, clear', onConfirm, disabled, className,
}: { label: ReactNode; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; className?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return armed ? (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Btn size="sm" variant="danger" onClick={() => { setArmed(false); onConfirm() }}>{confirmLabel}</Btn>
      <Btn size="sm" variant="ghost" onClick={() => setArmed(false)}>Cancel</Btn>
    </span>
  ) : (
    <Btn size="sm" variant="outline" disabled={disabled} className={cn('text-rose-700', className)} onClick={() => setArmed(true)}>{label}</Btn>
  )
}
