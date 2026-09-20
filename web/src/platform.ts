import { useEffect } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type Direction = 'left' | 'right' | 'up' | 'down'

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
}

function center(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function directionalScore(origin: HTMLElement, candidate: HTMLElement, direction: Direction): number | null {
  const from = center(origin)
  const to = center(candidate)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
  if (primary <= 2) return null
  const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
  // Row/column alignment must beat a physically closer diagonal control on a TV D-pad.
  return primary + secondary * 8
}

function moveFocus(direction: Direction): boolean {
  const items = focusables()
  if (!items.length) return false
  const active = document.activeElement instanceof HTMLElement && isVisible(document.activeElement)
    ? document.activeElement
    : undefined
  if (!active || !items.includes(active)) {
    items[0].focus({ preventScroll: true })
    items[0].scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return true
  }
  const next = items
    .filter((candidate) => candidate !== active)
    .map((candidate) => ({ candidate, score: directionalScore(active, candidate, direction) }))
    .filter((entry): entry is { candidate: HTMLElement; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score)[0]?.candidate
  if (!next) return false
  next.focus({ preventScroll: true })
  next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  return true
}

function activeEditor(): boolean {
  const active = document.activeElement
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
}

function handleBack(): void {
  const page = window.location.hash.replace(/^#/, '').split('/')[0]
  if (page && page !== 'home') {
    window.history.back()
    return
  }
  window.close()
}

function controlVideo(action: 'play' | 'pause' | 'stop' | 'rewind' | 'forward'): boolean {
  const video = document.querySelector('video')
  if (!video) return false
  if (action === 'play') void video.play()
  if (action === 'pause') video.pause()
  if (action === 'stop') {
    video.pause()
    video.currentTime = 0
  }
  if (action === 'rewind') video.currentTime = Math.max(0, video.currentTime - 10)
  if (action === 'forward') video.currentTime = Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + 10)
  return true
}

export function useTvPlatform(routeKey: string, onResume: () => void): void {
  useEffect(() => {
    document.documentElement.classList.add('tv-platform')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const direction: Direction | undefined = event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : undefined
      if (direction && !activeEditor() && moveFocus(direction)) {
        event.preventDefault()
        return
      }
      if (event.key === 'Escape' || event.keyCode === 461) {
        event.preventDefault()
        handleBack()
        return
      }
      const mediaAction = event.keyCode === 415 ? 'play' : event.keyCode === 19 ? 'pause' : event.keyCode === 413 ? 'stop' : event.keyCode === 412 ? 'rewind' : event.keyCode === 417 ? 'forward' : undefined
      if (mediaAction && controlVideo(mediaAction)) event.preventDefault()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onResume()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onResume])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const first = focusables()[0]
      if (first && !(document.activeElement instanceof HTMLInputElement)) first.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [routeKey])
}
