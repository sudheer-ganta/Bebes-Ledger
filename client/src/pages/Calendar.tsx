import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Droplets, Flame, Footprints, ShieldCheck, Trophy, X } from 'lucide-react'
import { Badge, Btn, Card, ConfirmButton, Empty, PageHeader, Progress, Stat } from '../components/ui'
import { useApp } from '../lib/store'
import { addSteps, addWater, clearDay, setMinimumDay, toggleHabit } from '../lib/actions'
import { dayMetrics, firstDay, PILLARS, SCORE_CLASS, streaks, type DayMetrics } from '../lib/consistency'
import { addDays, daysInMonth, diffDays, fmtLong, fromISO, toISO, weekStartOf } from '../lib/date'
import { getDayLog } from '../lib/day'
import { cn, fmt, litres, num } from '../lib/util'
import type { ISODate } from '../types'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarPage() {
  const { state, today } = useApp()
  const [month, setMonth] = useState(() => today.slice(0, 7)) // YYYY-MM
  const [selected, setSelected] = useState<ISODate>(today)

  const [y, m] = month.split('-').map(Number)
  const first = toISO(new Date(y, m - 1, 1))
  const nDays = daysInMonth(y, m - 1)
  const gridStart = weekStartOf(first)
  const cells = Array.from({ length: Math.ceil((diffDays(first, gridStart) + nDays) / 7) * 7 }, (_, i) => addDays(gridStart, i))

  const info = useMemo(() => streaks(state, today), [state, today])
  const metrics = useMemo(() => {
    const map = new Map<ISODate, DayMetrics>()
    for (const d of cells) if (d <= today) map.set(d, dayMetrics(state, d))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, month, today])

  const monthDays = [...metrics.values()].filter((x) => x.date.slice(0, 7) === month)
  const withData = monthDays.filter((x) => x.hasData)
  const avg = withData.length ? withData.reduce((a, x) => a + x.score, 0) / withData.length : 0
  const perfect = monthDays.filter((x) => x.score === 5).length
  const counted = monthDays.filter((x) => x.counts).length

  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const pick = (d: ISODate) => {
    setSelected(d)
    setMonth(d.slice(0, 7))
  }
  const monthLabel = fromISO(first).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Consistency Calendar"
        sub="Every day is scored on five pillars: Move · Water · Steps · Spend · Fuel. A Minimum Viable Day still counts."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card bodyClass="pt-3"><Stat label="Current streak" value={<span className="flex items-center gap-1.5"><Flame size={18} className="text-amber-500" />{info.current}d</span>} sub="walk, gym ≥60% or minimum day" /></Card>
        <Card bodyClass="pt-3"><Stat label="Best streak" value={<span className="flex items-center gap-1.5"><Trophy size={18} className="text-emerald-600" />{info.best}d</span>} sub={`${info.activeDays} active of ${info.trackedDays} days`} /></Card>
        <Card bodyClass="pt-3"><Stat label={`${fromISO(first).toLocaleDateString('en-IN', { month: 'short' })} active days`} value={`${counted}`} sub={`${perfect} perfect (5/5)`} /></Card>
        <Card bodyClass="pt-3"><Stat label="Avg pillars / day" value={avg.toFixed(1)} sub={`over ${withData.length} logged day${withData.length === 1 ? '' : 's'}`} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={monthLabel}
          action={
            <div className="flex items-center gap-1">
              <Btn size="sm" variant="outline" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={14} /></Btn>
              <Btn size="sm" variant="outline" onClick={() => pick(today)}>Today</Btn>
              <Btn size="sm" variant="outline" aria-label="Next month" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)}><ChevronRight size={14} /></Btn>
            </div>
          }
        >
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
            {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label={monthLabel}>
            {cells.map((d) => {
              const inMonth = d.slice(0, 7) === month
              const mt = metrics.get(d)
              const future = d > today
              return (
                <button
                  key={d}
                  disabled={future}
                  onClick={() => setSelected(d)}
                  aria-label={`${fmtLong(d)}${mt ? `, ${mt.score} of 5 pillars` : ''}`}
                  aria-pressed={selected === d}
                  className={cn(
                    'relative flex h-12 w-full min-w-0 flex-col sm:h-auto sm:aspect-[5/4] justify-between rounded-lg p-1 text-left transition-shadow sm:p-1.5',
                    !inMonth && 'opacity-35',
                    future ? 'cursor-default bg-white ring-1 ring-[#F1F5F9]' : mt?.hasData ? SCORE_CLASS[mt.score] : 'bg-slate-50 hover:bg-slate-100',
                    d === today && 'ring-2 ring-slate-900',
                    selected === d && d !== today && 'ring-2 ring-sky-500',
                  )}
                >
                  <span className={cn('tnum text-[11px] font-semibold leading-none sm:text-xs', mt && mt.score >= 4 ? 'text-white' : future ? 'text-slate-300' : 'text-slate-700')}>
                    {Number(d.slice(8))}
                  </span>
                  <span className="flex items-center gap-px">
                    {mt?.hasData && PILLARS.map((p) => (
                      <span key={p.id} className={cn('h-1 flex-1 rounded-full', mt.pillars[p.id] ? (mt.score >= 4 ? 'bg-white' : 'bg-emerald-700') : (mt.score >= 4 ? 'bg-white/30' : 'bg-slate-300/70'))} />
                    ))}
                  </span>
                  {mt?.minimum && <ShieldCheck size={11} className={cn('absolute right-1 top-1', mt.score >= 4 ? 'text-white' : 'text-sky-600')} aria-label="Minimum Viable Day" />}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">Less {SCORE_CLASS.map((c, i) => <span key={i} className={cn('h-3 w-3 rounded-sm', c)} />)} More</span>
            <span className="flex items-center gap-1"><ShieldCheck size={11} className="text-sky-600" /> Minimum Viable Day</span>
            <span>Bars under each date = Move · Water · Steps · Spend · Fuel</span>
          </div>
        </Card>

        <DayPanel date={selected} />
      </div>

      <Heatmap onPick={pick} selected={selected} />
      <HabitConsistency />
    </div>
  )
}

// ---------------------------------------------------------------- selected day

function DayPanel({ date }: { date: ISODate }) {
  const { state, today, update, toast } = useApp()
  const mt = dayMetrics(state, date)
  const log = getDayLog(state, date)
  const expenses = state.expenses.filter((e) => e.date === date)
  const j = state.journal[date]
  const isToday = date === today

  const values: Record<string, string> = {
    move: mt.minimum ? `Reset ${Math.round(mt.gymPct * 100)}%` : `Gym ${Math.round(mt.gymPct * 100)}%${log.habits.walk ? ' + walk' : ''}`,
    water: `${litres(mt.waterMl)} / ${litres(mt.waterTarget)}`,
    steps: `${num(mt.steps)} / ${num(mt.stepTarget)}`,
    spend: `${fmt(mt.spent)} / ${fmt(mt.allowance)} allowance`,
    food: `${mt.meals} meals · ${mt.protein} g protein`,
  }

  return (
    <Card
      title={fmtLong(date)}
      subtitle={isToday ? 'Today — still in progress' : undefined}
      action={<Badge tone={mt.score >= 4 ? 'ok' : mt.score >= 2 ? 'warn' : 'neutral'}>{mt.score}/5</Badge>}
    >
      <ul className="space-y-1.5">
        {PILLARS.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm" title={p.hint}>
            <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', mt.pillars[p.id] ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400')}>
              {mt.pillars[p.id] ? <Check size={12} strokeWidth={3} /> : <X size={11} />}
            </span>
            <span className="w-12 font-medium">{p.label}</span>
            <span className="tnum min-w-0 flex-1 truncate text-right text-xs text-slate-500">{values[p.id]}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600">Habits {mt.habitsDone}/{mt.habitsTotal}</span>
          <span className="text-slate-400">tap to fix a forgotten day</span>
        </div>
        <Progress value={(mt.habitsDone / Math.max(1, mt.habitsTotal)) * 100} h="h-1.5" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {state.habits.map((h) => (
            <button
              key={h.id}
              onClick={() => update(toggleHabit(date, h.id))}
              aria-pressed={!!log.habits[h.id]}
              className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors', log.habits[h.id] ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-[#E5E7EB] text-slate-500 hover:bg-slate-50')}
            >
              {log.habits[h.id] && '✓ '}{h.label.replace(/^60-min round-trip walk to gym$/, 'Gym walk')}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Btn size="sm" variant="outline" onClick={() => update(addWater(date, 250, 'Water'))}><Droplets size={13} className="text-sky-500" /> +250 ml</Btn>
        <Btn size="sm" variant="outline" onClick={() => update(addSteps(date, 1000))}><Footprints size={13} className="text-amber-500" /> +1,000</Btn>
        <Btn size="sm" variant={log.minimumDay ? 'soft' : 'outline'} onClick={() => { update(setMinimumDay(date, !log.minimumDay)); toast(log.minimumDay ? 'Minimum day removed' : 'Marked as Minimum Viable Day', 'info') }}>
          <ShieldCheck size={13} /> {log.minimumDay ? 'Minimum day ✓' : 'Minimum day'}
        </Btn>
      </div>

      {(expenses.length > 0 || j) && (
        <div className="mt-4 space-y-2 border-t border-[#F1F5F9] pt-3 text-xs">
          {expenses.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-slate-600">Spending</div>
              <ul className="space-y-0.5 text-slate-600">
                {expenses.slice(0, 5).map((e) => <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.title}</span><span className="tnum">{fmt(e.amount)}</span></li>)}
                {expenses.length > 5 && <li className="text-slate-400">+{expenses.length - 5} more</li>}
              </ul>
            </div>
          )}
          {j && (
            <div>
              <div className="mb-0.5 font-medium text-slate-600">Journal · mood {j.mood}/5 · energy {j.energy}/5</div>
              <p className="line-clamp-3 text-slate-500">{j.wins || j.struggles || j.notes}</p>
            </div>
          )}
        </div>
      )}
      {mt.hasData ? (
        <div className="mt-4 border-t border-[#F1F5F9] pt-3">
          <ConfirmButton label="Clear this day" confirmLabel="Yes, clear this day" onConfirm={() => { update(clearDay(date)); toast("Day cleared", "info") }} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Nothing recorded for this day yet.</p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- 12-week heatmap

function Heatmap({ onPick, selected }: { onPick: (d: ISODate) => void; selected: ISODate }) {
  const { state, today } = useApp()
  const weeks = 12
  const start = addDays(weekStartOf(today), -(weeks - 1) * 7)
  const cols = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
  const data = useMemo(() => {
    const map = new Map<ISODate, DayMetrics>()
    for (const c of cols) for (const d of c) if (d <= today) map.set(d, dayMetrics(state, d))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, today])

  return (
    <Card title="Last 12 weeks" subtitle="One square per day — darker means more pillars hit">
      <div className="flex gap-1 overflow-x-auto pb-1">
        <div className="mr-1 grid grid-rows-7 gap-1 text-[10px] text-slate-400">
          {DOW.map((d, i) => <span key={d} className="flex h-4 items-center sm:h-5">{i % 2 === 0 ? d : ''}</span>)}
        </div>
        {cols.map((c, w) => (
          <div key={w} className="grid grid-rows-7 gap-1">
            {c.map((d) => {
              const mt = data.get(d)
              return (
                <button
                  key={d}
                  disabled={d > today}
                  onClick={() => onPick(d)}
                  title={`${fmtLong(d)}${mt ? ` — ${mt.score}/5` : ''}`}
                  aria-label={`${fmtLong(d)}${mt ? ` ${mt.score} of 5` : ''}`}
                  className={cn('h-4 w-4 rounded-[3px] sm:h-5 sm:w-5', d > today ? 'bg-transparent' : mt?.hasData ? SCORE_CLASS[mt.score] : 'bg-slate-100', d === selected && 'ring-2 ring-sky-500', d === today && 'ring-2 ring-slate-900')}
                />
              )
            })}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- per-habit consistency

function HabitConsistency() {
  const { state, today } = useApp()
  const from = (() => {
    const f = firstDay(state)
    const w = addDays(today, -29)
    return f > w ? f : w
  })()
  const n = diffDays(today, from) + 1

  const rows = state.habits.map((h) => {
    let done = 0
    let streak = 0
    let counting = true
    for (let i = 0; i < n; i++) {
      const d = addDays(today, -i)
      const ok = !!getDayLog(state, d).habits[h.id]
      if (ok) done++
      if (i === 0 && !ok) continue // today may still be in progress
      if (counting && ok) streak++
      else counting = false
    }
    return { h, done, pct: (done / n) * 100, streak }
  })

  return (
    <Card title="Habit consistency" subtitle={`Last ${n} day${n === 1 ? '' : 's'}`}>
      {n < 2 ? <Empty>Come back tomorrow — this fills in as you tick habits.</Empty> : (
        <ul className="space-y-3">
          {rows.map(({ h, done, pct, streak }) => (
            <li key={h.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{h.label}</span>
                <span className="tnum shrink-0 text-xs text-slate-500">{done}/{n} · {Math.round(pct)}%{streak > 1 && <span className="ml-1.5 text-amber-600">🔥 {streak}</span>}</span>
              </div>
              <Progress value={pct} tone={pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'danger'} h="h-1.5" className="mt-1" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
