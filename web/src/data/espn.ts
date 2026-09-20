import { asArray, asRecord, stringValue } from '../domain'
import type { HighlightClip, JsonRecord, SportEvent, SportsSnapshot, Team, EventStatus } from '../domain'


export interface LeagueDescriptor {
  key: string
  sport: string
  league: string
}

const LEAGUES: LeagueDescriptor[] = [
  { key: 'NFL', sport: 'football', league: 'nfl' },
  { key: 'NCAAF', sport: 'football', league: 'college-football' },
  { key: 'NBA', sport: 'basketball', league: 'nba' },
  { key: 'NCAAB', sport: 'basketball', league: 'mens-college-basketball' },
  { key: 'MLB', sport: 'baseball', league: 'mlb' },
  { key: 'NHL', sport: 'hockey', league: 'nhl' },
  { key: 'EPL', sport: 'soccer', league: 'eng.1' },
  { key: 'La Liga', sport: 'soccer', league: 'esp.1' },
  { key: 'Champions League', sport: 'soccer', league: 'uefa.champions' },
  { key: 'Serie A', sport: 'soccer', league: 'ita.1' },
  { key: 'MLS', sport: 'soccer', league: 'usa.1' },
]

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'


function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return Number.isFinite(Number(value)) ? Number(value) : undefined
  return undefined
}


function formatDateForEspn(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Sports feed returned HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function eventStatus(raw: JsonRecord): EventStatus {
  const competition = asRecord(asArray(raw.competitions)[0])
  const status = asRecord(competition.status)
  const type = asRecord(status.type)
  const state = stringValue(type.state)
  const name = stringValue(type.name)?.toLowerCase() ?? ''
  if (name.includes('cancel')) return 'CANCELED'
  if (name.includes('delay')) return 'DELAYED'
  if (state === 'post') return 'FINISHED'
  if (state === 'in') return name.includes('half') ? 'HALFTIME' : 'LIVE'
  if (state === 'pre') return 'NOT_STARTED'
  return 'NOT_STARTED'
}

function teamFrom(raw: unknown): Team | undefined {
  const team = asRecord(raw)
  const id = stringValue(team.id)
  const name = stringValue(team.displayName) ?? stringValue(team.name)
  if (!id || !name) return undefined
  return {
    id,
    name,
    abbreviation: stringValue(team.abbreviation) ?? name.slice(0, 3).toUpperCase(),
    logoUrl: stringValue(team.logo) ?? stringValue(asRecord(asArray(team.logos)[0]).href),
    colors: [stringValue(team.color), stringValue(team.alternateColor)].filter((color): color is string => Boolean(color)),
  }
}

export function normalizeEspnEvent(rawValue: unknown, descriptor: LeagueDescriptor): SportEvent | null {
  const raw = asRecord(rawValue)
  const competition = asRecord(asArray(raw.competitions)[0])
  const competitors = asArray(competition.competitors).map(asRecord)
  const home = competitors.find((competitor) => competitor.homeAway === 'home')
  const away = competitors.find((competitor) => competitor.homeAway === 'away')
  const homeTeam = teamFrom(home?.team)
  const awayTeam = teamFrom(away?.team)
  const id = stringValue(raw.id)
  if (!id || !homeTeam || !awayTeam) return null
  const broadcasts = asArray(competition.broadcasts)
    .flatMap((broadcast) => asArray(asRecord(broadcast).names))
    .map(stringValue)
    .filter((name): name is string => Boolean(name))
  const statusType = asRecord(asRecord(competition.status).type)
  const startTime = stringValue(raw.date) ?? new Date().toISOString()
  const statusDetail = stringValue(statusType.detail) ?? stringValue(statusType.shortDetail) ?? stringValue(statusType.description)
  const notes = asArray(competition.notes).map(asRecord)
  const headlines = asArray(competition.headlines).map(asRecord)
  const contextTitle = stringValue(notes[0]?.headline) ?? stringValue(headlines[0]?.shortLinkText)
  const liveStats: Record<string, string> = {}
  if (broadcasts.length) liveStats['TV Broadcast'] = broadcasts.join(', ')
  if (statusDetail) liveStats['Game Status'] = statusDetail

  return {
    id,
    name: stringValue(raw.name) ?? `${awayTeam.name} at ${homeTeam.name}`,
    homeTeam,
    awayTeam,
    startTime,
    status: eventStatus(raw),
    scoreHome: numberValue(home?.score),
    scoreAway: numberValue(away?.score),
    sport: descriptor.sport,
    league: descriptor.key,
    venue: stringValue(asRecord(competition.venue).fullName),
    broadcastStations: broadcasts,
    gameStatusDetail: statusDetail,
    eventContextTitle: contextTitle,
    liveStats,
  }
}

async function fetchLeague(descriptor: LeagueDescriptor, signal?: AbortSignal): Promise<SportEvent[]> {
  const now = new Date()
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const dates = descriptor.key === 'NFL' || descriptor.key === 'NCAAF' ? '' : `?dates=${formatDateForEspn(now)}-${formatDateForEspn(end)}&limit=1000`
  const payload = await fetchJson<JsonRecord>(`${ESPN_BASE}/${descriptor.sport}/${descriptor.league}/scoreboard${dates}`, signal)
  return asArray(payload.events).map((event) => normalizeEspnEvent(event, descriptor)).filter((event): event is SportEvent => Boolean(event))
}

export async function loadSportsSnapshot(signal?: AbortSignal): Promise<SportsSnapshot> {
  const results = await Promise.allSettled(LEAGUES.map((descriptor) => fetchLeague(descriptor, signal)))
  const events: SportEvent[] = []
  const sourceIssues: string[] = []
  results.forEach((result, index) => {
    const descriptor = LEAGUES[index]
    if (result.status === 'fulfilled') {
      events.push(...result.value)
    } else if (result.reason?.name !== 'AbortError') {
      sourceIssues.push(`${descriptor.key}: sports feed unavailable`)
    }
  })
  const uniqueEvents = Array.from(new Map(events.map((event) => [event.id, event])).values())
  uniqueEvents.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
  return { events: uniqueEvents, fetchedAt: new Date().toISOString(), sourceIssues }
}

export async function loadEventSummary(event: SportEvent, signal?: AbortSignal): Promise<SportEvent> {
  const descriptor = LEAGUES.find((item) => item.key === event.league)
  if (!descriptor) return event
  try {
    const payload = await fetchJson<JsonRecord>(`${ESPN_BASE}/${descriptor.sport}/${descriptor.league}/summary?event=${encodeURIComponent(event.id)}`, signal)
    const header = asRecord(payload.header)
    const competition = asRecord(asArray(header.competitions)[0])
    const competitors = asArray(competition.competitors).map(asRecord)
    const home = competitors.find((competitor) => competitor.homeAway === 'home')
    const away = competitors.find((competitor) => competitor.homeAway === 'away')
    const status = asRecord(asRecord(competition.status).type)
    const broadcasts = asArray(competition.broadcasts)
      .flatMap((broadcast) => asArray(asRecord(broadcast).names))
      .map(stringValue)
      .filter((name): name is string => Boolean(name))
    const currentDetail = stringValue(status.detail) ?? stringValue(status.shortDetail) ?? event.gameStatusDetail
    const highlightClips = asArray(payload.videos).flatMap((value, index): HighlightClip[] => {
      const video = asRecord(value)
      const links = asRecord(video.links)
      const source = asRecord(links.source)
      const playbackUrl = stringValue(asRecord(source.HD).href)
        ?? stringValue(asRecord(source.mezzanine).href)
        ?? stringValue(asRecord(source.SD).href)
        ?? stringValue(asRecord(links.mobile).href)
      const title = stringValue(video.headline) ?? stringValue(video.title) ?? `Highlight ${index + 1}`
      if (!playbackUrl) return []
      return [{
        id: stringValue(video.id) ?? `${event.id}:${index}`,
        title,
        description: stringValue(video.description),
        playbackUrl,
        thumbnailUrl: stringValue(asRecord(asArray(video.images)[0]).url),
        duration: numberValue(video.duration),
      }]
    })
    return {
      ...event,
      scoreHome: numberValue(home?.score) ?? event.scoreHome,
      scoreAway: numberValue(away?.score) ?? event.scoreAway,
      broadcastStations: broadcasts.length ? broadcasts : event.broadcastStations,
      gameStatusDetail: currentDetail,
      liveStats: { ...event.liveStats, ...(currentDetail ? { 'Game Status': currentDetail } : {}) },
      highlightClips,
    }
  } catch {
    return event
  }
}
