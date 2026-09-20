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
