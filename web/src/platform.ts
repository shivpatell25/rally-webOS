import { useEffect } from 'react'
import { notifyApplicationActive } from './webos'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
const GROUP = '[data-focus-row],[data-focus-column],[data-focus-grid]'
type Direction = 'left' | 'right' | 'up' | 'down'
const routeFocus = new Map<string, string>()
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

function explicitTarget(active: HTMLElement, direction: Direction): HTMLElement | undefined {
  const key = `focus${direction[0].toUpperCase()}${direction.slice(1)}` as 'focusLeft' | 'focusRight' | 'focusUp' | 'focusDown'
  const id = active.dataset[key]
  return id ? document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`) ?? undefined : undefined
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
  const forward = direction === 'right' || direction === 'down'
  for (let index = currentIndex + (forward ? 1 : -1); index >= 0 && index < groups.length; index += forward ? 1 : -1) {
    const candidateGroup = groups[index]
    if (candidateGroup.contains(current) || current.contains(candidateGroup)) continue
    const candidates = groupItems(candidateGroup)
    if (!candidates.length) continue
    const activeIndex = Math.max(0, groupItems(current).indexOf(active))
    return candidates[Math.min(activeIndex, candidates.length - 1)]
  }
  return undefined
}

function reveal(element: HTMLElement): void {
  const row = element.closest<HTMLElement>('[data-focus-row],[data-focus-grid]')
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' })
  if (row?.dataset.focusPaging === 'true') {
    const page = Math.max(1, Number(row.dataset.focusPageSize) || 4)
    const items = groupItems(row)
    const index = items.indexOf(element)
    const pageStart = Math.floor(index / page) * page
    items[pageStart]?.scrollIntoView({ block: 'nearest', inline: 'start', behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' })
  }
}

function move(direction: Direction): boolean {
  const now = performance.now()
  if (now - lastMoveAt < 85) return true
  lastMoveAt = now
  const items = focusables()
  if (!items.length) return false
  const active = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : undefined
  if (!active) {
    items[0].focus({ preventScroll: true })
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
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
}

function mediaAction(keyCode: number): 'play' | 'pause' | 'stop' | 'rewind' | 'forward' | undefined {
  return keyCode === 415 ? 'play' : keyCode === 19 ? 'pause' : keyCode === 413 ? 'stop' : keyCode === 412 ? 'rewind' : keyCode === 417 ? 'forward' : undefined
}

export function useTvPlatform(routeKey: string, onResume: () => void, onBack: () => void): void {
  useEffect(() => {
    document.documentElement.classList.add('tv-platform')
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const direction: Direction | undefined = event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : undefined
      if (direction && !editing() && move(direction)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key === 'Escape' || event.key === 'BrowserBack' || event.keyCode === 461) {
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
      target?.focus({ preventScroll: true })
    }
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) routeFocus.set(routeKey, focusId(event.target))
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
      ;(target && visible(target) ? target : initial && visible(initial) ? initial : focusables()[0])?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [routeKey])
}
