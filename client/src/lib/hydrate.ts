import type { AppState } from '../types'
import { makeDefaultState, STATE_VERSION } from './defaults'

/** Fill in anything missing (new fields in later versions) so old saves never crash the UI. Shared by the app and the server bot. */
export function hydrate(raw: Partial<AppState> | null): AppState {
  const d = makeDefaultState()
  if (!raw) return d
  return {
    ...d,
    ...raw,
    version: STATE_VERSION,
    startedOn: raw.startedOn ?? d.startedOn,
    profile: { ...d.profile, ...raw.profile },
    finance: { ...d.finance, ...raw.finance, buckets: { ...d.finance.buckets, ...raw.finance?.buckets } },
    targets: { ...d.targets, ...raw.targets },
    settings: { ...d.settings, ...raw.settings },
    gymPlan: { ...d.gymPlan, ...raw.gymPlan },
    survival: { ...d.survival, ...raw.survival },
  }
}
