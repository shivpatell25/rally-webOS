import type { FavoriteTeamProfile, HomeHeroMode, HomeState, RallyPreferences, SportEvent } from './types'

export const DEFAULT_SPORTS_ORDER = ['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB', 'NHL', 'EPL', 'La Liga', 'Champions League', 'Serie A', 'MLS']

export const DEFAULT_PREFERENCES: RallyPreferences = {
  provider: { portalUrl: '', macAddress: '', addonUrls: [] },
  favoriteTeams: [],
  viewing: {
    enabledLeagues: [],
    favoriteSports: [],
    sportsOrder: DEFAULT_SPORTS_ORDER,
    liveGameAlerts: false,
    redZoneAlerts: false,
    lowLatency: true,
    adaptiveQuality: true,
    audioNormalization: true,
    reducedMotion: false,
    highContrastFocus: false,
    largeText: false,
    spokenScores: false,
    scoreSaver: true,
  },
  setupComplete: false,
}

export function isLive(event: SportEvent): boolean {
  return event.status === 'LIVE' || event.status === 'HALFTIME'
}

export function isCloseGame(event: SportEvent): boolean {
  if (!isLive(event) || event.scoreAway === undefined || event.scoreHome === undefined) return false
  const margin = Math.abs(event.scoreAway - event.scoreHome)
  const highScoring = /basket|football/i.test(`${event.sport} ${event.league}`)
  return margin <= (highScoring ? 8 : 2)
}

function favoriteEvent(event: SportEvent, favorites: FavoriteTeamProfile[]): boolean {
  return favorites.some((team) => team.league.toLowerCase() === event.league.toLowerCase() && (team.id === event.homeTeam?.id || team.id === event.awayTeam?.id))
}

function interestRank(event: SportEvent, preferences: RallyPreferences): number {
  const team = favoriteEvent(event, preferences.favoriteTeams) ? 500 : 0
  const sport = preferences.viewing.favoriteSports.some((item) => item.toLowerCase() === event.league.toLowerCase() || item.toLowerCase() === event.sport.toLowerCase()) ? 80 : 0
  const major = DEFAULT_SPORTS_ORDER.slice(0, 10).includes(event.league) ? 30 : 0
  return team + sport + major
}

export function buildHomeState(events: SportEvent[], preferences: RallyPreferences, now = Date.now()): HomeState {
  const enabled = new Set(preferences.viewing.enabledLeagues)
  const visible = enabled.size ? events.filter((event) => enabled.has(event.league)) : events
  const liveEvents = visible.filter(isLive).sort((a, b) => interestRank(b, preferences) - interestRank(a, preferences))
  const upcomingEvents = visible.filter((event) => event.status === 'NOT_STARTED' || event.status === 'DELAYED').sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
  const startingSoon = upcomingEvents.filter((event) => {
    const start = Date.parse(event.startTime)
    return start > now && start <= now + 2 * 60 * 60 * 1000
  })
  const recentFinals = visible.filter((event) => event.status === 'FINISHED' && Date.parse(event.startTime) >= now - 12 * 60 * 60 * 1000)
  const featuredEvent = [...liveEvents].sort((a, b) => (interestRank(b, preferences) + (isCloseGame(b) ? 260 : 0)) - (interestRank(a, preferences) + (isCloseGame(a) ? 260 : 0)))[0]
    ?? startingSoon[0]
    ?? recentFinals.sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0]
    ?? upcomingEvents[0]
  const heroMode: HomeHeroMode = !featuredEvent ? 'EMPTY'
    : isLive(featuredEvent) ? (isCloseGame(featuredEvent) ? 'CLOSE_GAME' : 'LIVE')
      : startingSoon.includes(featuredEvent) ? 'STARTING_SOON'
        : featuredEvent.status === 'FINISHED' ? 'FINAL_RECAP' : 'UPCOMING'
  const order = preferences.viewing.sportsOrder
  const groups = new Map<string, SportEvent[]>()
  for (const event of visible) groups.set(event.league, [...(groups.get(event.league) ?? []), event])
  const leagueShelves = [...groups.entries()]
    .sort(([a], [b]) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.localeCompare(b)
    })
    .map(([league, shelfEvents]) => ({ league, events: shelfEvents.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)) }))
  return {
    featuredEvent,
    heroMode,
    liveEvents,
    startingSoon,
    upcomingEvents: upcomingEvents.slice(0, 20),
    favoriteEvents: visible.filter((event) => favoriteEvent(event, preferences.favoriteTeams)).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)),
    leagueShelves,
  }
}

export function eventTeamProfiles(event: SportEvent): FavoriteTeamProfile[] {
  return [event.homeTeam, event.awayTeam].filter((team): team is NonNullable<typeof team> => Boolean(team)).map((team) => ({ ...team, league: event.league }))
}

export function preferenceClasses(preferences: RallyPreferences): string {
  return [
    preferences.viewing.reducedMotion && 'reduce-motion',
    preferences.viewing.highContrastFocus && 'high-contrast-focus',
    preferences.viewing.largeText && 'large-text',
  ].filter(Boolean).join(' ')
}
