import { useMemo, useState } from 'react'
import { Check, CheckCircle2, Dumbbell, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Btn, Card, ConfirmButton, inputCls, PageHeader, Progress } from '../components/ui'
import { HabitList, StepTracker, WaterTracker } from '../components/widgets'
import { useApp } from '../lib/store'
import {
  addExercise, clearDay, moveSessionToTomorrow, removeExercise, setMinimumDay, setSplitOverride, toggleMobility, updateSet,
} from '../lib/actions'
import { getDayLog, gymProgress, splitKeyFor } from '../lib/day'
import { DAY_FOCUS, DAY_KEYS, DAY_LABEL, MINIMUM_DAY_MOBILITY, SUNDAY_REVIEW } from '../lib/defaults'
import { dayKeyOf } from '../lib/date'
import { navigate } from '../lib/route'
import { cn } from '../lib/util'
import type { DayKey, Exercise, ISODate, SetLog } from '../types'

function ResetToday() {
  const { today, update, toast } = useApp()
  return <ConfirmButton label="Reset today" confirmLabel="Yes, reset today" onConfirm={() => { update(clearDay(today)); toast("Today reset: water, steps, habits, meals, gym sets and journal cleared", "info") }} />
}

export function Body() {
  return (
    <div className="rise">
      <PageHeader
        title="Body & water"
        sub="6-day split · 9,500 steps · 2.75 L water"
        right={<ResetToday />}
      />
      {/* the workout is the main column; water, steps and habits sit beside it (above it on a phone) */}
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <div className="order-2 lg:order-1 lg:col-span-8">
          <Gym />
        </div>
        <aside className="order-1 grid gap-5 sm:grid-cols-2 lg:order-2 lg:col-span-4 lg:grid-cols-1">
          <Card title="Water" subtitle="Calibrated for 51 kg · active lifter"><WaterTracker /></Card>
          <Card title="Steps" subtitle="The gym walk counts ~5,500"><StepTracker /></Card>
          <Card title="Daily habits" className="sm:col-span-2 lg:col-span-1"><HabitList /></Card>
        </aside>
      </div>
    </div>
  )
}

function lastPerformance(workouts: Record<ISODate, Record<string, SetLog[]>>, id: string, before: ISODate): string | null {
  const dates = Object.keys(workouts).filter((d) => d < before).sort().reverse()
  for (const d of dates) {
    const sets = (workouts[d][id] ?? []).filter((s) => s.done && s.weight !== '' && s.reps !== '')
    if (sets.length) {
      const best = sets.reduce((a, b) => (Number(b.weight) > Number(a.weight) ? b : a))
      return `${best.weight} kg × ${best.reps}`
    }
  }
  return null
}

function Gym() {
  const { state, today, update, toast } = useApp()
  const log = getDayLog(state, today)
  const todayKey = splitKeyFor(state, today)
  const [viewKey, setViewKey] = useState<DayKey>(todayKey)
  const gym = gymProgress(state, today)
  const minimum = log.minimumDay
  const preview = viewKey !== todayKey && !minimum

  const moveToTomorrow = () => {
    update(moveSessionToTomorrow(today, todayKey))
    setViewKey('sun')
    toast(`${DAY_FOCUS[todayKey]} moved to tomorrow. Today is active recovery — streak safe.`, 'info')
  }

  return (
    <Card
      title={minimum ? 'Minimum day · mobility reset' : `${DAY_LABEL[todayKey]} · ${DAY_FOCUS[todayKey]}`}
      subtitle={minimum ? 'Three gentle moves and the day still counts.' : 'Log each set; last week’s best is shown as a hint.'}
      icon={<Dumbbell size={14} />}
      action={<Badge tone={gym.pct >= 1 ? 'ok' : 'neutral'}>{Math.round(gym.pct * 100)}% complete</Badge>}
    >
      <Progress value={gym.pct * 100} className="mb-3" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!minimum && (
          <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1">
            {DAY_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setViewKey(k)}
                className={cn(
                  'shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  viewKey === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-line bg-paper text-slate-600 hover:border-gold/60',
                )}
              >
                {DAY_LABEL[k].slice(0, 3)}
                {k === dayKeyOf(today) && <span className={cn('ml-1', viewKey === k ? 'text-gold' : 'text-gold')}>●</span>}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {!minimum && todayKey !== 'sun' && (
            <Btn size="sm" variant="outline" onClick={moveToTomorrow}>Can't today → move to tomorrow</Btn>
          )}
          <Btn size="sm" variant={minimum ? 'soft' : 'outline'} onClick={() => update(setMinimumDay(today, !minimum))}>
            <ShieldCheck size={14} /> {minimum ? 'Back to full plan' : 'Minimum Viable Day'}
          </Btn>
        </div>
      </div>

      {minimum ? (
        <Checklist items={MINIMUM_DAY_MOBILITY} note="Low energy? Do these three and the day still counts. Targets are lowered to 2 L water and the walk's 5,500 steps." />
      ) : preview ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span>Previewing <b>{DAY_LABEL[viewKey]} · {DAY_FOCUS[viewKey]}</b> — today is {DAY_FOCUS[todayKey]}.</span>
          <Btn size="sm" variant="outline" onClick={() => { update(setSplitOverride(today, viewKey)); toast(`Today switched to ${DAY_FOCUS[viewKey]}`, 'info') }}>Do this split today</Btn>
        </div>
      ) : null}

      {!minimum && viewKey === 'sun' && (
        <Checklist items={SUNDAY_REVIEW} note="Active recovery + weekly budget & grocery review." extra={
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn size="sm" variant="outline" onClick={() => navigate('wallet')}>Open Wallet</Btn>
            <Btn size="sm" variant="outline" onClick={() => navigate('food')}>Open Groceries</Btn>
          </div>
        } />
      )}

      {!minimum && viewKey !== 'sun' && <Exercises dayKey={viewKey} canLog={!preview} />}
    </Card>
  )
}

function Checklist({ items, note, extra }: { items: Array<{ id: string; label: string }>; note: string; extra?: React.ReactNode }) {
  const { state, today, update } = useApp()
  const log = getDayLog(state, today)
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">{note}</p>
      <ul className="space-y-1">
        {items.map((m) => (
          <li key={m.id}>
            <button onClick={() => update(toggleMobility(today, m.id))} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50">
              <span className={cn('grid h-[18px] w-[18px] place-items-center rounded-md border', log.mobility[m.id] ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}>
                {log.mobility[m.id] && <Check size={12} strokeWidth={3} />}
              </span>
              <span className={cn(log.mobility[m.id] && 'text-slate-400 line-through')}>{m.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {extra}
    </div>
  )
}

function Exercises({ dayKey, canLog }: { dayKey: DayKey; canLog: boolean }) {
  const { state, today, update } = useApp()
  const exercises = state.gymPlan[dayKey] ?? []
  const [name, setName] = useState('')
  const [sets, setSets] = useState('3')
  const [reps, setReps] = useState('10')
  const day = state.workouts[today] ?? {}

  const hints = useMemo(
    () => Object.fromEntries(exercises.map((e) => [e.id, lastPerformance(state.workouts, e.id, today)])),
    [exercises, state.workouts, today],
  )

  return (
    <div className="space-y-4">
      {exercises.map((e) => (
        <ExerciseBlock key={e.id} e={e} logs={day[e.id] ?? []} hint={hints[e.id]} canLog={canLog}
          onRemove={() => update(removeExercise(dayKey, e.id))}
          onSet={(i, p) => update(updateSet(today, e, i, p))} />
      ))}
      {exercises.length === 0 && <p className="text-sm text-slate-500">No exercises yet for this day.</p>}
      <form className="flex flex-wrap items-end gap-2 border-t border-line-soft pt-3"
        onSubmit={(ev) => { ev.preventDefault(); if (!name.trim()) return; update(addExercise(dayKey, name, Math.max(1, Number(sets) || 3), reps || '10')); setName('') }}>
        <label className="min-w-40 flex-1"><span className="mb-1 block text-xs text-slate-500">Add exercise</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arnold press" /></label>
        <label className="w-16"><span className="mb-1 block text-xs text-slate-500">Sets</span>
          <input className={inputCls} type="number" min={1} value={sets} onChange={(e) => setSets(e.target.value)} /></label>
        <label className="w-20"><span className="mb-1 block text-xs text-slate-500">Reps</span>
          <input className={inputCls} value={reps} onChange={(e) => setReps(e.target.value)} /></label>
        <Btn type="submit" variant="soft"><Plus size={14} /> Add</Btn>
      </form>
    </div>
  )
}

function ExerciseBlock({
  e, logs, hint, canLog, onSet, onRemove,
}: {
  e: Exercise; logs: SetLog[]; hint: string | null; canLog: boolean
  onSet: (i: number, p: Partial<SetLog>) => void; onRemove: () => void
}) {
  const rows = Array.from({ length: e.sets }, (_, i) => logs[i] ?? { weight: '' as const, reps: '' as const, done: false })
  const done = rows.filter((r) => r.done).length
  const prefillHint = hint ? hint.match(/^([\d.]+) kg × (\d+)/) : null
  return (
    <div className="rounded-xl border border-line-soft bg-slate-50/60 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[16px] font-semibold">{e.name}</div>
          <div className="text-[11px] text-slate-500">
            {e.sets} × {e.reps}{hint && <> · last best <b className="text-slate-700">{hint}</b></>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {done === e.sets && <CheckCircle2 size={16} className="text-emerald-600" />}
          <span className="tnum text-xs text-slate-400">{done}/{e.sets}</span>
          <button onClick={onRemove} aria-label={`Remove ${e.name}`} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="grid grid-cols-[28px_1fr_1fr_36px] items-center gap-2 text-[11px] text-slate-400">
        <span>Set</span><span>Weight (kg)</span><span>Reps</span><span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className="mt-1 grid grid-cols-[28px_1fr_1fr_36px] items-center gap-2">
          <span className="tnum text-xs text-slate-500">{i + 1}</span>
          <input aria-label={`${e.name} set ${i + 1} weight`} disabled={!canLog} type="number" inputMode="decimal" min={0} step="0.5" value={r.weight}
            onChange={(ev) => onSet(i, { weight: ev.target.value === '' ? '' : Number(ev.target.value) })} className={cn(inputCls, 'h-8 tnum')} placeholder={prefillHint ? prefillHint[1] : '0'} />
          <input aria-label={`${e.name} set ${i + 1} reps`} disabled={!canLog} type="number" inputMode="numeric" min={0} value={r.reps}
            onChange={(ev) => onSet(i, { reps: ev.target.value === '' ? '' : Number(ev.target.value) })} className={cn(inputCls, 'h-8 tnum')} placeholder={prefillHint ? prefillHint[2] : e.reps} />
          <button
            disabled={!canLog}
            aria-label={`Set ${i + 1} done`}
            onClick={() => {
              const patch: Partial<SetLog> = { done: !r.done }
              if (!r.done && prefillHint) {
                if (r.weight === '') patch.weight = Number(prefillHint[1])
                if (r.reps === '') patch.reps = Number(prefillHint[2])
              }
              onSet(i, patch)
            }}
            className={cn('grid h-8 w-8 place-items-center rounded-lg border transition-colors disabled:opacity-40', r.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent hover:border-slate-500')}
          >
            <Check size={15} strokeWidth={3} />
          </button>
        </div>
      ))}
    </div>
  )
}
