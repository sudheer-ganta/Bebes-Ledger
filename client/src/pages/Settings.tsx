import { useRef, useState } from 'react'
import { Bell, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Badge, Btn, Card, ConfirmButton, Field, inputCls, PageHeader } from '../components/ui'
import { useApp, exportJSON } from '../lib/store'
import { clearAllTasks, clearCycleExpenses, clearDebtPayments, clearGroceries, clearHistory } from '../lib/actions'
import { CATEGORIES } from '../lib/defaults'
import { fmt, uid } from '../lib/util'
import type { AppState, ExpenseCategory, FinanceConfig, Profile, QuickPreset, Targets } from '../types'

function NumField<T extends object>({
  label, obj, k, onChange, hint, step,
}: { label: string; obj: T; k: keyof T; onChange: (k: keyof T, v: number) => void; hint?: string; step?: number }) {
  return (
    <Field label={label} hint={hint}>
      <input className={inputCls} type="number" inputMode="numeric" step={step} value={Number(obj[k])} onChange={(e) => onChange(k, Number(e.target.value))} />
    </Field>
  )
}

export function SettingsPage() {
  const { state, update, replaceAll, resetAll, toast, sync, fv } = useApp()
  const f = state.finance
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('life-os-api-key') ?? '')
  const [preset, setPreset] = useState({ title: '', amount: '', category: 'Outside Food' as ExpenseCategory })

  const setFin = (k: keyof FinanceConfig, v: number) => update((s) => ({ ...s, finance: { ...s.finance, [k]: v } }))
  const setBucket = (k: keyof FinanceConfig['buckets'], v: number) =>
    update((s) => ({ ...s, finance: { ...s.finance, buckets: { ...s.finance.buckets, [k]: v } } }))
  const setTarget = (k: keyof Targets, v: number) => update((s) => ({ ...s, targets: { ...s.targets, [k]: v } }))
  const setProfile = (k: keyof Profile, v: string | number) => update((s) => ({ ...s, profile: { ...s.profile, [k]: v } }))


  const doExport = () => {
    const blob = new Blob([exportJSON(state)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `life-os-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppState
      if (!parsed.finance || !parsed.expenses) throw new Error('Not a Life OS backup')
      replaceAll(parsed)
      toast('Backup restored', 'ok')
    } catch {
      toast('That file is not a valid Life OS backup', 'danger')
    }
  }

  const toggleNotifications = async () => {
    if (!state.settings.notifications) {
      if (!('Notification' in window)) return toast('This browser does not support notifications', 'warn')
      const p = await Notification.requestPermission()
      if (p !== 'granted') return toast('Notification permission was not granted', 'warn')
    }
    update((s) => ({ ...s, settings: { ...s.settings, notifications: !s.settings.notifications } }))
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Settings & data" sub="Every baseline number is editable. Changes apply instantly." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Money">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Expected monthly salary ₹" obj={f} k="salary" onChange={setFin} hint="Plan only — you enter the real amount each payday" />
            <NumField label="PG rent ₹" obj={f} k="rent" onChange={setFin} />
            <NumField label="Fixed commitments ₹" obj={f} k="fixed" onChange={setFin} hint="recharge, gym, bills" />
            <NumField label="Monthly savings ₹ (fixed)" obj={f} k="savings" onChange={setFin} hint="Constant — never changes with salary" />
            <NumField label="Salary day of month" obj={f} k="paydayDay" onChange={setFin} />
            <NumField label="Rent due day" obj={f} k="rentDueDay" onChange={setFin} />
            <NumField label="Debt installment due day" obj={f} k="debtDueDay" onChange={setFin} />
            <NumField label="Bills due day" obj={f} k="fixedDueDay" onChange={setFin} />
          </div>
          <div className="mt-4 text-xs font-medium text-slate-600">Pool split (ratio — scaled to whatever the pocket pool turns out to be)</div>
          <div className="mt-1 grid grid-cols-3 gap-3">
            <NumField label="Groceries ₹" obj={f.buckets} k="groceries" onChange={setBucket} />
            <NumField label="Lifestyle ₹" obj={f.buckets} k="lifestyle" onChange={setBucket} />
            <NumField label="Buffer ₹" obj={f.buckets} k="buffer" onChange={setBucket} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Pocket pool = salary − rent − bills − debt installment − savings = <b className="text-slate-900">{fmt(fv.salary.pocket)}</b> this month
            (≈ {fmt(fv.salary.pocket / fv.cycle.totalDays)} a day · {fmt((fv.salary.pocket / fv.cycle.totalDays) * 7)} a week). Once the debt is cleared it becomes <b className="text-slate-900">{fmt(fv.savings.pocketAfterDebt)}</b>.
          </p>

          <div className="mt-4 text-xs font-medium text-slate-600">Debt plan</div>
          <div className="mt-1 grid grid-cols-3 gap-3">
            <NumField label="Total owed ₹" obj={f} k="debtTotal" onChange={setFin} />
            <NumField label="Per month ₹" obj={f} k="debtPlanMonthly" onChange={setFin} />
            <NumField label="Months" obj={f} k="debtPlanMonths" onChange={setFin} />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={f.autoSweep} onChange={(e) => update((s) => ({ ...s, finance: { ...s.finance, autoSweep: e.target.checked } }))} />
            Auto-sweep unspent weekly pocket money into savings every Sunday
          </label>
        </Card>

        <div className="space-y-4">
          <Card title="Targets">
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Water ml / day" obj={state.targets} k="waterMl" onChange={setTarget} />
              <NumField label="Glass size ml" obj={state.targets} k="glassMl" onChange={setTarget} />
              <NumField label="Steps / day" obj={state.targets} k="steps" onChange={setTarget} />
              <NumField label="Gym-walk step credit" obj={state.targets} k="walkCredit" onChange={setTarget} hint="applies to default walk habit" />
              <NumField label="Protein g / day" obj={state.targets} k="proteinG" onChange={setTarget} />
              <NumField label="Minimum-day steps" obj={state.targets} k="minSteps" onChange={setTarget} />
            </div>
          </Card>

          <Card title="Profile">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><input className={inputCls} value={state.profile.name} onChange={(e) => setProfile('name', e.target.value)} /></Field>
              <Field label="Weight kg"><input className={inputCls} type="number" value={state.profile.weightKg} onChange={(e) => setProfile('weightKg', Number(e.target.value))} /></Field>
              <Field label="Age"><input className={inputCls} type="number" value={state.profile.age} onChange={(e) => setProfile('age', Number(e.target.value))} /></Field>
              <Field label="City"><input className={inputCls} value={state.profile.city} onChange={(e) => setProfile('city', e.target.value)} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{state.profile.appliances.map((a) => <Badge key={a}>{a}</Badge>)}</div>
            <p className="mt-2 text-xs text-slate-500">{state.profile.goal}</p>
          </Card>

          <Card title="Quick-expense buttons">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {state.settings.quickPresets.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white py-1 pl-3 pr-1 text-xs">
                  {p.title} ₹{p.amount}
                  <button aria-label={`Remove ${p.title}`} className="rounded-full p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => update((s) => ({ ...s, settings: { ...s.settings, quickPresets: s.settings.quickPresets.filter((x) => x.id !== p.id) } }))}><Trash2 size={11} /></button>
                </span>
              ))}
            </div>
            <form className="flex flex-wrap gap-2" onSubmit={(e) => {
              e.preventDefault()
              const amount = Math.round(Number(preset.amount))
              if (!preset.title.trim() || !(amount > 0)) return
              const p: QuickPreset = { id: uid(), title: preset.title.trim(), amount, category: preset.category }
              update((s) => ({ ...s, settings: { ...s.settings, quickPresets: [...s.settings.quickPresets, p] } }))
              setPreset({ ...preset, title: '', amount: '' })
            }}>
              <input className={cn2(inputCls, 'min-w-32 flex-1')} placeholder="Title" value={preset.title} onChange={(e) => setPreset({ ...preset, title: e.target.value })} />
              <input className={cn2(inputCls, 'w-20')} placeholder="₹" type="number" value={preset.amount} onChange={(e) => setPreset({ ...preset, amount: e.target.value })} />
              <select className={cn2(inputCls, 'w-36')} value={preset.category} onChange={(e) => setPreset({ ...preset, category: e.target.value as ExpenseCategory })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <Btn type="submit" variant="soft">Add</Btn>
            </form>
          </Card>
        </div>
      </div>

      <Card title="Clear data" subtitle="Each one asks first. Export a backup above if you might want it back.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["Grocery prices & ticks", "Typed prices, ticked items, kitchen-stock marks", () => update(clearGroceries)],
            ["To-dos", "Every task (auto-tasks come back if still relevant)", () => update(clearAllTasks)],
            ["This cycle's expenses", "Expenses, top-ups, sweeps and grocery checkouts this cycle", () => update(clearCycleExpenses(fv.cycle.start, fv.cycle.end))],
            ["Debt payment history", "Debt goes back to the full amount owed", () => update(clearDebtPayments)],
            ["Tracking history", "Water, steps, habits, meals, gym logs, journal, crisis log", () => update(clearHistory)],
            ["Salary entries", "Back to waiting for salary", () => update((s) => ({ ...s, salaries: {}, paid: {}, updatedAt: new Date().toISOString() }))],
          ] as Array<[string, string, () => void]>).map(([title, desc, fn]) => (
            <div key={title} className="flex items-start justify-between gap-2 rounded-lg border border-line p-3">
              <div className="min-w-0"><div className="text-sm font-medium">{title}</div><div className="text-[11px] text-slate-500">{desc}</div></div>
              <ConfirmButton label="Clear" onConfirm={() => { fn(); toast(`${title} cleared`, "info") }} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reminders" icon={<Bell size={14} />}>
          <p className="text-sm text-slate-600">Evening nudge (6 PM+) if steps or water are behind, and when you go over the safe limit. Works while the app is open or installed.</p>
          <Btn className="mt-3" variant={state.settings.notifications ? 'soft' : 'primary'} onClick={toggleNotifications}>
            {state.settings.notifications ? 'Notifications on — turn off' : 'Enable notifications'}
          </Btn>
        </Card>

        <Card title="Data & sync">
          <div className="mb-3 flex items-center gap-2 text-sm">
            Storage: <Badge tone={sync === 'synced' ? 'ok' : sync === 'error' ? 'warn' : sync === 'auth' ? 'danger' : 'neutral'}>
              {sync === 'synced' ? 'MongoDB sync on' : sync === 'error' ? 'Sync error — saved locally' : sync === 'auth' ? 'Wrong or missing API key' : sync === 'connecting' ? 'Connecting…' : 'Browser (localStorage)'}
            </Badge>
          </div>
          <p className="mb-3 text-xs text-slate-500">Data always saves in this browser. Run the Express server (see README) and it mirrors to MongoDB automatically.</p>
          <Field label="API key (only if you set API_KEY on the server)">
            <div className="flex gap-2">
              <input className={inputCls} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="paste the key you set on the server" />
              <Btn variant="soft" onClick={() => { localStorage.setItem('life-os-api-key', apiKey.trim()); window.location.reload() }}>Save & reconnect</Btn>
            </div>
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn variant="outline" onClick={doExport}><Download size={14} /> Export backup</Btn>
            <Btn variant="outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import backup</Btn>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void doImport(file); e.target.value = '' }} />
            {confirmReset ? (
              <>
                <Btn variant="danger" onClick={() => { resetAll(); setConfirmReset(false); toast('Everything reset to defaults', 'warn') }}>Yes, erase everything</Btn>
                <Btn variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Btn>
              </>
            ) : (
              <Btn variant="ghost" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Reset to defaults</Btn>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

const cn2 = (...p: string[]) => p.join(' ')
