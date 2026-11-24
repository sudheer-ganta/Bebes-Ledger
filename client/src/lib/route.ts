import { useEffect, useState } from 'react'

export type Route = 'today' | 'wallet' | 'food' | 'todo' | 'body' | 'calendar' | 'journal' | 'crisis' | 'settings'
export const ROUTES: Route[] = ['today', 'wallet', 'food', 'todo', 'body', 'calendar', 'journal', 'crisis', 'settings']

export interface RouteInfo {
  route: Route
  param?: string
}

const read = (): RouteInfo => {
  const [r, param] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { route: ROUTES.includes(r as Route) ? (r as Route) : 'today', param }
}

/** navigate('wallet') or navigate('crisis/food') */
export const navigate = (to: string) => {
  window.location.hash = `/${to}`
  window.scrollTo({ top: 0 })
}

export function useRouteInfo(): RouteInfo {
  const [r, setR] = useState<RouteInfo>(read)
  useEffect(() => {
    const h = () => setR(read())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return r
}
