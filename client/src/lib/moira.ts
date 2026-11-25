// Moira's voice for the web app: greetings and a quote of the day (same quote all day, new one tomorrow).
import type { AppState } from '../types'

const QUOTES = [
  'One must maintain standards, even when cast down into pecuniary exile.',
  'Poverty is a state of mind, and I simply refuse to grant it residency in mine.',
  'You can’t put a price on style, darling. Although the purse would very much like to try.',
  'I do not merely walk through life. I perform it.',
  'When one of us shines, all of us shine.',
  'One may lack currency, yet still possess an abundance of taste.',
  'Money comes and goes, bébé, like unreliable backup dancers.',
  'Hydration is the most underrated form of couture.',
  'A Rose never slouches, not even at the gym.',
  'We are not broke. We are merely between engagements.',
  'Fold in the cheese, darling. Then log what it cost.',
  'Every rupee you keep today is a standing ovation tomorrow.',
]

const dayOfYear = (d: Date) => Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000)

export const quoteOfTheDay = (now: Date, offset = 0) => QUOTES[(dayOfYear(now) + offset) % QUOTES.length]

export const moiraName = (s: AppState) => (s.profile.name && s.profile.name !== 'Me' ? s.profile.name : 'bébé')

export function greeting(now: Date): string {
  const h = now.getHours()
  return h < 5 ? 'Still awake' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Up late'
}
