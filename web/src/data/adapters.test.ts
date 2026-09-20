import { describe, expect, it, vi } from 'vitest'
import { channelLooksLikeSport, parseStalkerChannels } from './stalker'
import { discoverStremioSources, redactProviderUrl } from './stremio'
import { parseStremioStream } from '../domain'
import type { SportEvent } from '../domain'

const matchup: SportEvent = {
  id: '401858457',
  name: 'USC Trojans at Rutgers Scarlet Knights',
  homeTeam: { id: 'rutgers', name: 'Rutgers Scarlet Knights', abbreviation: 'RUTG' },
  awayTeam: { id: 'usc', name: 'USC Trojans', abbreviation: 'USC' },
  startTime: '2026-09-19T19:00:00Z',
  status: 'LIVE',
  scoreHome: 28,
  scoreAway: 35,
  sport: 'football',
  league: 'NCAAF',
  broadcastStations: ['CBS'],
  liveStats: {},
}

describe('provider response adapters', () => {
  it('parses Stalker channel envelopes into safe Rally channels', () => {
    const channels = parseStalkerChannels({ data: [{ id: 17, number: 42, name: 'ESPN HD', tv_genre_id: 'Sports', cmd: 'ffmpeg http://provider.example/live' }] })
    expect(channels).toEqual([{ id: '17', number: '42', name: 'ESPN HD', category: 'Sports', logoUrl: undefined, streamUrl: 'ffmpeg http://provider.example/live' }])
    expect(channelLooksLikeSport(channels[0])).toBe(true)
  })

  it('rejects malformed addon streams but keeps direct HLS candidates attemptable', () => {
    expect(parseStalkerChannels({ data: [{ name: 'missing id' }] })).toEqual([])
    expect(parseStremioStream({ title: 'Premium required', url: 'https://video.example/live.m3u8' }, 'Addon')).toBeNull()
    const hls = parseStremioStream({ title: 'Live HLS', url: 'https://video.example/live.m3u8', behaviorHints: { notWebReady: true } }, 'Addon')
    expect(hls?.isDirectPlayable).toBe(true)
    expect(redactProviderUrl('https://addon.example/manifest.json?token=secret&keep=yes')).toContain('token=%5Bredacted%5D')
    expect(redactProviderUrl('https://addon.example/manifest.json?token=secret&keep=yes')).not.toContain('secret')
  })

  it('finds a matchup when an addon requires short team searches', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({ name: 'Sports Streams', catalogs: [{ type: 'sport', id: 'sports_live' }] }), { status: 200 })
      }
      if (url.includes('/search=usc.json')) {
        return new Response(JSON.stringify({ metas: [{ id: 'streamed:rutgers-vs-usc-2498777', type: 'sport', name: 'Rutgers vs USC', description: 'Rutgers vs USC LIVE NOW' }] }), { status: 200 })
      }
      if (url.includes('/stream/sport/streamed%3Arutgers-vs-usc-2498777.json')) {
        return new Response(JSON.stringify({ streams: [{ title: '1920x1080 · Stereo · ~8.8 Mbps', url: 'https://media.example/live.m3u8' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ metas: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    try {
      const result = await discoverStremioSources(['https://addon.example/manifest.json'], matchup)
      expect(result.candidates).toHaveLength(1)
      expect(result.candidates[0].playbackTarget).toBe('https://media.example/live.m3u8')
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search=usc.json'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
