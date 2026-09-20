export type EventStatus =
  | 'NOT_STARTED'
  | 'LIVE'
  | 'HALFTIME'
  | 'FINISHED'
  | 'DELAYED'
  | 'CANCELED'

export interface Team {
  id: string
  name: string
  abbreviation: string
  logoUrl?: string
  colors?: string[]
}

export interface TeamPlayer {
  id: string
  name: string
  position?: string
  jersey?: string
  headshotUrl?: string
}

export interface TeamInjury {
  id: string
  playerName: string
  status: string
  detail?: string
}

export interface TeamHubProfile {
  team: Team
  record?: string
  standing?: string
  roster: TeamPlayer[]
  injuries: TeamInjury[]
}
export interface HighlightClip {
  id: string
  title: string
  description?: string
  playbackUrl: string
  thumbnailUrl?: string
  duration?: number
}
export interface TeamStatComparison {
  label: string
  awayValue: string
  homeValue: string
}

export interface PlayerLeader {
  category: string
  teamLogoUrl?: string
  teamAbbreviation?: string
  playerShortName: string
  statDisplay: string
  position?: string
  headshotUrl?: string
}

export interface WinProbabilityPoint {
  playId?: string
  homeWinPercentage: number
  tiePercentage: number
  period?: number
  clock?: string
  sequence: number
}

export interface PlayerStatRow {
  athleteId?: string
  displayName: string
  shortName?: string
  headshotUrl?: string
  jersey?: string
  position?: string
  stats: string[]
}

export interface PlayerStatTable {
  teamId?: string
  teamName: string
  teamAbbreviation: string
  teamLogoUrl?: string
  category?: string
  labels: string[]
  rows: PlayerStatRow[]
}

export interface GamePlay {
  id: string
  sequence: number
  text: string
  awayScore?: number
  homeScore?: number
  period?: number
  clock?: string
  isScoringPlay: boolean
}


export interface SportEvent {
  id: string
  name: string
  homeTeam?: Team
  awayTeam?: Team
  startTime: string
  status: EventStatus
  scoreHome?: number
  scoreAway?: number
  sport: string
  league: string
  venue?: string
  broadcastStations: string[]
  gameStatusDetail?: string
  eventContextTitle?: string
  liveStats: Record<string, string>
  highlightClips?: HighlightClip[]
  teamStats?: TeamStatComparison[]
  playerLeaders?: PlayerLeader[]
  winProbability?: WinProbabilityPoint[]
  playerStatTables?: PlayerStatTable[]
  plays?: GamePlay[]
}

export interface ChannelGuide {
  now?: { title: string; description?: string; startTime?: string; endTime?: string }
  next?: { title: string; description?: string; startTime?: string; endTime?: string }
}

export interface IptvChannel {
  id: string
  number: string
  name: string
  category: string
  logoUrl?: string
  streamUrl?: string
  guide?: ChannelGuide
}

export interface StremioStreamOption {
  title: string
  description?: string
  streamUrl: string
  quality?: string
  bitrate?: string
  addonName?: string
  headers?: Record<string, string>
  isDirectPlayable: boolean
}

export type StreamSourceKind = 'IPTV' | 'STREMIO'
export type BrowserSourceStatus = 'unknown' | 'checking' | 'ready' | 'blocked' | 'unsupported'

export interface StreamQualityInfo {
  resolution?: string
  fps?: string
  is4K: boolean
  is60Fps: boolean
  isHdr: boolean
}

export interface SourceCandidate {
  id: string
  sourceKind: StreamSourceKind
  title: string
  playbackTarget: string
  quality: StreamQualityInfo
  qualityRank: number
  exactGameMatch: boolean
  matchConfidence: number
  matchEvidence: string
  headers?: Record<string, string>
  channel?: IptvChannel
  stremioStream?: StremioStreamOption
  browserStatus: BrowserSourceStatus
  browserStatusDetail?: string
  requiresProviderResolution?: boolean
}

export interface ProviderConfig {
  portalUrl: string
  macAddress: string
  serialNumber?: string
  deviceId?: string
  addonUrls: string[]
}

export interface ProviderValidation {
  config: ProviderConfig
  errors: string[]
  warnings: string[]
}

export interface ProviderIssue {
  provider: string
  message: string
  detail?: string
}

export interface SportsSnapshot {
  events: SportEvent[]
  fetchedAt: string
  sourceIssues: string[]
}

export interface StremioManifest {
  id?: string
  name?: string
  description?: string
  types?: string[]
  catalogs?: Array<{ type?: string; id?: string; name?: string }>
}

export interface StremioMeta {
  id: string
  type?: string
  name?: string
  description?: string
  poster?: string
}

export interface StremioRawStream {
  name?: string
  title?: string
  description?: string
  url?: string
  externalUrl?: string
  behaviorHints?: {
    proxyHeaders?: { request?: Record<string, string> }
    notWebReady?: boolean
  }
}

export interface FavoriteTeamProfile extends Team {
  league: string
}

export interface ViewingPreferences {
  enabledLeagues: string[]
  favoriteSports: string[]
  sportsOrder: string[]
  liveGameAlerts: boolean
  redZoneAlerts: boolean
  lowLatency: boolean
  adaptiveQuality: boolean
  audioNormalization: boolean
  reducedMotion: boolean
  highContrastFocus: boolean
  largeText: boolean
  spokenScores: boolean
  scoreSaver: boolean
}

export interface RallyPreferences {
  provider: ProviderConfig
  favoriteTeams: FavoriteTeamProfile[]
  viewing: ViewingPreferences
  setupComplete: boolean
}

export type HomeHeroMode = 'LIVE' | 'CLOSE_GAME' | 'STARTING_SOON' | 'FINAL_RECAP' | 'UPCOMING' | 'EMPTY'

export interface HomeState {
  featuredEvent?: SportEvent
  heroMode: HomeHeroMode
  liveEvents: SportEvent[]
  startingSoon: SportEvent[]
  upcomingEvents: SportEvent[]
  favoriteEvents: SportEvent[]
  leagueShelves: Array<{ league: string; events: SportEvent[] }>
}

export type RallyRoute =
  | { page: 'onboarding' }
  | { page: 'home' }
  | { page: 'live' }
  | { page: 'leagues' }
  | { page: 'league'; league: string }
  | { page: 'team'; league: string; teamId: string }
  | { page: 'highlights' }
  | { page: 'search' }
  | { page: 'favorites' }
  | { page: 'settings'; section?: string }
  | { page: 'event'; eventId: string }
  | { page: 'player'; candidateId: string; eventId?: string }
  | { page: 'multiview'; candidateIds: string[]; eventIds: string[] }

export interface DeviceCapabilities {
  webos: boolean
  nativeHls: boolean
  mediaSource: boolean
  maxConcurrentStreams: number
  serviceBridge: boolean
  userAgent: string
}

export interface ProviderDiagnostic {
  label: string
  status: 'idle' | 'running' | 'ready' | 'warning' | 'error'
  detail: string
  latencyMs?: number
}

export interface PlaybackMetrics {
  startupMs?: number
  resolution?: string
  bufferedSeconds: number
  droppedFrames?: number
  recoveryAttempt: number
}
