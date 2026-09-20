import { describe, expect, it } from 'vitest'
import { normalizeEspnEvent } from '../data/espn'
import {
  classifyPlaybackError,
  matchChannelToEvent,
  normalizeAddon,
  normalizePortal,
  parseQualityFromText,
  parseStremioStream,
  qualityRank,
  toggleFavorite,
  splitAddonInputs,
  validateProviderConfig,
} from './core'
import type { IptvChannel, SportEvent } from './types'

const event: SportEvent = {
  id: 'game-1',
  name: 'Away City at Home City',
  homeTeam: { id: 'home', name: 'Home City', abbreviation: 'HOM' },
  awayTeam: { id: 'away', name: 'Away City', abbreviation: 'AWY' },
  startTime: '2026-09-19T20:00:00Z',
  status: 'NOT_STARTED',
  sport: 'football',
  league: 'NFL',
  broadcastStations: ['ESPN'],
  liveStats: {},
}

const channel = (name: string): IptvChannel => ({ id: name, number: '1', name, category: 'Sports', streamUrl: 'https://provider.example/live.m3u8' })


describe('Rally shared web core', () => {
  it('normalizes a public scoreboard event into a Rally matchup', () => {
    const normalized = normalizeEspnEvent({
      id: '42',
      name: 'Away FC at Home FC',
      date: '2026-09-19T20:00:00Z',
      competitions: [{
        competitors: [
          { homeAway: 'home', score: '4', team: { id: 'home', displayName: 'Home FC', abbreviation: 'HOM' } },
          { homeAway: 'away', score: '2', team: { id: 'away', displayName: 'Away FC', abbreviation: 'AWY' } },
        ],
        status: { type: { state: 'pre', detail: 'Scheduled' } },
        broadcasts: [{ names: ['ESPN'] }],
        venue: { fullName: 'Rally Stadium' },
      }],
    }, { key: 'MLS', sport: 'soccer', league: 'usa.1' })
    expect(normalized).toMatchObject({ id: '42', status: 'NOT_STARTED', scoreHome: 4, scoreAway: 2, venue: 'Rally Stadium', league: 'MLS' })
    expect(normalized?.homeTeam?.abbreviation).toBe('HOM')
  })
  it('normalizes provider URLs without destroying ports', () => {
    expect(normalizePortal('example.com:8080/c/server/load.php')).toBe('http://example.com:8080/c')
    expect(normalizeAddon('addon.example.com')).toBe('https://addon.example.com/manifest.json')
    expect(normalizeAddon('basketball')).toBeNull()
    expect(normalizeAddon('"sf"')).toBeNull()
    expect(splitAddonInputs('https://addon.example/manifest.json\nhttps://second.example/manifest.json')).toEqual(['https://addon.example/manifest.json', 'https://second.example/manifest.json'])
    const pastedManifest = '{"id":"community.sports.fly","catalogs":[]}'
    expect(splitAddonInputs(pastedManifest)).toEqual([pastedManifest])
  })

  it('validates provider configuration and warns on HTTP', () => {
    const result = validateProviderConfig({ portalUrl: 'http://provider.example/c', macAddress: '00:1A:79:AA:BB:CC', addonUrls: [] })
    expect(result.errors).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('insecure HTTP'))).toBe(true)
  })
  it('rejects pasted manifest JSON instead of turning fields into hosts', () => {
    const result = validateProviderConfig({ portalUrl: '', macAddress: '', addonUrls: ['{"id":"community.sports.fly","catalogs":[]}'] })
    expect(result.errors).toContain('Paste the URL that serves the Stremio manifest, not the manifest JSON itself.')
  })

  it('matches an exact game channel above generic sports channels', () => {
    const exact = matchChannelToEvent(channel('HOM vs AWY 1080p'), event)
    const network = matchChannelToEvent(channel('ESPN HD'), event)
    expect(exact?.exactGameMatch).toBe(true)
    expect((exact?.matchConfidence ?? 0) > (network?.matchConfidence ?? 1)).toBe(true)
  })

  it('parses and ranks evidence-based quality labels', () => {
    const quality = parseQualityFromText('Network 4K HDR 60FPS')
    expect(quality).toEqual({ resolution: '4K', fps: '60 fps', is4K: true, is60Fps: true, isHdr: true })
    expect(qualityRank(quality)).toBe(430)
  })

  it('parses web-only addon pages without marking them playable', () => {
    const stream = parseStremioStream({ title: 'Watch in browser', externalUrl: 'https://provider.example/watch/1' }, 'Example Addon')
    expect(stream?.isDirectPlayable).toBe(false)
  })

  it('toggles favorites deterministically', () => {
    expect(toggleFavorite([], 'team-1')).toEqual(['team-1'])
    expect(toggleFavorite(['team-1'], 'team-1')).toEqual([])
  })

  it('explains browser failures without exposing provider URLs', () => {
    const message = classifyPlaybackError(new Error('Failed to fetch https://secret.example/token=abc'))
    expect(message).toContain('CORS')
    expect(message).not.toContain('secret.example')
  })
})
