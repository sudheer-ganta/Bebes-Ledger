import { useState } from 'react'
import { Check, Plus, Trash2, X, Zap } from 'lucide-react'
import { Badge, Btn, Chip, inputCls, type Tone } from './ui'
import { useApp } from '../lib/store'
import { addTask, completeAutoTask, deleteTask, dismissAuto, toggleTask } from '../lib/actions'
import { addDays, fmtDate } from '../lib/date'
import { cn } from '../lib/util'
import type { Priority, Task, TaskCategory } from '../types'

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  today: "Today's Must-Do",
  errands: 'Errands & PG Restock',
  finance: 'Finance & Payments',
  dev: 'Dev / Career',
  personal: 'Personal / Dates',
}
export const CATEGORY_ORDER: TaskCategory[] = ['today', 'errands', 'finance', 'dev', 'personal']

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High (Do First)',
  routine: 'Routine',
  low: 'Low',
}
const PRIORITY_TONE: Record<Priority, Tone> = { high: 'danger', routine: 'info', low: 'neutral' }

export function TaskRow({ task, compact }: { task: Task; compact?: boolean }) {
  const { update, today, fv, toast } = useApp()
  const overdue = !task.done && !!task.due && task.due < today
  const dueLabel = !task.due
    ? null
    : task.due === today ? 'Today'
    : task.due === addDays(today, 1) ? 'Tomorrow'
    : task.due < today ? `Overdue · ${fmtDate(task.due)}`
    : fmtDate(task.due)

  const onToggle = () => {
    if (task.auto) {
      update(completeAutoTask(task.id, fv.debt.installmentLeft, today))
      if (task.id.startsWith('auto:debt:')) toast(`Debt payment of ₹${fv.debt.installmentLeft} logged`, 'ok')
    } else update(toggleTask(task.id))
  }

  return (
    <li className="group flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-slate-50">
      <button
        onClick={onToggle}
        aria-label={task.done ? 'Mark not done' : 'Mark done'}
        className={cn('mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors', task.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white hover:border-slate-500')}
      >
        {task.done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('text-sm leading-snug', task.done && 'text-slate-400 line-through')}>{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {task.auto && <Badge tone="warn"><Zap size={10} /> Auto</Badge>}
          {!compact && <Badge>{CATEGORY_LABEL[task.category]}</Badge>}
          {task.priority === 'high' && <Badge tone="danger">High</Badge>}
          {task.priority === 'low' && <Badge>Low</Badge>}
          {dueLabel && <Badge tone={overdue ? 'danger' : task.due === today ? 'warn' : 'neutral'}>{dueLabel}</Badge>}
          {task.carried > 0 && <Badge>↻ carried {task.carried}×</Badge>}
          {task.note && !compact && <span className="text-[11px] text-slate-400">{task.note}</span>}
        </div>
      </div>
      {task.auto ? (
        <button onClick={() => update(dismissAuto(task.id))} aria-label="Dismiss" className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 lg:opacity-0 lg:group-hover:opacity-100">
          <X size={14} />
        </button>
      ) : (
        <button onClick={() => update(deleteTask(task.id))} aria-label="Delete task" className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 lg:opacity-0 lg:group-hover:opacity-100">
          <Trash2 size={14} />
        </button>
      )}
    </li>
  )
}

export function QuickAddTask({ defaultCategory = 'today' as TaskCategory }: { defaultCategory?: TaskCategory }) {
  const { update, today } = useApp()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TaskCategory>(defaultCategory)
  const [priority, setPriority] = useState<Priority>('routine')
  const [due, setDue] = useState(today)
  const [open, setOpen] = useState(false)

  const submit = () => {
    if (!title.trim()) return
    update(addTask({ title, category, priority, due: due || undefined }))
    setTitle('')
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-2.5">
      <div className="flex gap-2">
        <input
          className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setOpen(true)} placeholder="Add a task…  (e.g. Buy eggs & spinach)"
        />
        <Btn type="submit" variant="primary" disabled={!title.trim()}><Plus size={15} /> Add</Btn>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_ORDER.map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(c)}>{CATEGORY_LABEL[c]}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['high', 'routine', 'low'] as Priority[]).map((p) => (
              <Chip key={p} active={priority === p} tone={PRIORITY_TONE[p]} onClick={() => setPriority(p)}>{PRIORITY_LABEL[p]}</Chip>
            ))}
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 rounded-lg border border-line bg-white px-2 text-xs" aria-label="Due date" />
            <button type="button" onClick={() => setDue('')} className="text-[11px] text-slate-400 hover:text-slate-700">no date</button>
          </div>
        </div>
      )}
    </form>
  )
}
