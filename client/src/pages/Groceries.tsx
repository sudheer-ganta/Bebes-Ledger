import { useState } from 'react'
import { Check, Egg, LifeBuoy, PackageCheck, PackageX, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { Badge, Btn, Card, ConfirmButton, Empty, PageHeader, Progress, Segmented, type Tone } from '../components/ui'
import { MealSheet } from '../components/widgets'
import { useApp } from '../lib/store'
import {
  checkoutWeek, clearGroceries, deleteMeal, setInStock, setOutOfStock, setPriceOverride, toggleChecked,
} from '../lib/actions'
import { ALL_GROCERY_ITEMS, GROCERY_WEEKS, MEAL_SLOTS } from '../lib/defaults'
import { checkKey, currentWeekIndex, isInStock, itemPrice, weekKeyOf, weekTotals } from '../lib/groceries'
import { addDays, fmtDate } from '../lib/date'
import { navigate } from '../lib/route'
import { cn, fmt, pct } from '../lib/util'
import type { GroceryItem } from '../types'

const APP_STYLE: Record<string, string> = {
  'Egg Boiler': 'border-amber-200 bg-amber-50 text-amber-800',
  Pan: 'border-slate-300 bg-slate-100 text-slate-700',
  Kettle: 'border-sky-200 bg-sky-50 text-sky-800',
}

export function ApplianceTag({ a }: { a: string }) {
  return <span className={cn('rounded border px-1 py-px text-[10px] font-medium', APP_STYLE[a])}>[{a}]</span>
}

export function Groceries() {
  const { state, today, update, toast } = useApp()
  const current = currentWeekIndex(state, today)
  const [view, setView] = useState(current)
  const [mealOpen, setMealOpen] = useState(false)
  const [again, setAgain] = useState(false)
  const week = GROCERY_WEEKS[view]
  const weekKey = weekKeyOf(today)
  const t = weekTotals(state, week, weekKey, today)
  const over = t.shoppingTotal > week.target
  const tone: Tone = over ? 'danger' : t.shoppingTotal > week.target * 0.9 ? 'warn' : 'ok'
  const left = week.target - t.shoppingTotal
  const unpriced = t.checkedItems.filter((i) => itemPrice(state, i) === 0).length
  const nothingPriced = t.shoppingTotal === 0

  const checkAll = () => {
    for (const it of t.toBuy) if (!state.checked[checkKey(weekKey, it.id)]) update(toggleChecked(weekKey, it.id))
  }

  const doCheckout = () => {
    if (t.checkedOut && !again) {
      setAgain(true)
      return
    }
    update(checkoutWeek(week, weekKey, today))
    toast(`${fmt(t.checkedTotal)} logged to Groceries · shelf-stable items moved to kitchen stock`, 'ok')
    setAgain(false)
  }

  const todayMeals = state.meals.filter((m) => m.date === today)
  const recent = [...state.meals].filter((m) => m.date >= addDays(today, -6) && m.date < today).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Food & groceries"
        sub="4-week micronutrient rotator · cooked only with an egg boiler, a pan and a kettle"
        right={
          <Segmented
            value={String(view)}
            onChange={(v) => { setView(Number(v)); setAgain(false) }}
            options={GROCERY_WEEKS.map((w) => ({ value: String(w.index), label: <>W{w.index + 1}{w.index === current && <span className="ml-1 text-emerald-600">●</span>}</> }))}
          />
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title={`${week.title} — ${week.focus}`}
            subtitle={view === current ? 'This week’s shopping list' : 'Preview — not this week’s rotation'}
            action={view === current ? <Badge tone="ok">This week</Badge> : <Badge>Preview</Badge>}
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={cn('tnum text-3xl font-semibold tracking-tight', over && 'text-rose-600')}>{fmt(t.shoppingTotal)}</div>
                <div className="text-xs text-slate-500">
                  {nothingPriced ? 'No prices yet — add what you pay as you shop' : 'priced so far'} · weekly cap {fmt(week.target)}
                </div>
              </div>
              <div className="text-right">
                <div className={cn('tnum text-lg font-semibold', left < 0 ? 'text-rose-600' : 'text-emerald-600')}>{fmt(Math.abs(left))}</div>
                <div className="text-xs text-slate-500">{left < 0 ? 'over the cap' : 'left under the cap'}</div>
              </div>
            </div>
            <Progress value={pct(t.shoppingTotal, week.target)} tone={tone} className="mt-3" />

            <ul className="mt-3 divide-y divide-line-soft">
              {week.items.map((it) => <ItemRow key={it.id} item={it} weekKey={weekKey} />)}
            </ul>

            <div className="sticky bottom-16 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white/95 p-3 pr-[4.75rem] shadow-sm backdrop-blur lg:bottom-4 lg:pr-3">
              <div className="min-w-0 flex-1 text-sm">
                <span className="tnum font-semibold">{fmt(t.checkedTotal)}</span>{' '}
                <span className="text-slate-500">· {t.checkedItems.length} of {t.toBuy.length} items ticked</span>
                {unpriced > 0 && <div className="text-xs text-amber-700">{unpriced} ticked item{unpriced === 1 ? ' has' : 's have'} no price yet</div>}
                {t.checkedOut && <div className="text-xs text-emerald-700">Already checked out {fmt(t.checkedOut.total)} on {fmtDate(t.checkedOut.date)}</div>}
              </div>
              <Btn variant="outline" size="sm" onClick={checkAll}><Check size={14} /> Tick all</Btn>
              <ConfirmButton label="Clear prices & ticks" onConfirm={() => { update(clearGroceries); setAgain(false); toast("Grocery prices, ticks and stock marks cleared", "info") }} />
              <Btn variant={again ? 'danger' : 'success'} disabled={t.checkedTotal <= 0} onClick={doCheckout}>
                <ShoppingCart size={15} /> {again ? 'Log it again' : "Checkout Week's Groceries"}
              </Btn>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Prices are yours to enter — they're remembered for next time. Checkout logs the ticked total to the pocket pool under Groceries.</p>
          </Card>
        </div>

        <div className="space-y-4">
          <KitchenStock />
          <Card title="Short on food?" icon={<LifeBuoy size={14} />}>
            <p className="text-sm text-slate-600">Cheapest high-protein meals you can make right now with your three appliances.</p>
            <Btn variant="outline" className="mt-3 w-full" onClick={() => navigate('crisis/food')}>Open Food SOS</Btn>
          </Card>
        </div>
      </div>

      <Card
        title="Quick meal log" icon={<Egg size={14} />} subtitle="Tag how you cooked it — outside meal costs sync to your pool"
        action={<Btn variant="primary" size="sm" onClick={() => setMealOpen(true)}><Plus size={14} /> Log meal</Btn>}
      >
        <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {MEAL_SLOTS.map((slot) => {
            const ms = todayMeals.filter((m) => m.slot === slot)
            return (
              <div key={slot} className="border-b border-line-soft py-2">
                <div className="text-xs font-medium text-slate-500">{slot}</div>
                {ms.length === 0 ? <div className="text-xs text-slate-300">—</div> : ms.map((m) => (
                  <div key={m.id} className="group flex items-start justify-between gap-2 py-0.5">
                    <div className="min-w-0">
                      <div className="text-sm">{m.title}</div>
                      <div className="flex flex-wrap items-center gap-1">
                        {m.appliances.map((a) => <ApplianceTag key={a} a={a} />)}
                        {m.cost > 0 && <Badge tone="warn">{fmt(m.cost)} outside</Badge>}
                        {m.protein > 0 && <span className="text-[11px] text-slate-400">{m.protein} g protein</span>}
                      </div>
                    </div>
                    <button aria-label="Delete meal" onClick={() => update(deleteMeal(m.id))} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 lg:opacity-0 lg:group-hover:opacity-100"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        {recent.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-slate-500">Last 6 days ({recent.length} meals)</summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {recent.map((m) => <li key={m.id}>{fmtDate(m.date)} · {m.slot}: {m.title} {m.appliances.map((a) => `[${a}]`).join(' ')}</li>)}
            </ul>
          </details>
        )}
        {state.meals.length === 0 && <div className="mt-3"><Empty>No meals logged yet. Log your first one to start tracking protein.</Empty></div>}
      </Card>

      <MealSheet open={mealOpen} onClose={() => setMealOpen(false)} />
    </div>
  )
}

/** Compact row: tick · name + tags · price box, with the secondary actions tucked on the second line. */
function ItemRow({ item, weekKey }: { item: GroceryItem; weekKey: string }) {
  const { state, update, today, toast } = useApp()
  const inStock = isInStock(state, item, today)
  const oos = !!state.outOfStock[item.id]
  const checked = !!state.checked[checkKey(weekKey, item.id)]
  const priced = state.priceOverrides[item.id]

  return (
    <li className={cn('flex items-start gap-3 py-2.5', inStock && 'opacity-60')}>
      <button
        disabled={inStock}
        onClick={() => update(toggleChecked(weekKey, item.id))}
        aria-label={`Tick ${item.name}`}
        className={cn('mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors disabled:cursor-not-allowed', checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white hover:border-slate-500')}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('text-sm font-medium', (checked || inStock) && 'text-slate-400 line-through')}>{item.name}</span>
          <span className="text-xs text-slate-400">{item.qty}</span>
          {item.appliances.map((a) => <ApplianceTag key={a} a={a} />)}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>{item.nutrient}</span>
          {item.pantryKey ? (
            <button
              onClick={() => update(setInStock(item, !inStock, today))}
              className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors', inStock ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700')}
            >
              <PackageCheck size={11} /> {inStock ? `In kitchen · until ${fmtDate(state.pantry[item.pantryKey]?.expiresOn ?? today)}` : 'Already have it'}
            </button>
          ) : (
            <button
              onClick={() => { update(setOutOfStock(item.id, !oos)); if (!oos) toast(`Restock task added: ${item.name}`, 'info') }}
              className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors', oos ? 'bg-rose-50 text-rose-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700')}
            >
              <PackageX size={11} /> {oos ? 'Out of stock · task added' : 'Ran out?'}
            </button>
          )}
        </div>
      </div>

      {inStock ? (
        <span className="mt-0.5 shrink-0 text-xs text-slate-400">have it</span>
      ) : (
        <label className="relative mt-0.5 shrink-0">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
          <input
            type="number" inputMode="numeric" min={0} aria-label={`${item.name} price`}
            value={priced ?? ''}
            onChange={(e) => update(setPriceOverride(item.id, e.target.value === '' ? null : Number(e.target.value)))}
            placeholder="price"
            className="tnum h-8 w-24 rounded-md border border-line bg-white pl-5 pr-2 text-right text-sm font-semibold placeholder:font-normal placeholder:text-slate-300 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </label>
      )}
    </li>
  )
}

/** Shelf-stable items as tap-to-toggle chips instead of a long switch list. */
function KitchenStock() {
  const { state, update, today } = useApp()
  const seen = new Set<string>()
  const pantryItems = ALL_GROCERY_ITEMS.filter((i) => {
    if (!i.pantryKey || seen.has(i.pantryKey)) return false
    seen.add(i.pantryKey)
    return true
  })
  const have = pantryItems.filter((i) => isInStock(state, i, today)).length
  return (
    <Card title="In kitchen stock" icon={<PackageCheck size={14} />} subtitle="Tap what you already have — it's removed from the shopping total so you never double-buy" action={<Badge tone={have > 0 ? 'ok' : 'neutral'}>{have}/{pantryItems.length}</Badge>}>
      <div className="flex flex-wrap gap-1.5">
        {pantryItems.map((it) => {
          const on = isInStock(state, it, today)
          const until = state.pantry[it.pantryKey!]?.expiresOn
          return (
            <button
              key={it.pantryKey}
              aria-pressed={on}
              onClick={() => update(setInStock(it, !on, today))}
              title={on && until ? `In stock until ${fmtDate(until)}` : `Lasts about ${it.shelfLifeDays} days`}
              className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', on ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-line bg-white text-slate-600 hover:bg-slate-50')}
            >
              {on && <Check size={12} strokeWidth={3} />}
              {it.name.replace(/\s*\(.*\)/, '').replace('Spices & oil starter', 'Spices & oil')}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
