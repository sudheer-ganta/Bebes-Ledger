import { useState } from 'react'
import { CalendarArrowDown, Zap } from 'lucide-react'
import { Btn, Card, Chip, ConfirmButton, Empty, PageHeader, Segmented } from '../components/ui'
import { CATEGORY_LABEL, CATEGORY_ORDER, PRIORITY_LABEL, QuickAddTask, TaskRow } from '../components/tasks'
import { useApp } from '../lib/store'
import { carryOverTasks, clearAllTasks, clearCompletedTasks } from '../lib/actions'
import { allTasks, deriveAutoTasks } from '../lib/smart'
import { addDays } from '../lib/date'
import { cn } from '../lib/util'
import type { Priority, Task, TaskCategory } from '../types'

type View = 'context' | 'priority'
type When = 'open' | 'today' | 'overdue' | 'done'
const PRIOS: Priority[] = ['high', 'routine', 'low']
const prioRank: Record<Priority, number> = { high: 0, routine: 1, low: 2 }

export function Todo() {
  const { state, fv, today, now, update, toast } = useApp()
  const [view, setView] = useState<View>('context')
  const [when, setWhen] = useState<When>('open')
  const [cat, setCat] = useState<TaskCategory | 'all'>('all')

  const auto = deriveAutoTasks(state, fv, now)
  const all = allTasks(state, auto)
  const open = all.filter((t) => !t.done)
  const overdue = open.filter((t) => t.due && t.due < today)
  const dueToday = open.filter((t) => t.due === today)
  const carryable = state.tasks.filter((t) => !t.done && ((t.due && t.due <= today) || (!t.due && t.category === 'today')))

  const filtered = all
    .filter((t) => (cat === 'all' ? true : t.category === cat))
    .filter((t) => when === 'done' ? t.done : when === 'open' ? !t.done : when === 'today' ? !t.done && t.due === today : !t.done && !!t.due && t.due < today)
    .sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || (a.due ?? '9').localeCompare(b.due ?? '9'))

  const carry = () => {
    update(carryOverTasks(today))
    toast(`${carryable.length} task${carryable.length === 1 ? '' : 's'} moved to ${addDays(today, 1)}`, 'info')
  }

  const groups: Array<{ key: string; title: string; tasks: Task[] }> =
    view === 'context'
      ? CATEGORY_ORDER.map((c) => ({ key: c, title: CATEGORY_LABEL[c], tasks: filtered.filter((t) => t.category === c) }))
      : PRIOS.map((p) => ({ key: p, title: PRIORITY_LABEL[p], tasks: filtered.filter((t) => t.priority === p) }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tasks"
        sub={`${open.length} open · ${overdue.length} overdue · ${auto.length} auto-generated`}
        right={
          <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton label="Clear completed" disabled={!all.some((t) => t.done && !t.auto)} onConfirm={() => { update(clearCompletedTasks); toast("Completed tasks cleared", "info") }} />
          <ConfirmButton label="Clear all" confirmLabel="Yes, clear all" disabled={state.tasks.length === 0} onConfirm={() => { update(clearAllTasks); toast("All tasks cleared", "info") }} />
          <Btn variant="outline" disabled={carryable.length === 0} onClick={carry}>
            <CalendarArrowDown size={15} /> Carry Over Unfinished Tasks to Tomorrow
            {carryable.length > 0 && <span className="rounded bg-slate-100 px-1.5 text-xs">{carryable.length}</span>}
          </Btn>
          </div>
        }
      />

      <Card><QuickAddTask /></Card>

      {/* priority matrix: contexts × priority (only once there is something to show) */}
      {open.length > 0 && (
      <Card title="Priority matrix" subtitle="Open tasks by context and priority — tap a cell to filter">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-1 font-medium">Context</th>
                {PRIOS.map((p) => <th key={p} className="py-1 text-center font-medium">{PRIORITY_LABEL[p]}</th>)}
              </tr>
            </thead>
            <tbody>
              {CATEGORY_ORDER.map((c) => (
                <tr key={c} className="border-t border-line-soft">
                  <td className="py-1.5 pr-2 text-slate-700">{CATEGORY_LABEL[c]}</td>
                  {PRIOS.map((p) => {
                    const n = open.filter((t) => t.category === c && t.priority === p).length
                    return (
                      <td key={p} className="py-1 text-center">
                        <button
                          onClick={() => { setCat(c); setView('priority'); setWhen('open') }}
                          className={cn('tnum h-7 w-9 rounded-md text-xs font-semibold', n === 0 ? 'text-slate-300' : p === 'high' ? 'bg-rose-50 text-rose-700' : p === 'routine' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600')}
                        >
                          {n}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View> value={view} onChange={setView} options={[{ value: 'context', label: 'By context' }, { value: 'priority', label: 'By priority' }]} />
        <Segmented<When> value={when} onChange={setWhen} options={[
          { value: 'open', label: `Open ${open.length}` },
          { value: 'today', label: `Today ${dueToday.length}` },
          { value: 'overdue', label: `Overdue ${overdue.length}` },
          { value: 'done', label: 'Done' },
        ]} />
        <div className="flex flex-wrap gap-1.5">
          <Chip active={cat === 'all'} onClick={() => setCat('all')}>All contexts</Chip>
          {CATEGORY_ORDER.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</Chip>)}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty>{when === 'done' ? 'Nothing completed yet.' : 'Nothing here. Add a task above — or let the app add them for you (restocks, rent, debt, evening nudges).'}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.filter((g) => g.tasks.length > 0).map((g) => (
            <Card key={g.key} title={g.title} action={<span className="tnum text-xs text-slate-400">{g.tasks.length}</span>}>
              <ul className="-mx-1.5">{g.tasks.map((t) => <TaskRow key={t.id} task={t} />)}</ul>
            </Card>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Zap size={12} /> Auto tasks appear from other modules: out-of-stock groceries, rent / debt / bills due within 5 days, payday, Sunday review, and evening step/water nudges after 6 PM.
      </p>
    </div>
  )
}
