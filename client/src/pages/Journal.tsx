import { useEffect, useState } from 'react'
import { BookOpenCheck, Droplets, Dumbbell, Footprints, ListChecks, Wallet } from 'lucide-react'
import { Badge, Btn, Card, Chip, ConfirmButton, Field, PageHeader } from '../components/ui'
import { useApp } from '../lib/store'
import { saveJournal } from '../lib/actions'
import { dayStats, getDayLog, gymProgress } from '../lib/day'
import { addDays, fmtDate, fmtLong } from '../lib/date'
import { cn, fmt, litres, num } from '../lib/util'

const MOODS = ['😞', '😕', '😐', '🙂', '😄']
const ta =
  'w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm leading-relaxed placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200'

export function Journal() {
  const { state, today, fv, update, toast } = useApp()
  const [date, setDate] = useState(today)
  const entry = state.journal[date]
  const [draft, setDraft] = useState({ wins: '', struggles: '', tomorrow: '', notes: '', mood: 3, energy: 3 })

  useEffect(() => {
    setDraft({
      wins: entry?.wins ?? '', struggles: entry?.struggles ?? '', tomorrow: entry?.tomorrow ?? '',
      notes: entry?.notes ?? '', mood: entry?.mood ?? 3, energy: entry?.energy ?? 3,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const dirty =
    !entry ||
    entry.wins !== draft.wins || entry.struggles !== draft.struggles || entry.tomorrow !== draft.tomorrow ||
    entry.notes !== draft.notes || entry.mood !== draft.mood || entry.energy !== draft.energy

  const st = dayStats(state, date)
  const gym = gymProgress(state, date)
  const log = getDayLog(state, date)
  const spend = state.expenses
    .filter((e) => e.date === date && e.fundedBy === 'pool' && e.source !== 'grocery-checkout')
    .reduce((a, e) => a + e.amount, 0)
  const tasksDone = state.tasks.filter((t) => t.done && t.doneAt?.slice(0, 10) === date).length
  const habitsDone = state.habits.filter((h) => log.habits[h.id]).length

  const save = () => {
    update(saveJournal(date, draft))
    toast('Journal saved', 'ok')
  }

  const past = Object.keys(state.journal).filter((d) => d !== date).sort().reverse().slice(0, 8)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Journal & Notes"
        sub={fmtLong(date)}
        right={
          <div className="flex gap-1.5">
            <Btn size="sm" variant="outline" onClick={() => setDate(addDays(date, -1))}>← Prev</Btn>
            <Btn size="sm" variant="outline" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>Next →</Btn>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="End-of-day review" icon={<BookOpenCheck size={14} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">Mood</div>
                <div className="flex gap-1.5">
                  {MOODS.map((m, i) => (
                    <button key={m} onClick={() => setDraft({ ...draft, mood: i + 1 })} aria-label={`Mood ${i + 1}`}
                      className={cn('h-10 w-10 rounded-lg border text-xl transition-colors', draft.mood === i + 1 ? 'border-slate-900 bg-slate-100' : 'border-[#E5E7EB] hover:bg-slate-50')}>{m}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-600">Energy</div>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Chip key={n} active={draft.energy === n} onClick={() => setDraft({ ...draft, energy: n })}>{n}</Chip>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Field label="Wins today"><textarea className={ta} rows={2} value={draft.wins} onChange={(e) => setDraft({ ...draft, wins: e.target.value })} placeholder="What went well, however small?" /></Field>
              <Field label="What was hard?"><textarea className={ta} rows={2} value={draft.struggles} onChange={(e) => setDraft({ ...draft, struggles: e.target.value })} placeholder="Money stress, skipped gym, low energy…" /></Field>
              <Field label="Tomorrow's top 3"><textarea className={ta} rows={2} value={draft.tomorrow} onChange={(e) => setDraft({ ...draft, tomorrow: e.target.value })} placeholder="1. …  2. …  3. …" /></Field>
              <Field label="Notes"><textarea className={ta} rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Free-form notes, ideas, things to remember…" /></Field>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">{entry ? `Saved ${new Date(entry.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet'}</span>
              <div className="flex items-center gap-2">
                {entry && <ConfirmButton label="Clear entry" onConfirm={() => { update((s) => { const j = { ...s.journal }; delete j[date]; return { ...s, journal: j, updatedAt: new Date().toISOString() } }); setDraft({ wins: "", struggles: "", tomorrow: "", notes: "", mood: 3, energy: 3 }); toast("Journal entry cleared", "info") }} />}
                <Btn variant="primary" disabled={!dirty} onClick={save}>Save entry</Btn>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Day at a glance" subtitle={fmtDate(date)}>
            <ul className="space-y-2.5 text-sm">
              <Row icon={<Wallet size={14} />} label="Spent" value={fmt(spend)} badge={date === today && !fv.pending ? <Badge tone={fv.todayLeft < 0 ? 'danger' : 'ok'}>{fv.todayLeft < 0 ? 'over limit' : 'within limit'}</Badge> : null} />
              <Row icon={<Droplets size={14} />} label="Water" value={`${litres(st.waterMl)} / ${litres(st.waterTarget)}`} />
              <Row icon={<Footprints size={14} />} label="Steps" value={`${num(st.steps)} / ${num(st.stepTarget)}`} />
              <Row icon={<Dumbbell size={14} />} label={log.minimumDay ? 'Mobility' : 'Workout'} value={`${Math.round(gym.pct * 100)}%`} />
              <Row icon={<ListChecks size={14} />} label="Habits · tasks done" value={`${habitsDone}/${state.habits.length} · ${tasksDone}`} />
              <Row label="Protein logged" value={`${st.proteinG} / ${state.targets.proteinG} g`} />
            </ul>
            {log.minimumDay && <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Minimum Viable Day — showing up counted today.</p>}
          </Card>

          {past.length > 0 && (
            <Card title="Earlier entries">
              <ul className="divide-y divide-[#F1F5F9]">
                {past.map((d) => (
                  <li key={d}>
                    <button onClick={() => setDate(d)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-slate-900">
                      <span className="min-w-0">
                        <span className="block text-xs text-slate-500">{fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                        <span className="block truncate">{state.journal[d].wins || state.journal[d].notes || '—'}</span>
                      </span>
                      <span className="text-lg">{MOODS[state.journal[d].mood - 1]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ icon, label, value, badge }: { icon?: React.ReactNode; label: string; value: string; badge?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-slate-500">{icon}{label}</span>
      <span className="flex items-center gap-2"><span className="tnum font-medium">{value}</span>{badge}</span>
    </li>
  )
}
