import type {
  IptvChannel,
  ProviderConfig,
  ProviderValidation,
  SourceCandidate,
  SportEvent,
  StremioRawStream,
  StremioStreamOption,
  StreamQualityInfo,
  Team,
} from './types'

const HTTP_SCHEME = /^https?:\/\//i
const MAC_ADDRESS = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/i

export function normalizePortal(rawValue: string): string {
  let value = rawValue.trim()
  if (!value) return ''
  if (!HTTP_SCHEME.test(value)) value = `http://${value}`
  const schemeEnd = value.indexOf('://')
  const authorityStart = schemeEnd + 3
  const pathStart = value.indexOf('/', authorityStart)
  const authority = value.slice(authorityStart, pathStart < 0 ? value.length : pathStart)
  const lastColon = authority.lastIndexOf(':')
  const suffix = authority.slice(lastColon + 1)
  if (lastColon > 0 && suffix && !/^\d+$/.test(suffix) && !authority.includes('@') && !authority.startsWith('[')) {
    value = `${value.slice(0, authorityStart)}${authority.slice(0, lastColon)}.${suffix}${value.slice(pathStart < 0 ? value.length : pathStart)}`
  }
  try {
    const parsed = new URL(value)
    const path = parsed.pathname.replace(/\/+$/, '').replace(/\/(?:server\/)?load\.php$/i, '') || ''
    parsed.pathname = path
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function normalizeAddon(rawValue: string): string | null {
  let value = rawValue.trim()
  if (!value || /[\s"'{}[\]]/.test(value)) return null
  if (!HTTP_SCHEME.test(value)) value = `https://${value}`
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase()
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    if (!hostname || (!hostname.includes('.') && hostname !== 'localhost' && !isIpv4)) return null
    if (!parsed.pathname.toLowerCase().endsWith('manifest.json')) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/manifest.json`
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export function splitAddonInputs(rawValue: string): string[] {
  const value = rawValue.trim()
  if (!value) return []
  if (value.startsWith('{') || value.startsWith('[')) return [value]
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

export function validateProviderConfig(input: ProviderConfig): ProviderValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const portalUrl = normalizePortal(input.portalUrl)
  const addonUrls = input.addonUrls.map(normalizeAddon).filter((url): url is string => Boolean(url))
  const normalizedMac = input.macAddress.trim().toUpperCase()
  const hasManifestDocument = input.addonUrls.some((value) => {
    const trimmed = value.trim()
    return trimmed.startsWith('{') || trimmed.startsWith('[')
  })

  if (input.portalUrl.trim() && !portalUrl) errors.push('Enter a valid IPTV portal URL.')
  if (portalUrl && !normalizedMac.match(MAC_ADDRESS)) {
    errors.push('Enter a valid MAC address using XX:XX:XX:XX:XX:XX.')
  }
  if (hasManifestDocument) {
    errors.push('Paste the URL that serves the Stremio manifest, not the manifest JSON itself.')
  } else if (input.addonUrls.some((url) => !normalizeAddon(url))) {
    errors.push('One or more Stremio addon URLs are invalid.')
  }
  if (!portalUrl && addonUrls.length === 0) {
    warnings.push('Add an IPTV portal or Stremio manifest to discover sources.')
  }
  if (portalUrl.startsWith('http://')) {
    warnings.push('This IPTV portal uses insecure HTTP. Prefer HTTPS when the provider supports it.')
  }
  if (addonUrls.some((url) => url.startsWith('http://'))) {
    warnings.push('An addon uses insecure HTTP and may be blocked by an HTTPS web app.')
  }

  return {
    config: {
      portalUrl,
      macAddress: normalizedMac,
      ...(input.serialNumber?.trim() ? { serialNumber: input.serialNumber.trim() } : {}),
      ...(input.deviceId?.trim() ? { deviceId: input.deviceId.trim() } : {}),
      addonUrls,
    },
    errors,
    warnings,
  }
}

export function normalizeMatchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function termsForTeam(team?: Team): string[] {
  if (!team) return []
  return [team.name, team.abbreviation, ...team.name.split(/\s+/)]
    .map(normalizeMatchText)
    .filter((term) => term.length >= 3)
}

function hasTerm(text: string, term: string): boolean {
  return text.split(' ').includes(term) || text.includes(term)
}

export function textMatchesEvent(text: string, event: SportEvent): boolean {
  const normalized = normalizeMatchText(text)
  const homeTerms = termsForTeam(event.homeTeam)
  const awayTerms = termsForTeam(event.awayTeam)
  const hasHome = homeTerms.some((term) => hasTerm(normalized, term))
  const hasAway = awayTerms.some((term) => hasTerm(normalized, term))
  const eventName = normalizeMatchText(event.name)
  return (hasHome && hasAway) || (eventName.length > 3 && (normalized.includes(eventName) || eventName.includes(normalized)))
}

export function matchChannelToEvent(channel: IptvChannel, event: SportEvent): SourceCandidate | null {
  const channelText = normalizeMatchText(`${channel.name} ${channel.category}`)
  const homeTerms = termsForTeam(event.homeTeam)
  const awayTerms = termsForTeam(event.awayTeam)
  const hasHome = homeTerms.some((term) => hasTerm(channelText, term))
  const hasAway = awayTerms.some((term) => hasTerm(channelText, term))
  const league = normalizeMatchText(event.league)
  const sport = normalizeMatchText(event.sport)
  const hasLeague = Boolean(league && channelText.includes(league))
  const hasSport = Boolean(sport && channelText.includes(sport))
  const station = event.broadcastStations.some((name) => channelText.includes(normalizeMatchText(name)))
  const exactGameMatch = hasHome && hasAway
  if (!exactGameMatch && !hasHome && !hasAway && !station && !hasLeague && !hasSport) return null

  const confidence = exactGameMatch ? 0.98 : station && (hasHome || hasAway || hasLeague) ? 0.92 : hasHome || hasAway ? 0.72 : hasLeague || station ? 0.45 : 0.25
  const matchEvidence = exactGameMatch
    ? 'Both teams appear in the channel name'
    : station
      ? `Broadcast station: ${event.broadcastStations.find((name) => channelText.includes(normalizeMatchText(name))) ?? 'official network'}`
      : hasHome || hasAway
        ? 'One team and sports context match'
        : 'League or sport context match'

  const quality = parseQualityFromText(channel.name)
  return {
    id: `iptv:${channel.id}`,
    sourceKind: 'IPTV',
    title: channel.name,
    playbackTarget: channel.streamUrl || channel.id,
    quality,
    qualityRank: qualityRank(quality),
    exactGameMatch,
    matchConfidence: confidence,
    matchEvidence,
    channel,
    browserStatus: channel.streamUrl?.match(/^https?:\/\//i) ? 'unknown' : 'unknown',
    requiresProviderResolution: !channel.streamUrl?.match(/^https?:\/\//i),
  }
}

export function parseQualityFromText(name: string): StreamQualityInfo {
  const upper = name.toUpperCase()
  const resolution = /\b(?:4K|UHD|2160P?)\b/.test(upper)
    ? '4K'
    : /\b(?:1080P?|FHD)\b/.test(upper)
      ? '1080p'
      : /\b720P?\b/.test(upper)
        ? '720p'
        : /(?:^|[ |:_-])HD\b/.test(upper)
          ? 'HD'
          : undefined
  const fps = /\b60(?:FPS|\s*FPS|P)?\b/.test(upper) ? '60 fps' : /\b50(?:FPS|\s*FPS|P)?\b/.test(upper) ? '50 fps' : undefined
  return {
    resolution,
    fps,
    is4K: resolution === '4K',
    is60Fps: fps === '60 fps',
    isHdr: /\b(?:HDR|HLG|DOLBY VISION)\b/.test(upper),
  }
}

export function qualityRank(quality: StreamQualityInfo): number {
  const resolutionRank = quality.resolution === '4K' ? 400 : quality.resolution === '1080p' ? 300 : quality.resolution === '720p' ? 200 : quality.resolution === 'HD' ? 100 : 0
  return resolutionRank + (quality.isHdr ? 20 : 0) + (quality.is60Fps ? 10 : 0)
}

export function rankStreamCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.exactGameMatch !== b.exactGameMatch) return a.exactGameMatch ? -1 : 1
    const aPlayable = a.browserStatus !== 'blocked' && a.browserStatus !== 'unsupported'
    const bPlayable = b.browserStatus !== 'blocked' && b.browserStatus !== 'unsupported'
    if (aPlayable !== bPlayable) return aPlayable ? -1 : 1
    return (b.qualityRank + b.matchConfidence * 100) - (a.qualityRank + a.matchConfidence * 100)
  })
}

export function selectRecoveryCandidate(candidates: SourceCandidate[], currentId: string, failedIds: ReadonlySet<string> = new Set()): SourceCandidate | undefined {
  return rankStreamCandidates(candidates).find((candidate) =>
    candidate.id !== currentId
    && !failedIds.has(candidate.id)
    && candidate.exactGameMatch
    && candidate.browserStatus !== 'blocked'
    && candidate.browserStatus !== 'unsupported')
}

export function parseStremioStream(raw: StremioRawStream, addonName: string): StremioStreamOption | null {
  const directUrl = raw.url?.trim()
  const externalUrl = raw.externalUrl?.trim()
  const streamUrl = directUrl || externalUrl
  if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) return null
  const text = [raw.title, raw.name, raw.description].filter(Boolean).join(' ')
  if (/youtube\.com|premium required|upgrade to/i.test(`${streamUrl} ${text}`)) return null
  return {
    title: raw.title?.trim() || raw.name?.trim() || 'Live stream',
    description: raw.description?.trim(),
    streamUrl,
    quality: parseQualityFromText(text).resolution,
    bitrate: text.match(/\d+(?:\.\d+)?\s*(?:Mbps|MB\/s|Kbps)/i)?.[0],
    addonName,
    headers: raw.behaviorHints?.proxyHeaders?.request,
    // Some addons set notWebReady for streams that still expose browser-readable
    // HLS URLs. Treat direct media as an attemptable source; PlaybackView and the
    // browser access check remain the authority on whether this session can play it.
    isDirectPlayable: Boolean(directUrl),
  }
}

export function stremioToCandidate(stream: StremioStreamOption, event: SportEvent): SourceCandidate {
  const quality = parseQualityFromText([stream.title, stream.description, stream.quality, stream.bitrate].filter(Boolean).join(' '))
  const exactGameMatch = textMatchesEvent(`${stream.title} ${stream.description ?? ''}`, event)
  return {
    id: `stremio:${stream.streamUrl}`,
    sourceKind: 'STREMIO',
    title: stream.title,
    playbackTarget: stream.streamUrl,
    quality,
    qualityRank: qualityRank(quality),
    exactGameMatch: exactGameMatch || stream.isDirectPlayable,
    matchConfidence: exactGameMatch ? 0.95 : stream.isDirectPlayable ? 0.7 : 0.2,
    matchEvidence: exactGameMatch ? 'Addon result matches the selected event' : 'Addon returned a direct media URL',
    headers: stream.headers,
    stremioStream: stream,
    browserStatus: stream.isDirectPlayable ? 'unknown' : 'unsupported',
    browserStatusDetail: stream.isDirectPlayable ? undefined : 'Addon supplied a web page rather than direct media.',
  }
}

export function toggleFavorite(current: string[], teamId: string): string[] {
  return current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]
}

export function classifyPlaybackError(error: unknown): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (normalized.includes('cors') || normalized.includes('access-control') || normalized.includes('failed to fetch')) return 'The provider blocked browser access (CORS or network policy). Try another source or use the provider’s supported app.'
  if (normalized.includes('not supported') || normalized.includes('codec') || normalized.includes('mime')) return 'This browser cannot decode the selected stream format or codec.'
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('unauthorized') || normalized.includes('forbidden')) return 'The provider rejected this request. Re-check the portal session and source authorization.'
  if (normalized.includes('mixed content') || normalized.includes('insecure')) return 'The browser blocked an insecure HTTP stream from this HTTPS app. Prefer an HTTPS source.'
  return message || 'Playback failed before the browser could start the stream.'
}

export function eventStatusLabel(event: SportEvent): string {
  if (event.status === 'LIVE' || event.status === 'HALFTIME') return event.gameStatusDetail || (event.status === 'HALFTIME' ? 'Halftime' : 'Live now')
  if (event.status === 'FINISHED') return 'Final'
  if (event.status === 'CANCELED') return 'Canceled'
  if (event.status === 'DELAYED') return 'Delayed'
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(event.startTime))
}

export function sportBackdrop(sport: string): string {
  const value = sport.toLowerCase()
  if (value.includes('soccer')) return 'backdrop-soccer'
  if (value.includes('basket')) return 'backdrop-basketball'
  if (value.includes('base')) return 'backdrop-baseball'
  if (value.includes('hock')) return 'backdrop-hockey'
  return 'backdrop-football'
}
