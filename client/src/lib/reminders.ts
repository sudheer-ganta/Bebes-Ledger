import { useEffect } from 'react'
import { useApp } from './store'
import { dayStats } from './day'
import { fmt, num } from './util'

const SENT = 'life-os-reminders'

/** In-page reminders (the app has to be open or installed). One notification per kind per day. */
export function useReminders() {
  const { state, fv, now, today } = useApp()

  useEffect(() => {
    if (!state.settings.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    let sent: Record<string, string> = {}
    try {
      sent = JSON.parse(localStorage.getItem(SENT) ?? '{}')
    } catch {
      sent = {}
    }
    const fire = (kind: string, body: string) => {
      if (sent[kind] === today) return
      sent[kind] = today
      localStorage.setItem(SENT, JSON.stringify(sent))
      new Notification('Life OS', { body, icon: '/icon.svg' })
    }

    if (fv.todaySpend > fv.dailyLimit && fv.todaySpend > 0) {
      fire('overspend', `You spent ${fmt(fv.todaySpend)} today vs ${fmt(fv.dailyLimit)} safe limit.`)
    }
    if (now.getHours() >= 18) {
      const st = dayStats(state, today)
      const s = Math.max(0, st.stepTarget - st.steps)
      const w = Math.max(0, st.waterTarget - st.waterMl)
      if (s > 0 || w > 0) {
        fire('evening', `Before 10 PM: ${s > 0 ? `${num(s)} steps` : ''}${s > 0 && w > 0 ? ' + ' : ''}${w > 0 ? `${num(w)} ml water` : ''}`)
      }
    }
  }, [state, fv, now, today])
}
