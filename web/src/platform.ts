import { useEffect } from 'react'
import { notifyApplicationActive } from './webos'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
const GROUP = '[data-focus-row],[data-focus-column],[data-focus-grid]'
type Direction = 'left' | 'right' | 'up' | 'down'

const routeFocus = new Map<string, string>()
const groupFocus = new Map<string, string>()
let generatedFocusId = 0
let lastMoveAt = 0

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
}

function scopeRoot(): ParentNode {
  return document.querySelector<HTMLElement>('[data-focus-scope="modal"]') ?? document.querySelector<HTMLElement>('.tv-stage') ?? document
}

function focusables(root: ParentNode = scopeRoot()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible)
}

function focusId(element: HTMLElement): string {
  if (!element.dataset.focusId) element.dataset.focusId = `focus-${++generatedFocusId}`
  return element.dataset.focusId
}

function groupKey(group: HTMLElement): string {
  if (!group.dataset.focusGroup) group.dataset.focusGroup = `group-${focusId(group)}`
  return group.dataset.focusGroup as string
}

function explicitTarget(active: HTMLElement, direction: Direction): HTMLElement | undefined {
  const key = `focus${direction[0].toUpperCase()}${direction.slice(1)}` as 'focusLeft' | 'focusRight' | 'focusUp' | 'focusDown'
  const id = active.dataset[key]
  if (!id) return undefined
  const root = scopeRoot()
  const query = `[data-focus-id="${CSS.escape(id)}"]`
  if (root instanceof Document || root instanceof DocumentFragment) return (root as Document).querySelector<HTMLElement>(query) ?? undefined
  if (root instanceof Element) {
    const el = root as HTMLElement
    if (el.matches(query)) return el
    return el.querySelector<HTMLElement>(query) ?? undefined
  }
  return document.querySelector<HTMLElement>(query) ?? undefined
}

function groupItems(group: HTMLElement): HTMLElement[] {
  return focusables(group).filter((item) => item.closest(GROUP) === group)
}

function targetInsideGroup(active: HTMLElement, direction: Direction): HTMLElement | undefined {
  const group = active.closest<HTMLElement>(GROUP)
  if (!group) return undefined
  const items = groupItems(group)
  const index = items.indexOf(active)
  if (index < 0) return undefined

  if (group.hasAttribute('data-focus-row') && (direction === 'left' || direction === 'right')) {
    return items[index + (direction === 'right' ? 1 : -1)]
  }
  if (group.hasAttribute('data-focus-column') && (direction === 'up' || direction === 'down')) {
    return items[index + (direction === 'down' ? 1 : -1)]
  }
  if (group.hasAttribute('data-focus-grid')) {
    const columns = Math.max(1, Number(group.dataset.focusColumns) || 1)
    const offset = direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -columns : columns
    const target = index + offset
    if (target >= 0 && target < items.length) return items[target]
  }
  return undefined
}

function rememberedInGroup(group: HTMLElement): HTMLElement | undefined {
  const remembered = groupFocus.get(groupKey(group))
  if (!remembered) return undefined
  const items = groupItems(group)
  const direct = items.find((item) => focusId(item) === remembered)
  if (direct && visible(direct)) return direct
  const byIndex = Number(remembered.split(':').pop() ?? NaN)
  if (Number.isFinite(byIndex) && items[Math.min(byIndex, items.length - 1)]) {
    const candidate = items[Math.min(byIndex, items.length - 1)]
    if (visible(candidate)) return candidate
  }
  return undefined
}

function targetAcrossGroups(active: HTMLElement, direction: Direction): HTMLElement | undefined {
  const root = scopeRoot()
  const groups = Array.from(root.querySelectorAll<HTMLElement>(GROUP)).filter((group) => groupItems(group).length > 0)
  const current = active.closest<HTMLElement>(GROUP)
  if (!current) {
    const items = focusables(root)
    const index = items.indexOf(active)
    const offset = direction === 'left' || direction === 'up' ? -1 : 1
    return items[index + offset]
  }
  const currentIndex = groups.indexOf(current)
  if (currentIndex < 0) return undefined
  // Vertical moves preserve column memory; horizontal moves preserve row position.
  // Groups are already in document order which matches visual order on TV shelves.
  const forward = direction === 'right' || direction === 'down'
  const isVertical = direction === 'up' || direction === 'down'
  for (let index = currentIndex + (forward ? 1 : -1); index >= 0 && index < groups.length; index += forward ? 1 : -1) {
    const candidateGroup = groups[index]
    if (candidateGroup.contains(current) || current.contains(candidateGroup)) continue
    const candidates = groupItems(candidateGroup)
    if (!candidates.length) continue
    // Horizontal between rows: only accept rows/grids, skip columns to keep shelf order.
    // Vertical between groups: accept any group type.
    if (!isVertical && candidateGroup.hasAttribute('data-focus-column')) continue
    const remembered = rememberedInGroup(candidateGroup)
    if (remembered) return remembered
    const activeIndex = Math.max(0, groupItems(current).indexOf(active))
    return candidates[Math.min(activeIndex, candidates.length - 1)]
  }
  return undefined
}

function reveal(element: HTMLElement): void {
  const row = element.closest<HTMLElement>('[data-focus-row],[data-focus-grid]')
  // TV hardware: never smooth-scroll. Paged shelves jump by stable page counts
  // (RallyPagedRow parity) instead of free browser scrolling.
  element.focus({ preventScroll: true })
  try {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  } catch {
    /* scrollIntoView unavailable in test DOM */
  }
  if (row?.dataset.focusPaging === 'true') {
    const page = Math.max(1, Number(row.dataset.focusPageSize) || 4)
    const items = groupItems(row)
    const index = items.indexOf(element)
    if (index >= 0) {
      const pageStart = Math.floor(index / page) * page
      try {
        items[pageStart]?.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'auto' })
      } catch {
        /* noop */
      }
    }
  }
}

function move(direction: Direction): boolean {
  const now = performance.now()
  // Match Android MainActivity dispatchKeyEvent coalescing (40ms) — drop only
  // impossible-to-render duplicates, keep normal remote repeat cadence.
  if (now - lastMoveAt < 40) return true
  lastMoveAt = now
  const items = focusables()
  if (!items.length) return false
  const active = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : undefined
  if (!active) {
    const initial = document.querySelector<HTMLElement>('[data-initial-focus="true"]')
    const target = initial && visible(initial) ? initial : items[0]
    target.focus({ preventScroll: true })
    reveal(target)
    return true
  }
  const next = explicitTarget(active, direction) ?? targetInsideGroup(active, direction) ?? targetAcrossGroups(active, direction)
  if (!next) return false
  next.focus({ preventScroll: true })
  reveal(next)
  return true
}

function editing(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  )
}

/** Pure key classifier for LG Magic Remote + keyboard. Exported for tests. */
export function classifyTvKey(event: { key?: string; keyCode?: number }): Direction | 'back' | 'media-play' | 'media-pause' | 'media-stop' | 'media-rewind' | 'media-forward' | undefined {
  const keyCode = event.keyCode ?? 0
  // LG D-pad + arrows
  if (event.key === 'ArrowLeft' || keyCode === 37) return 'left'
  if (event.key === 'ArrowRight' || keyCode === 39) return 'right'
  if (event.key === 'ArrowUp' || keyCode === 38) return 'up'
  if (event.key === 'ArrowDown' || keyCode === 40) return 'down'
  if (event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack' || keyCode === 461 || keyCode === 10009) return 'back'
  if (keyCode === 415) return 'media-play'
  if (keyCode === 19) return 'media-pause'
  if (keyCode === 413) return 'media-stop'
  if (keyCode === 412) return 'media-rewind'
  if (keyCode === 417) return 'media-forward'
  return undefined
}

function mediaAction(keyCode: number): 'play' | 'pause' | 'stop' | 'rewind' | 'forward' | undefined {
  return keyCode === 415 ? 'play' : keyCode === 19 ? 'pause' : keyCode === 413 ? 'stop' : keyCode === 412 ? 'rewind' : keyCode === 417 ? 'forward' : undefined
}

export function useTvPlatform(routeKey: string, onResume: () => void, onBack: () => void): void {
  useEffect(() => {
    document.documentElement.classList.add('tv-platform')
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const classified = classifyTvKey(event)
      const direction: Direction | undefined =
        classified === 'left' || classified === 'right' || classified === 'up' || classified === 'down' ? classified : undefined
      if (direction && !editing() && move(direction)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (classified === 'back') {
        event.preventDefault()
        onBack()
        return
      }
      const action = mediaAction(event.keyCode)
      if (action) {
        window.dispatchEvent(new CustomEvent('rally:media', { detail: action }))
        event.preventDefault()
      }
    }
    const pointerFocus = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(FOCUSABLE) : null
      // Pointer activation focuses the same control D-pad would use.
      target?.focus({ preventScroll: true })
    }
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        routeFocus.set(routeKey, focusId(event.target))
        const group = event.target.closest<HTMLElement>(GROUP)
        if (group) {
          const items = groupItems(group)
          const index = items.indexOf(event.target)
          groupFocus.set(groupKey(group), `${focusId(event.target)}:${index >= 0 ? index : 0}`)
        }
      }
    }
    const resume = () => {
      const active = document.visibilityState === 'visible'
      notifyApplicationActive(active)
      if (active) onResume()
    }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('pointerdown', pointerFocus, true)
    window.addEventListener('pageshow', onResume)
    document.addEventListener('focusin', focusin)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('pointerdown', pointerFocus, true)
      window.removeEventListener('pageshow', onResume)
      document.removeEventListener('focusin', focusin)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [onBack, onResume, routeKey])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const remembered = routeFocus.get(routeKey)
      const target = remembered ? document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(remembered)}"]`) : null
      const initial = document.querySelector<HTMLElement>('[data-initial-focus="true"]')
      const fallback = target && visible(target) ? target : initial && visible(initial) ? initial : focusables()[0]
      fallback?.focus({ preventScroll: true })
      if (fallback) {
        try {
          fallback.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
        } catch {
          /* noop */
        }
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [routeKey])
}
