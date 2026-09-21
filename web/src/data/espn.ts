import { asArray, asRecord, stringValue } from '../domain'
import type { HighlightClip, JsonRecord, SportEvent, SportsSnapshot, Team, TeamHubProfile, TeamInjury, TeamPlayer, EventStatus } from '../domain'


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
  const timeoutId = setTimeout(() => controller.abort(), 12_000)
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Sports feed returned HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    clearTimeout(timeoutId)
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
function summaryDetails(payload: JsonRecord, event: SportEvent): Pick<SportEvent, 'teamStats' | 'playerLeaders' | 'winProbability' | 'playerStatTables' | 'plays'> {
  const boxscore = asRecord(payload.boxscore)
  const boxTeams = asArray(boxscore.teams).map(asRecord)
  const findBoxTeam = (teamId?: string, abbreviation?: string) => boxTeams.find((entry) => {
    const team = asRecord(entry.team)
    return stringValue(team.id) === teamId || stringValue(team.abbreviation)?.toLowerCase() === abbreviation?.toLowerCase()
  })
  const awayBox = findBoxTeam(event.awayTeam?.id, event.awayTeam?.abbreviation) ?? boxTeams[0]
  const homeBox = findBoxTeam(event.homeTeam?.id, event.homeTeam?.abbreviation) ?? boxTeams.at(-1)
  const statsFor = (team: JsonRecord | undefined) => asArray(team?.statistics).map(asRecord)
  const statValue = (team: JsonRecord | undefined, key: string, label: string) => {
    const stat = statsFor(team).find((entry) => stringValue(entry.name)?.toLowerCase() === key.toLowerCase() || stringValue(entry.label)?.toLowerCase() === label.toLowerCase())
    return stringValue(stat?.displayValue)
  }
  const sport = `${event.sport} ${event.league}`.toLowerCase()
  const preferred = sport.includes('football')
    ? [['netPassingYards', 'Passing'], ['rushingYards', 'Rushing'], ['totalYards', 'Total Yds'], ['turnovers', 'Turnovers'], ['firstDowns', '1st Downs']]
    : sport.includes('basket')
      ? [['fieldGoals', 'FG%'], ['threePointFieldGoals', '3PT%'], ['totalRebounds', 'Rebounds'], ['turnovers', 'Turnovers'], ['assists', 'Assists']]
      : sport.includes('base')
        ? [['hits', 'Hits'], ['errors', 'Errors'], ['strikeouts', 'Strikeouts'], ['walks', 'Walks']]
        : sport.includes('hock')
          ? [['shots', 'SOG'], ['powerPlayGoals', 'Power Play'], ['blockedShots', 'Blocks'], ['hits', 'Hits']]
          : [['shotsOnTarget', 'SOG'], ['possession', 'Possession'], ['fouls', 'Fouls'], ['cornerKicks', 'Corners']]
  const teamStats = preferred.flatMap(([key, label]) => {
    const awayValue = statValue(awayBox, key, label)
    const homeValue = statValue(homeBox, key, label)
    return awayValue || homeValue ? [{ label, awayValue: awayValue ?? '–', homeValue: homeValue ?? '–' }] : []
  })
  const predictor = asRecord(payload.predictor)
  const awayProjection = numberValue(asRecord(predictor.awayTeam).gameProjection)
  const homeProjection = numberValue(asRecord(predictor.homeTeam).gameProjection)
  if (awayProjection !== undefined || homeProjection !== undefined) {
    teamStats.push({ label: 'Win Prob', awayValue: awayProjection === undefined ? '–' : `${awayProjection}%`, homeValue: homeProjection === undefined ? '–' : `${homeProjection}%` })
  }

  const playerLeaders = asArray(payload.leaders).flatMap((rawGroup) => {
    const group = asRecord(rawGroup)
    const team = asRecord(group.team)
    return asArray(group.leaders).flatMap((rawCategory) => {
      const category = asRecord(rawCategory)
      const leader = asRecord(asArray(category.leaders)[0])
      const athlete = asRecord(leader.athlete)
      const playerShortName = stringValue(athlete.shortName) ?? stringValue(athlete.displayName) ?? stringValue(athlete.fullName)
      const statDisplay = stringValue(leader.displayValue) ?? stringValue(leader.value)
      if (!playerShortName || !statDisplay) return []
      return [{
        category: stringValue(category.displayName) ?? stringValue(category.name) ?? 'Leader',
        teamLogoUrl: stringValue(team.logo),
        teamAbbreviation: stringValue(team.abbreviation),
        playerShortName,
        statDisplay,
        position: stringValue(asRecord(athlete.position).abbreviation),
        headshotUrl: stringValue(asRecord(athlete.headshot).href),
      }]
    })
  })

  const rawPlays = asArray(payload.plays).map(asRecord)
  const playLookup = new Map(rawPlays.map((play) => [stringValue(play.id), play]))
  const plays = rawPlays.flatMap((play, index) => {
    const text = stringValue(play.text)
    if (!text) return []
    return [{
      id: stringValue(play.id) ?? `${event.id}:play:${index}`,
      sequence: numberValue(play.sequenceNumber) ?? index,
      text,
      awayScore: numberValue(play.awayScore),
      homeScore: numberValue(play.homeScore),
      period: numberValue(asRecord(play.period).number),
      clock: stringValue(asRecord(play.clock).displayValue),
      isScoringPlay: play.scoringPlay === true,
    }]
  }).sort((a, b) => b.sequence - a.sequence)
  const winProbability = asArray(payload.winprobability).flatMap((rawPoint, sequence) => {
    const point = asRecord(rawPoint)
    const homeWinPercentage = numberValue(point.homeWinPercentage)
    if (homeWinPercentage === undefined) return []
    const playId = stringValue(point.playId)
    const play = playLookup.get(playId)
    return [{
      playId,
      homeWinPercentage: Math.max(0, Math.min(1, homeWinPercentage)),
      tiePercentage: Math.max(0, Math.min(1, numberValue(point.tiePercentage) ?? 0)),
      period: numberValue(asRecord(play?.period).number),
      clock: stringValue(asRecord(play?.clock).displayValue),
      sequence,
    }]
  })
  const playerStatTables = asArray(boxscore.players).flatMap((rawGroup) => {
    const group = asRecord(rawGroup)
    const team = asRecord(group.team)
    return asArray(group.statistics).flatMap((rawCategory) => {
      const category = asRecord(rawCategory)
      const rows = asArray(category.athletes).flatMap((rawItem) => {
        const item = asRecord(rawItem)
        const athlete = asRecord(item.athlete)
        const displayName = stringValue(athlete.displayName) ?? stringValue(athlete.fullName) ?? stringValue(athlete.shortName)
        if (!displayName) return []
        return [{
          athleteId: stringValue(athlete.id),
          displayName,
          shortName: stringValue(athlete.shortName),
          headshotUrl: stringValue(asRecord(athlete.headshot).href),
          jersey: stringValue(athlete.jersey),
          position: stringValue(asRecord(athlete.position).abbreviation) ?? stringValue(asRecord(athlete.position).displayName),
          stats: asArray(item.stats).map(stringValue).filter((value): value is string => Boolean(value)),
        }]
      })
      if (!rows.length) return []
      return [{
        teamId: stringValue(team.id),
        teamName: stringValue(team.displayName) ?? stringValue(team.name) ?? 'Team',
        teamAbbreviation: stringValue(team.abbreviation) ?? 'TEAM',
        teamLogoUrl: stringValue(team.logo),
        category: stringValue(category.name),
        labels: asArray(category.labels).map(stringValue).filter((value): value is string => Boolean(value)),
        rows,
      }]
    })
  })
  return { teamStats, playerLeaders, winProbability, playerStatTables, plays }
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
  const recordSummary = (competitor?: JsonRecord): string | undefined =>
    stringValue(asRecord(asArray(competitor?.records)[0]).summary)
  const homeRecord = recordSummary(home)
  const awayRecord = recordSummary(away)
  if (homeRecord) liveStats[`${homeTeam.abbreviation} Record`] = homeRecord
  if (awayRecord) liveStats[`${awayTeam.abbreviation} Record`] = awayRecord

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
  const isGridiron = descriptor.key === 'NFL' || descriptor.key === 'NCAAF'
  const dateQuery = isGridiron ? '' : `?dates=${formatDateForEspn(now)}&limit=200`
  
  let payload = await fetchJson<JsonRecord>(`${ESPN_BASE}/${descriptor.sport}/${descriptor.league}/scoreboard${dateQuery}`, signal)
  let events = asArray(payload.events).map((event) => normalizeEspnEvent(event, descriptor)).filter((event): event is SportEvent => Boolean(event))
  
  if (!events.length && !isGridiron) {
    const monthQuery = `?dates=${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}&limit=1000`
    try {
      payload = await fetchJson<JsonRecord>(`${ESPN_BASE}/${descriptor.sport}/${descriptor.league}/scoreboard${monthQuery}`, signal)
      events = asArray(payload.events).map((event) => normalizeEspnEvent(event, descriptor)).filter((event): event is SportEvent => Boolean(event))
    } catch {
      // fallback failed, return empty
    }
  }
  return events
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
      const hls = asRecord(source.HLS)
      const mobile = asRecord(links.mobile)
      const playbackUrl = stringValue(asRecord(hls.HD).href)
        ?? stringValue(hls.href)
        ?? stringValue(asRecord(source.HD).href)
        ?? stringValue(source.href)
        ?? stringValue(asRecord(mobile.source).href)
      const title = stringValue(video.headline) ?? stringValue(video.title) ?? `Highlight ${index + 1}`
      if (!playbackUrl) return []
      return [{
        id: stringValue(video.id) ?? `${event.id}:${index}`,
        title,
        description: stringValue(video.description),
        playbackUrl,
        thumbnailUrl: stringValue(video.thumbnail) ?? stringValue(asRecord(asArray(video.images)[0]).url),
        duration: numberValue(video.duration),
      }]
    })
    const details = summaryDetails(payload, event)
    const pick = asRecord(asArray(payload.pickcenter)[0])
    const spread = numberValue(pick.spread)
    const overUnder = numberValue(pick.overUnder)
    const awayMoneyLine = numberValue(asRecord(pick.awayTeamOdds).moneyLine)
    const homeMoneyLine = numberValue(asRecord(pick.homeTeamOdds).moneyLine)
    const baseStats = details.teamStats ?? []
    const analytics: Array<{ label: string; awayValue: string; homeValue: string }> = []
    const addAnalytics = (label: string, awayValue: string, homeValue: string) => {
      if (!baseStats.some((stat) => stat.label.toLowerCase() === label.toLowerCase())) {
        analytics.push({ label, awayValue, homeValue })
      }
    }
    if (spread !== undefined) {
      addAnalytics('Spread', spread > 0 ? `-${spread}` : `+${-spread}`, spread > 0 ? `+${spread}` : `${spread}`)
    }
    if (overUnder !== undefined) {
      addAnalytics('Over/Under', `O ${overUnder}`, `U ${overUnder}`)
    }
    if (awayMoneyLine !== undefined && homeMoneyLine !== undefined) {
      addAnalytics('Moneyline', awayMoneyLine > 0 ? `+${awayMoneyLine}` : `${awayMoneyLine}`, homeMoneyLine > 0 ? `+${homeMoneyLine}` : `${homeMoneyLine}`)
    }
    return {
      ...event,
      scoreHome: numberValue(home?.score) ?? event.scoreHome,
      scoreAway: numberValue(away?.score) ?? event.scoreAway,
      broadcastStations: broadcasts.length ? broadcasts : event.broadcastStations,
      gameStatusDetail: currentDetail,
      liveStats: { ...event.liveStats, ...(currentDetail ? { 'Game Status': currentDetail } : {}) },
      highlightClips,
      ...details,
      teamStats: [...baseStats, ...analytics],
    }
  } catch {
    return event
  }
}
export interface LeagueStanding {
  team: string
  summary: string
}
function walkJson(value: unknown, visit: (record: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkJson(entry, visit))
    return
  }
  if (value && typeof value === 'object') {
    const record = value as JsonRecord
    visit(record)
    Object.values(record).forEach((entry) => walkJson(entry, visit))
  }
}
/** Port of Android EspnRepositoryImpl.getLeagueHub standings parsing. */
export async function loadLeagueStandings(leagueKey: string, signal?: AbortSignal): Promise<LeagueStanding[]> {
  const descriptor = LEAGUES.find((item) => item.key.toLowerCase() === leagueKey.toLowerCase())
  if (!descriptor) return []
  try {
    const root = await fetchJson<unknown>(`https://site.api.espn.com/apis/v2/sports/${descriptor.sport}/${descriptor.league}/standings`, signal)
    const standings: LeagueStanding[] = []
    walkJson(root, (record) => {
      const team = asRecord(record.team)
      const stats = asArray(record.stats)
      if (!team || !stats.length) return
      const name = stringValue(team.displayName) ?? stringValue(team.name)
      if (!name) return
      const summary = stats.map(asRecord).map((stat) => {
        const label = stringValue(stat.shortDisplayName) ?? stringValue(stat.name)
        const value = stringValue(stat.displayValue)
        if (!label || value === undefined) return null
        return ['w', 'l', 't', 'pct', 'gb'].includes(label.toLowerCase()) ? `${label} ${value}` : null
      }).filter((entry): entry is string => Boolean(entry)).slice(0, 3).join(' · ')
      standings.push({ team: name, summary })
    })
    return Array.from(new Map(standings.map((entry) => [entry.team, entry])).values())
  } catch {
    return []
  }
}

export async function loadTeamHub(leagueKey: string, teamId: string, fallback: Team, signal?: AbortSignal): Promise<TeamHubProfile> {
  const descriptor = LEAGUES.find((item) => item.key.toLowerCase() === leagueKey.toLowerCase())
  if (!descriptor) return { team: fallback, roster: [], injuries: [] }
  try {
    const [teamPayload, rosterPayload] = await Promise.all([
      fetchJson<JsonRecord>(`${ESPN_BASE}/${descriptor.sport}/${descriptor.league}/teams/${encodeURIComponent(teamId)}`, signal),
      fetchJson<JsonRecord>(`${ESPN_BASE}/${descriptor.sport}/${descriptor.league}/teams/${encodeURIComponent(teamId)}/roster`, signal).catch((): JsonRecord => ({})),
    ])
    const teamRecord = asRecord(teamPayload.team)
    const team = teamFrom(teamRecord) ?? fallback
    const athleteRecords = asArray(rosterPayload.athletes).flatMap((group) => {
      const record = asRecord(group)
      const items = asArray(record.items)
      return items.length ? items : [group]
    }).map(asRecord)
    const roster: TeamPlayer[] = athleteRecords.map((athlete) => ({
      id: stringValue(athlete.id) ?? '',
      name: stringValue(athlete.fullName) ?? stringValue(athlete.displayName) ?? '',
      position: stringValue(asRecord(athlete.position).abbreviation) ?? stringValue(asRecord(athlete.position).displayName),
      jersey: stringValue(athlete.jersey),
      headshotUrl: stringValue(asRecord(athlete.headshot).href),
    })).filter((player) => player.id && player.name)
    const injuries: TeamInjury[] = asArray(teamPayload.injuries).flatMap((group) => asArray(asRecord(group).items)).map(asRecord).map((injury) => {
      const athlete = asRecord(injury.athlete)
      return {
        id: stringValue(injury.id) ?? stringValue(athlete.id) ?? '',
        playerName: stringValue(athlete.displayName) ?? stringValue(athlete.fullName) ?? 'Player',
        status: stringValue(injury.status) ?? stringValue(injury.type) ?? 'Injury report',
        detail: stringValue(injury.details) ?? stringValue(injury.description),
      }
    }).filter((injury) => injury.id)
    return {
      team,
      record: stringValue(asRecord(asArray(asRecord(teamRecord.record).items)[0]).summary) ?? stringValue(teamRecord.recordSummary),
      standing: stringValue(teamRecord.standingSummary),
      roster,
      injuries,
    }
  } catch {
    return { team: fallback, roster: [], injuries: [] }
  }
}
