import { useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, Droplets, Footprints, HeartPulse, LifeBuoy, PiggyBank, Receipt, Utensils, Wallet } from 'lucide-react'
import { Badge, Btn, Card, Chip, Empty, Field, inputCls, PageHeader, Segmented, Stat, toneBg } from '../components/ui'
import { useStreak } from '../components/widgets'
import { useApp } from '../lib/store'
import {
  addExpense, addMeal, addSteps, addTask, addWater, logCrisis, logSurpriseExpense, moveSessionToTomorrow,
  resolveCrisis, setMinimumDay, setSurvival, topupFromSavings,
} from '../lib/actions'
import { computeFinance } from '../lib/finance'
import { detectCrisis } from '../lib/smart'
import { getDayLog, splitKeyFor } from '../lib/day'
import { CRISIS_MEALS, type CrisisMeal } from '../lib/defaults'
import { fmtDate } from '../lib/date'
import { navigate } from '../lib/route'
import { cn, fmt, num } from '../lib/util'
import { ApplianceTag } from './Groceries'
import { slotForNow } from '../components/widgets'

type Mode = 'money' | 'expense' | 'bad-day' | 'food'

const MODES: Array<{ id: Mode; label: string; sub: string; icon: React.ReactNode }> = [
  { id: 'money', label: 'Money running out', sub: 'Survival budget', icon: <Wallet size={18} /> },
  { id: 'expense', label: 'Surprise expense', sub: 'Fund it, plan recovery', icon: <Receipt size={18} /> },
  { id: 'bad-day', label: 'Bad day / missed routine', sub: 'Minimum viable day', icon: <HeartPulse size={18} /> },
  { id: 'food', label: 'Food crisis', sub: 'Cheap protein, 3 appliances', icon: <Utensils size={18} /> },
]

// a full day of the cheapest decent-protein meals (ids in CRISIS_MEALS)
const SURVIVAL_DAY = ['cm10', 'cm2', 'cm5'].map((id) => CRISIS_MEALS.find((m) => m.id === id)!)
const SURVIVAL_DAILY = SURVIVAL_DAY.reduce((a, m) => a + m.cost, 0)

export function Crisis({ initial }: { initial?: string }) {
  const { state, fv, now } = useApp()
  const signals = detectCrisis(state, fv, now)
  const [mode, setMode] = useState<Mode>(() =>
    (['money', 'expense', 'bad-day', 'food'] as Mode[]).includes(initial as Mode) ? (initial as Mode) : (signals[0]?.type as Mode) ?? 'money',
  )
  useEffect(() => {
    if (initial && (['money', 'expense', 'bad-day', 'food'] as string[]).includes(initial)) setMode(initial as Mode)
  }, [initial])

  return (
    <div className="space-y-4">
      <PageHeader title="SOS · Crisis Mode" sub="Something's off. Pick what's going wrong — you'll get a concrete plan, not a lecture." />

      {signals.length > 0 && (
        <div className="space-y-2">
          {signals.map((s) => (
            <button key={s.type} onClick={() => setMode(s.type === 'bad-day' ? 'bad-day' : s.type)}
              className={cn('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm', toneBg[s.level === 'danger' ? 'danger' : s.level === 'warn' ? 'warn' : 'info'])}>
              <LifeBuoy size={15} className="shrink-0" /> <b>{s.title}</b> <span className="truncate opacity-80">— {s.message}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={cn(
              'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
              mode === m.id ? 'border-rose-300 bg-rose-50 text-rose-900 ring-1 ring-rose-200' : 'border-[#E5E7EB] bg-white hover:bg-slate-50',
            )}
          >
            <span className={mode === m.id ? 'text-rose-600' : 'text-slate-400'}>{m.icon}</span>
            <span>
              <span className="block text-sm font-semibold leading-tight">{m.label}</span>
              <span className="text-xs opacity-70">{m.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {mode === 'money' && <MoneyPanel />}
      {mode === 'expense' && <ExpensePanel />}
      {mode === 'bad-day' && <BadDayPanel />}
      {mode === 'food' && <FoodPanel />}

      <History />
    </div>
  )
}

// ---------------------------------------------------------------- money

function NoPoolYet({ what }: { what: string }) {
  const { openExpense } = useApp()
  return (
    <Card title="No money is allocated yet" icon={<Wallet size={14} />}>
      <p className="text-sm text-slate-600">
        Your salary hasn't been allocated, so there's no pocket pool or savings floor to {what}. Enter your salary in Wallet once it lands and this plan switches on with real numbers.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="primary" onClick={() => navigate('wallet')}>Open Wallet</Btn>
        <Btn variant="outline" onClick={() => openExpense()}>Log an expense anyway</Btn>
      </div>
    </Card>
  )
}

function MoneyPanel() {
  const { state, fv, update, today, toast } = useApp()
  if (fv.pending) return <NoPoolYet what="plan around" />
  const days = Math.max(1, fv.cycle.daysLeft)
  const need = SURVIVAL_DAILY * days
  const have = Math.max(0, fv.remaining)
  const shortfall = Math.max(0, need - have)
  const runway = Math.floor(have / SURVIVAL_DAILY)
  const [topup, setTopup] = useState('')
  const topupAmt = Math.round(Number(topup) || shortfall)
  const on = state.survival.active
  const lifestyleFrozen = Math.max(0, fv.lifestyle.left)
  const cap = Math.max(0, Math.round(have / days))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Reality check" icon={<Wallet size={14} />} subtitle={`${days} days until salary on ${fmtDate(fv.cycle.nextPayday)}`}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Pool left" value={fmt(have)} tone={have === 0 ? 'danger' : undefined} />
          <Stat label="Survival day" value={fmt(SURVIVAL_DAILY)} sub="3 cheap meals" />
          <Stat label="Runway" value={`${runway}d`} tone={runway >= days ? 'ok' : 'danger'} sub={runway >= days ? 'covers payday' : `${days - runway}d short`} />
        </div>
        <div className={cn('mt-4 rounded-lg border px-3 py-2.5 text-sm', shortfall > 0 ? toneBg.danger : toneBg.ok)}>
          {shortfall > 0
            ? <>Eating only survival meals for {days} days costs <b>{fmt(need)}</b> — you're <b>{fmt(shortfall)}</b> short.</>
            : <>You can cover survival food until payday with <b>{fmt(have - need)}</b> to spare. Cap yourself at <b>{fmt(cap)}/day</b>.</>}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] p-3">
          <div>
            <div className="text-sm font-semibold">Survival budget</div>
            <div className="text-xs text-slate-500">Freezes lifestyle spending ({fmt(lifestyleFrozen)} left) and warns before you log movies, dates or rides.</div>
          </div>
          <Btn variant={on ? 'danger' : 'primary'} onClick={() => { update(setSurvival(!on, today)); toast(on ? 'Survival budget off' : 'Survival budget ON — essentials only', on ? 'info' : 'warn') }}>
            {on ? 'Turn off' : 'Turn on'}
          </Btn>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Survival day plan" icon={<Utensils size={14} />} subtitle={`${fmt(SURVIVAL_DAILY)} · ~${SURVIVAL_DAY.reduce((a, m) => a + m.protein, 0)} g protein`}>
          <ul className="divide-y divide-[#F1F5F9]">
            {SURVIVAL_DAY.map((m, i) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500">{['Breakfast', 'Lunch', 'Dinner'][i]}</div>
                  <div>{m.title}</div>
                  <div className="flex gap-1">{m.appliances.map((a) => <ApplianceTag key={a} a={a} />)}</div>
                </div>
                <span className="tnum text-xs text-slate-500">{fmt(m.cost)} · {m.protein} g</span>
              </li>
            ))}
          </ul>
          <Btn variant="outline" size="sm" className="mt-2" onClick={() => navigate('crisis/food')}>More cheap meals</Btn>
        </Card>

        {shortfall > 0 && (
          <Card title="Close the gap" icon={<PiggyBank size={14} />} subtitle="Last resort: borrow from your own savings, not from people">
            <form className="space-y-2" onSubmit={(e) => {
              e.preventDefault()
              if (topupAmt <= 0) return
              update(topupFromSavings(topupAmt, 'Survival top-up', today))
              update(logCrisis('money', 'Pool top-up from savings', topupAmt, 'Survival budget', today))
              toast(`${fmt(topupAmt)} moved from savings into the pool`, 'warn')
              setTopup('')
            }}>
              <Field label="Move from savings into the pool" hint={`Savings floor drops from ${fmt(fv.savings.floorNow)} to ${fmt(fv.savings.floorNow - topupAmt)} this cycle`}>
                <div className="flex gap-2">
                  <input className={inputCls} type="number" inputMode="numeric" value={topup} placeholder={String(shortfall)} onChange={(e) => setTopup(e.target.value)} />
                  <Btn type="submit" variant="danger">Move</Btn>
                </div>
              </Field>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- surprise expense

type Funding = 'buffer' | 'savings' | 'pool'

function ExpensePanel() {
  const { state, fv, update, today, toast } = useApp()
  if (fv.pending) return <NoPoolYet what="fund this from" />
  const [amount, setAmount] = useState('')
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<Funding>('buffer')
  const [recover, setRecover] = useState(true)
  const amt = Math.round(Number(amount) || 0)

  const split = useMemo(() => {
    const bufferAvail = Math.max(0, fv.buffer.left)
    if (mode === 'savings') return { fromPool: 0, fromSavings: amt }
    if (mode === 'pool') return { fromPool: amt, fromSavings: 0 }
    const p = Math.min(amt, bufferAvail)
    return { fromPool: p, fromSavings: amt - p }
  }, [mode, amt, fv.buffer.left])

  const after = useMemo(() => {
    if (amt <= 0) return null
    const next = logSurpriseExpense({ title: title || 'Surprise expense', ...split, today })(state)
    return computeFinance(next, today)
  }, [amt, split, state, title, today])

  const days = Math.max(1, fv.cycle.daysLeft)
  const perDay = Math.ceil(split.fromSavings / days)
  const recoverText = split.fromSavings > 0
    ? `Rebuild ${fmt(split.fromSavings)}: spend ${fmt(perDay)}/day less for ${days} days, or let the next Sunday sweeps refill it`
    : split.fromPool > 0 ? `Daily safe limit drops to ${fmt(after?.dailyLimit ?? 0)} for the rest of the cycle` : ''

  const submit = () => {
    if (amt <= 0) return
    update(logSurpriseExpense({ title: title || 'Surprise expense', ...split, today, recoverNote: recoverText }))
    if (recover && split.fromSavings > 0) {
      update(addTask({ title: `Rebuild ${fmt(split.fromSavings)} savings: keep daily spend ≤ ${fmt(Math.max(0, (after?.dailyLimit ?? 0)))}`, category: 'finance', priority: 'high', due: fv.cycle.end, note: 'From SOS' }))
    }
    toast(`${fmt(amt)} logged${split.fromSavings > 0 ? ` · ${fmt(split.fromSavings)} came from savings` : ''}`, split.fromSavings > 0 ? 'warn' : 'ok')
    setAmount(''); setTitle('')
  }

  const options: Array<{ id: Funding; title: string; desc: string }> = [
    { id: 'buffer', title: 'Pool buffer first, rest from savings', desc: `Uses your ${fmt(Math.max(0, fv.buffer.left))} buffer, then savings` },
    { id: 'savings', title: 'All from savings', desc: 'Pocket pool and daily limit stay untouched' },
    { id: 'pool', title: 'Spread across the pool', desc: 'Whole amount hits the pool; daily limit shrinks' },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="What happened?" icon={<Receipt size={14} />} subtitle="Medical, repair, a friend in need…">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <Field label="Amount ₹"><input className={inputCls} type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1500" /></Field>
            <Field label="What for?"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Phone screen repair" /></Field>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-600">How do you want to fund it?</div>
            {options.map((o) => (
              <button type="button" key={o.id} onClick={() => setMode(o.id)} aria-pressed={mode === o.id}
                className={cn('block w-full rounded-lg border px-3 py-2 text-left', mode === o.id ? 'border-slate-900 bg-slate-50' : 'border-[#E5E7EB] hover:bg-slate-50')}>
                <div className="text-sm font-medium">{o.title}</div>
                <div className="text-xs text-slate-500">{o.desc}</div>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={recover} onChange={(e) => setRecover(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Add a recovery task if savings are used
          </label>
          <Btn type="submit" variant="primary" size="lg" className="w-full" disabled={amt <= 0}>Log it & see the impact</Btn>
        </form>
      </Card>

      <Card title="Impact preview" icon={<Activity size={14} />}>
        {!after ? <Empty>Enter an amount to see exactly what it does to your month.</Empty> : (
          <>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="py-1 font-medium"></th><th className="py-1 text-right font-medium">Now</th><th className="py-1 text-right font-medium">After</th></tr></thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                <PRow label="Pool left" a={fv.remaining} b={after.remaining} />
                <PRow label="Pool buffer left" a={fv.buffer.left} b={after.buffer.left} />
                <PRow label="Daily safe limit" a={fv.dailyLimit} b={after.dailyLimit} />
                <PRow label="Savings (if pool fully spent)" a={fv.savings.guaranteed} b={after.savings.guaranteed} />
              </tbody>
            </table>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">From pool</div><div className="tnum text-sm font-semibold">{fmt(split.fromPool)}</div></div>
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-500">From savings</div><div className={cn('tnum text-sm font-semibold', split.fromSavings > 0 && 'text-amber-700')}>{fmt(split.fromSavings)}</div></div>
            </div>
            {recoverText && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{recoverText}</p>}
            {after.buffer.left < 0 && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">This overdraws the pool by {fmt(-after.buffer.left)} — choose “from savings” instead.</p>}
          </>
        )}
      </Card>
    </div>
  )
}

function PRow({ label, a, b }: { label: string; a: number; b: number }) {
  const worse = b < a - 0.5
  return (
    <tr>
      <td className="py-2 text-slate-600">{label}</td>
      <td className="tnum py-2 text-right">{fmt(a)}</td>
      <td className={cn('tnum py-2 text-right font-semibold', worse ? 'text-rose-600' : 'text-slate-900')}>{fmt(b)}</td>
    </tr>
  )
}

// ---------------------------------------------------------------- bad day

function BadDayPanel() {
  const { state, today, update, toast } = useApp()
  const log = getDayLog(state, today)
  const on = log.minimumDay
  const streak = useStreak()
  const todayKey = splitKeyFor(state, today)
  const t = state.targets

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Minimum Viable Day" icon={<HeartPulse size={14} />} subtitle="A bad day is not a failed day." action={<Badge tone={streak >= 3 ? 'ok' : 'neutral'}>{streak}-day streak</Badge>}>
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li>• Steps target {num(t.steps)} → <b>{num(t.minSteps)}</b> (the gym walk alone)</li>
          <li>• Water target {(t.waterMl / 1000).toFixed(2)} L → <b>{(t.minWaterMl / 1000).toFixed(1)} L</b></li>
          <li>• Gym → <b>3-move, 15-minute mobility reset</b></li>
          <li>• To-dos → only your <b>top 3</b></li>
          <li>• Your streak stays alive if you hit the minimum</li>
        </ul>
        <Btn className="mt-4 w-full" size="lg" variant={on ? 'soft' : 'primary'}
          onClick={() => { update(setMinimumDay(today, !on)); toast(on ? 'Back to the full plan' : 'Minimum Viable Day is ON. Go easy.', 'info') }}>
          {on ? <><CheckCircle2 size={16} /> Minimum day is ON — switch off</> : 'Switch today to Minimum Viable Day'}
        </Btn>
        {todayKey !== 'sun' && !on && (
          <Btn className="mt-2 w-full" variant="outline" onClick={() => { update(moveSessionToTomorrow(today, todayKey)); toast('Session moved to tomorrow', 'info') }}>
            Skip the gym today — move this session to tomorrow
          </Btn>
        )}
      </Card>

      <Card title="Three tiny wins" subtitle="Pick any one. Momentum beats motivation.">
        <div className="space-y-2">
          <Btn variant="outline" className="w-full justify-start" onClick={() => { update(addWater(today, 250, 'Water')); toast('+250 ml', 'ok') }}><Droplets size={15} className="text-sky-500" /> Drink a glass of water</Btn>
          <Btn variant="outline" className="w-full justify-start" onClick={() => { update(addSteps(today, 1000)); toast('+1,000 steps', 'ok') }}><Footprints size={15} className="text-amber-500" /> 10-minute walk (+1,000 steps)</Btn>
          <Btn variant="outline" className="w-full justify-start" onClick={() => navigate('crisis/food')}><Utensils size={15} className="text-emerald-600" /> Eat something simple (cheap protein)</Btn>
          <Btn variant="outline" className="w-full justify-start" onClick={() => navigate('journal')}><HeartPulse size={15} className="text-rose-500" /> One line in the journal: what made today hard?</Btn>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- food

function FoodPanel() {
  const { state, fv, update, today, now, toast } = useApp()
  const [cap, setCap] = useState<number>(60)
  const [minProtein, setMinProtein] = useState<number>(0)
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useState<'value' | 'protein'>('value')

  const list = useMemo(
    () => CRISIS_MEALS.filter((m) => m.cost <= cap && m.protein >= minProtein)
      .sort((a, b) => (view === 'value' ? b.protein / b.cost - a.protein / a.cost : b.protein - a.protein)),
    [cap, minProtein, view],
  )

  const eat = (m: CrisisMeal, bought: boolean) => {
    const slot = slotForNow(now.getHours())
    if (bought) update(addExpense({ amount: m.cost, title: `Ingredients: ${m.title}`, category: 'Groceries', date: today }))
    update(addMeal({ date: today, slot, title: m.title, appliances: m.appliances, cost: 0, protein: m.protein }))
    toast(`${m.title} logged${bought ? ` · ${fmt(m.cost)} to Groceries` : ''}`, 'ok')
  }

  const st = state.meals.filter((x) => x.date === today).reduce((a, m) => a + m.protein, 0)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <Card title="Cheapest protein you can make right now" icon={<Utensils size={14} />} subtitle="Only an egg boiler, a pan and a kettle — approx. Bengaluru prices">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">Budget</span>
            {[20, 40, 60, 100].map((c) => <Chip key={c} active={cap === c} onClick={() => setCap(c)}>≤ ₹{c}</Chip>)}
            <span className="ml-2 text-xs text-slate-500">Protein</span>
            {[0, 20, 30].map((p) => <Chip key={p} active={minProtein === p} onClick={() => setMinProtein(p)}>{p === 0 ? 'any' : `${p} g+`}</Chip>)}
            <Segmented className="ml-auto" value={view} onChange={setView} options={[{ value: 'value', label: 'Best value' }, { value: 'protein', label: 'Most protein' }]} />
          </div>
          {list.length === 0 ? <Empty>Nothing under that budget with that much protein. Loosen a filter.</Empty> : (
            <ul className="space-y-2">
              {list.map((m) => (
                <li key={m.id} className="rounded-lg border border-[#E5E7EB] p-3">
                  <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === m.id ? null : m.id)}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{m.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {m.appliances.map((a) => <ApplianceTag key={a} a={a} />)}
                        <span className="text-[11px] text-slate-400">{m.minutes} min</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tnum text-sm font-semibold">{fmt(m.cost)}</div>
                      <div className="tnum text-[11px] text-emerald-700">{m.protein} g · {(m.protein / m.cost).toFixed(1)} g/₹</div>
                    </div>
                  </button>
                  {open === m.id && (
                    <div className="mt-2 border-t border-[#F1F5F9] pt-2">
                      <p className="text-xs text-slate-600">{m.how}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Btn size="sm" variant="success" onClick={() => eat(m, false)}>Ate it — from my stock</Btn>
                        <Btn size="sm" variant="outline" onClick={() => eat(m, true)}>Bought ingredients {fmt(m.cost)}</Btn>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Today so far">
          <Stat label="Protein logged" value={`${st} g`} sub={`target ${state.targets.proteinG} g · ${Math.max(0, state.targets.proteinG - st)} g to go`} />
          <div className="mt-3 text-xs text-slate-500">Safe to spend today: <b className="text-slate-900">{fmt(Math.max(0, fv.todayLeft))}</b></div>
        </Card>
        <Card title="Restock the basics" subtitle="Adds one high-priority errand">
          <Btn variant="outline" className="w-full" onClick={() => {
            update(addTask({ title: 'Buy eggs, bananas & peanuts', category: 'errands', priority: 'high', due: today }))
            toast('Errand added to your to-do list', 'ok')
          }}>Add “eggs + bananas + peanuts” run</Btn>
          <p className="mt-2 text-[11px] text-slate-400">Eggs, bananas and peanuts are the cheapest protein you can cook with no fuss.</p>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- history

function History() {
  const { state, update } = useApp()
  if (state.crisisEvents.length === 0) return null
  return (
    <Card title="Crisis history" subtitle="What you've handled — useful when it feels like you're always in trouble">
      <ul className="divide-y divide-[#F1F5F9]">
        {state.crisisEvents.slice(0, 8).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{c.title} {c.amount > 0 && <span className="tnum text-slate-500">· {fmt(c.amount)}</span>}</div>
              <div className="truncate text-[11px] text-slate-500">{fmtDate(c.date)}{c.detail ? ` · ${c.detail}` : ''}</div>
            </div>
            {c.resolved ? <Badge tone="ok">Recovered</Badge> : <Btn size="sm" variant="outline" onClick={() => update(resolveCrisis(c.id))}>Mark recovered</Btn>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
