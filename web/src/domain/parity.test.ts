import { describe, expect, it } from 'vitest'
import { buildHomeState, DEFAULT_PREFERENCES, selectRecoveryCandidate } from './index'
import type { RallyPreferences, RallyRoute, SourceCandidate, SportEvent } from './types'
import { parseRoute, routeHash } from '../router'

const event = (overrides: Partial<SportEvent>): SportEvent => ({
  id: 'event',
  name: 'Away at Home',
  homeTeam: { id: 'home', name: 'Home', abbreviation: 'HOM' },
  awayTeam: { id: 'away', name: 'Away', abbreviation: 'AWY' },
  startTime: '2026-09-20T18:00:00.000Z',
  status: 'NOT_STARTED',
  sport: 'football',
  league: 'NFL',
  broadcastStations: [],
  liveStats: {},
  ...overrides,
})

const source = (id: string, exactGameMatch = true): SourceCandidate => ({
  id,
  sourceKind: 'STREMIO',
  title: id,
  playbackTarget: `https://media.example/${id}.m3u8`,
  quality: { resolution: '1080p', is4K: false, is60Fps: false, isHdr: false },
  qualityRank: 300,
  exactGameMatch,
  matchConfidence: 1,
  matchEvidence: 'fixture',
  browserStatus: 'ready',
})

describe('webOS parity state', () => {
  it('round-trips serializable player and Multi-View routes', () => {
    const player: RallyRoute = { page: 'player', candidateId: 'iptv:42', eventId: 'game/1' }
    const multiview: RallyRoute = { page: 'multiview', candidateIds: ['iptv:42', 'stremio:a/b'], eventIds: ['game/1', 'game 2'] }
    expect(parseRoute(routeHash(player))).toEqual(player)
    expect(parseRoute(routeHash(multiview))).toEqual(multiview)
  })

  it('promotes a close live favorite above an ordinary live game', () => {
    const preferences: RallyPreferences = {
      ...DEFAULT_PREFERENCES,
      favoriteTeams: [{ id: 'home', name: 'Home', abbreviation: 'HOM', league: 'NFL' }],
      viewing: { ...DEFAULT_PREFERENCES.viewing },
    }
    const ordinary = event({ id: 'ordinary', league: 'NBA', sport: 'basketball', status: 'LIVE', scoreAway: 50, scoreHome: 80 })
    const favorite = event({ id: 'favorite', status: 'LIVE', scoreAway: 20, scoreHome: 21 })
    const state = buildHomeState([ordinary, favorite], preferences, Date.parse('2026-09-20T18:30:00.000Z'))
    expect(state.featuredEvent?.id).toBe('favorite')
    expect(state.heroMode).toBe('CLOSE_GAME')
  })

  it('never recovers to a mismatched or failed source', () => {
    const failed = source('failed')
    const mismatch = source('mismatch', false)
    const fallback = source('fallback')
    expect(selectRecoveryCandidate([failed, mismatch, fallback], 'current', new Set(['failed']))?.id).toBe('fallback')
  })
})
