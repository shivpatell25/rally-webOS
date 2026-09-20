import { describe, expect, it, vi } from 'vitest'
import { TvActionGate, backTarget, isTopLevel } from './navigation'

describe('navigation backstack', () => {
  it('returns home from onboarding and exits from home', () => {
    expect(backTarget({ page: 'onboarding' })).toEqual({ kind: 'home' })
    expect(backTarget({ page: 'home' })).toEqual({ kind: 'exit' })
    expect(backTarget({ page: 'event', eventId: '1' })).toEqual({ kind: 'pop' })
    expect(backTarget({ page: 'player', candidateId: 'c' })).toEqual({ kind: 'pop' })
  })

  it('recognizes top-level destinations', () => {
    expect(isTopLevel({ page: 'home' })).toBe(true)
    expect(isTopLevel({ page: 'favorites' })).toBe(true)
    expect(isTopLevel({ page: 'event', eventId: '1' })).toBe(false)
    expect(isTopLevel({ page: 'settings' })).toBe(false)
  })

  it('gates rapid duplicate navigation like TvActionGate', () => {
    let now = 1000
    const gate = new TvActionGate(350, () => now)
    expect(gate.tryAcquire('top-level:home')).toBe(true)
    expect(gate.tryAcquire('top-level:home')).toBe(false)
    now += 350
    expect(gate.tryAcquire('top-level:home')).toBe(true)
    expect(vi.fn().mock.calls.length).toBe(0)
  })
})
