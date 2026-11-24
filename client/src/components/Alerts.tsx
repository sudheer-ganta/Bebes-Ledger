import { AlertOctagon, AlertTriangle, CheckCircle2, Info, LifeBuoy } from 'lucide-react'
import type { Alert } from '../types'
import { navigate } from '../lib/route'
import type { CrisisSignal } from '../lib/smart'
import { cn } from '../lib/util'
import { Btn, toneBg, type Tone } from './ui'

const lvl: Record<Alert['level'], Tone> = { ok: 'ok', info: 'info', warn: 'warn', danger: 'danger' }
const icon = {
  ok: <CheckCircle2 size={16} />, info: <Info size={16} />, warn: <AlertTriangle size={16} />, danger: <AlertOctagon size={16} />,
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null
  return (
    <div className="space-y-2" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.id} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', toneBg[lvl[a.level]])}>
          <span className="mt-0.5 shrink-0">{icon[a.level]}</span>
          <p className="min-w-0 flex-1 leading-snug">{a.message}</p>
          {a.action && (
            <Btn size="sm" variant="outline" onClick={() => navigate(a.action!.to)}>{a.action.label}</Btn>
          )}
        </div>
      ))}
    </div>
  )
}

export function CrisisRadar({ signals }: { signals: CrisisSignal[] }) {
  if (signals.length === 0) return null
  return (
    <div className="space-y-2">
      {signals.map((s) => (
        <div
          key={s.type}
          className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', s.level === 'danger' ? toneBg.danger : s.level === 'warn' ? toneBg.warn : toneBg.info)}
        >
          <LifeBuoy size={18} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">{s.title}</div>
            <div className="text-xs leading-snug opacity-90">{s.message}</div>
          </div>
          <Btn size="sm" variant="outline" onClick={() => navigate(`crisis/${s.type}`)}>
            Open SOS
          </Btn>
        </div>
      ))}
    </div>
  )
}
