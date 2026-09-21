import { describe, expect, it } from 'vitest'
import { resolveBroadcastQuality } from './core'
import type { SportEvent } from './types'

const base: SportEvent = {
  id: 'e1',
  name: 'Away at Home',
  homeTeam: { id: 'h', name: 'Home', abbreviation: 'HOM' },
  awayTeam: { id: 'a', name: 'Away', abbreviation: 'AWY' },
  startTime: '2026-09-20T18:00:00.000Z',
  status: 'NOT_STARTED',
  sport: 'football',
  league: 'NFL',
  broadcastStations: [],
  liveStats: {},
}

describe('resolveBroadcastQuality', () => {
  it('defaults to HD with the primary network', () => {
    expect(resolveBroadcastQuality({ ...base, broadcastStations: ['NBC'] })).toEqual({ badgeText: 'HD', network: 'NBC' })
  })

  it('marks ESPN NFL telecasts as 4K HDR like the Android resolver', () => {
    expect(resolveBroadcastQuality({ ...base, broadcastStations: ['ESPN'] }).badgeText).toBe('4K HDR')
  })

  it('does not grant ESPN 4K to other leagues', () => {
    expect(resolveBroadcastQuality({ ...base, league: 'MLB', broadcastStations: ['ESPN'] }).badgeText).toBe('HD')
  })

  it('honors explicit UHD metadata', () => {
    expect(resolveBroadcastQuality({ ...base, broadcastStations: ['FOX 4K UHD'] }).badgeText).toBe('4K UHD')
  })
})
