import type { AppState, GroceryItem, GroceryWeek, ISODate } from '../types'
import { diffDays, weekStartOf } from './date'
import { GROCERY_WEEKS } from './defaults'
import { getCycle } from './finance'
import { sum } from './util'

/** Week 1 starts in the week payday falls in; the rotation then cycles 1→4→1… */
export function currentWeekIndex(state: AppState, today: ISODate): number {
  const cycle = getCycle(today, state.finance.paydayDay)
  const weeks = Math.floor(diffDays(weekStartOf(today), weekStartOf(cycle.start)) / 7)
  return ((weeks % 4) + 4) % 4
}

export const weekKeyOf = (date: ISODate) => weekStartOf(date)

export const itemPrice = (s: AppState, it: GroceryItem) => s.priceOverrides[it.id] ?? it.price

export function isInStock(s: AppState, it: GroceryItem, today: ISODate): boolean {
  if (!it.pantryKey) return false
  const p = s.pantry[it.pantryKey]
  if (!p?.inStock) return false
  return !p.expiresOn || p.expiresOn >= today
}

export const checkKey = (weekKey: ISODate, itemId: string) => `${weekKey}:${itemId}`

export interface WeekTotals {
  fullTotal: number // everything on the list
  toBuy: GroceryItem[] // items not already in the kitchen
  shoppingTotal: number // what you still need to spend
  stockSavings: number
  checkedTotal: number // checked + to-buy
  checkedItems: GroceryItem[]
  checkedOut?: { total: number; date: ISODate }
}

export function weekTotals(s: AppState, week: GroceryWeek, weekKey: ISODate, today: ISODate): WeekTotals {
  const toBuy = week.items.filter((i) => !isInStock(s, i, today))
  const fullTotal = sum(week.items.map((i) => itemPrice(s, i)))
  const shoppingTotal = sum(toBuy.map((i) => itemPrice(s, i)))
  const checkedItems = toBuy.filter((i) => s.checked[checkKey(weekKey, i.id)])
  const co = s.checkouts.find((c) => c.weekKey === weekKey && c.weekIndex === week.index)
  return {
    fullTotal,
    toBuy,
    shoppingTotal,
    stockSavings: fullTotal - shoppingTotal,
    checkedTotal: sum(checkedItems.map((i) => itemPrice(s, i))),
    checkedItems,
    checkedOut: co ? { total: co.total, date: co.date } : undefined,
  }
}

export function outOfStockItems(s: AppState): GroceryItem[] {
  const all = GROCERY_WEEKS.flatMap((w) => w.items)
  return all.filter((i) => s.outOfStock[i.id])
}
