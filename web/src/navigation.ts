import type { RallyRoute } from './domain'

export const TOP_LEVEL_PAGES = ['home', 'live', 'leagues', 'highlights', 'favorites'] as const
export type TopLevelPage = (typeof TOP_LEVEL_PAGES)[number]

/** Port of Android TvActionGate: coalesce impossible-to-render duplicate actions. */
export class TvActionGate {
  private lastActionAt = new Map<string, number>()
  constructor(
    private readonly minimumIntervalMs = 250,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  tryAcquire(action: string): boolean {
    const now = this.clock()
    const previous = this.lastActionAt.get(action)
    if (previous !== undefined && now - previous < this.minimumIntervalMs) return false
    this.lastActionAt.set(action, now)
    return true
  }
}

export const topLevelGate = new TvActionGate(350)
export const backGate = new TvActionGate(350)

export function isTopLevel(route: RallyRoute): boolean {
  return TOP_LEVEL_PAGES.includes(route.page as TopLevelPage)
}

/**
 * Android MainActivity parity:
 * - onboarding Back returns home (never exits from onboarding)
 * - home Back exits (PalmSystem / window.close)
 * - everything else pops the nav stack
 */
export function backTarget(route: RallyRoute): { kind: 'home' } | { kind: 'exit' } | { kind: 'pop' } {
  if (route.page === 'onboarding') return { kind: 'home' }
  if (route.page === 'home') return { kind: 'exit' }
  return { kind: 'pop' }
}

/** True when a TV modal overlay currently owns focus (parity: Back closes overlays first). */
export function hasModalOverlay(): boolean {
  return document.querySelector<HTMLElement>('[data-focus-scope="modal"]') !== null
}

/**
 * Ask the focused modal to close itself. Modals listen for `rally:close-overlay`.
 * Returns true when a modal consumed the Back press.
 */
export function requestOverlayClose(): boolean {
  if (!hasModalOverlay()) return false
  window.dispatchEvent(new CustomEvent('rally:close-overlay'))
  return true
}
