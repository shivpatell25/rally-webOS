import { asRecord, isRecord, normalizeMatchText, stringValue } from '../domain'
import type { ChannelGuide, IptvChannel, JsonRecord, ProviderConfig, ProviderDiagnostic, ProviderIssue } from '../domain'
import { providerFetchJson } from './network'

const CHANNEL_CACHE_KEY = 'rally-web-stalker-channels-v2'
const CHANNEL_TTL_MS = 15 * 60 * 1000
const GUIDE_TTL_MS = 2 * 60 * 1000
const sessions = new Map<string, string>()

interface ChannelCache {
  identity: string
  fetchedAt: number
  channels: IptvChannel[]
}

interface GuideCacheEntry {
  fetchedAt: number
  guide: ChannelGuide
}

function rawList(value: unknown): unknown[] {
  const record = asRecord(value)
  if (Array.isArray(value)) return value
  if (Array.isArray(record.data)) return record.data
  if (isRecord(record.data)) return Object.values(record.data)
  return Object.values(record).filter((item) => isRecord(item))
}

export function parseStalkerChannels(value: unknown, genres: Record<string, string> = {}): IptvChannel[] {
  return rawList(value).map((raw) => {
    const channel = asRecord(raw)
    const categoryId = stringValue(channel.tv_genre_id) ?? 'Live TV'
    return {
      id: stringValue(channel.id) ?? stringValue(channel.ch_id) ?? '',
      number: stringValue(channel.number) ?? stringValue(channel.num) ?? stringValue(channel.id) ?? '',
      name: stringValue(channel.name) ?? 'Unnamed channel',
      category: genres[categoryId] ?? categoryId,
      logoUrl: stringValue(channel.logo),
      streamUrl: stringValue(channel.cmd),
    }
  }).filter((channel) => channel.id && channel.name)
}

function portalCandidates(value: string): string[] {
  const cleaned = value.trim().replace(/\/+$/, '').replace(/\/(?:server\/)?load\.php$/i, '')
  const base = cleaned.replace(/\/(?:c|stalker_portal(?:\/c)?)$/i, '')
  return Array.from(new Set([cleaned, `${base}/c`, `${base}/stalker_portal`, `${base}/stalker_portal/c`]))
}

function collectGuideEntries(value: unknown, entries: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectGuideEntries(item, entries))
    return entries
  }
  if (!isRecord(value)) return entries
  const nested = ['data', 'epg', 'programs', 'items'].map((key) => value[key]).find((item) => item !== undefined && item !== null)
  if (nested !== undefined) collectGuideEntries(nested, entries)
  else entries.push(value)
  return entries
}

function timestamp(value?: string): string | undefined {
  if (!value) return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function parseChannelGuide(value: unknown): ChannelGuide | undefined {
  const programs = collectGuideEntries(value).map((item) => ({
    title: stringValue(item.name) ?? stringValue(item.title) ?? stringValue(item.program) ?? stringValue(item.programme) ?? '',
    description: stringValue(item.descr) ?? stringValue(item.description) ?? stringValue(item.desc),
    startTime: timestamp(stringValue(item.start_timestamp) ?? stringValue(item.start) ?? stringValue(item.begin) ?? stringValue(item.time)),
    endTime: timestamp(stringValue(item.stop_timestamp) ?? stringValue(item.end_timestamp) ?? stringValue(item.end) ?? stringValue(item.stop)),
  })).filter((program) => program.title).sort((a, b) => Date.parse(a.startTime ?? '') - Date.parse(b.startTime ?? ''))
  if (!programs.length) return undefined
  const now = Date.now()
  const currentIndex = Math.max(0, programs.findIndex((program) => {
    const start = Date.parse(program.startTime ?? '')
    const end = Date.parse(program.endTime ?? '')
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end
  }))
  return { now: programs[currentIndex], next: programs[currentIndex + 1] }
}

export class StalkerBrowserClient {
  private authToken = ''
  private currentPortal: string
  private readonly diagnostics: ProviderDiagnostic[] = []
  private readonly guideCache = new Map<string, GuideCacheEntry>()

  constructor(private readonly config: ProviderConfig) {
    this.currentPortal = config.portalUrl
    this.authToken = sessions.get(this.identity()) ?? ''
  }

  private identity(): string {
    return `${this.currentPortal.toLowerCase()}|${this.config.macAddress.toUpperCase()}|${this.config.serialNumber ?? ''}|${this.config.deviceId ?? ''}`
  }

  private endpoint(type: 'stb' | 'itv', action: string, params: Record<string, string> = {}): string {
    const base = this.currentPortal.endsWith('/') ? this.currentPortal : `${this.currentPortal}/`
    const url = new URL('server/load.php', base)
    url.searchParams.set('type', type)
    url.searchParams.set('action', action)
    url.searchParams.set('JsHttpRequest', '1-xml')
    if (this.config.serialNumber) url.searchParams.set('sn', this.config.serialNumber)
    if (this.config.deviceId) {
      url.searchParams.set('device_id', this.config.deviceId)
      url.searchParams.set('device_id2', this.config.deviceId)
    }
    if (action === 'handshake') {
      url.searchParams.set('token', '')
      url.searchParams.set('prehash', '0')
    }
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
    return url.toString()
  }

  private async request(type: 'stb' | 'itv', action: string, params: Record<string, string> = {}): Promise<JsonRecord> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-User-Agent': `Model: MAG250; Link: Ethernet${this.config.serialNumber ? `; SerialNumber: ${this.config.serialNumber}` : ''}`,
      Cookie: `mac=${encodeURIComponent(this.config.macAddress)}; stb_lang=en; timezone=UTC`,
    }
    if (this.authToken) headers.Authorization = this.authToken
    return providerFetchJson<JsonRecord>(this.endpoint(type, action, params), { headers })
  }

  async authenticate(force = false): Promise<boolean> {
    if (!force && this.authToken) return true
    for (const candidate of portalCandidates(this.currentPortal)) {
      const startedAt = performance.now()
      this.currentPortal = candidate
      this.authToken = ''
      try {
        const payload = await this.request('stb', 'handshake')
        const js = asRecord(payload.js)
        const token = stringValue(js.token) ?? stringValue(js.random) ?? stringValue(payload.js)
        if (!token) continue
        this.authToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`
        const profile = await this.request('stb', 'get_profile')
        const status = stringValue(asRecord(profile.js).status)?.toLowerCase()
        if (status === '1' || status === '2' || status === 'error' || status === 'failed') continue
        sessions.set(this.identity(), this.authToken)
        this.diagnostics.push({ label: 'Stalker session', status: 'ready', detail: 'Handshake and profile accepted.', latencyMs: Math.round(performance.now() - startedAt) })
        return true
      } catch (error) {
        this.diagnostics.push({ label: 'Stalker session', status: 'warning', detail: error instanceof Error ? error.message : 'Handshake failed.', latencyMs: Math.round(performance.now() - startedAt) })
      }
    }
    this.authToken = ''
    this.diagnostics.push({ label: 'Stalker session', status: 'error', detail: 'Every supported portal path rejected the session.' })
    return false
  }

  private readCache(): IptvChannel[] | undefined {
    try {
      const cache = JSON.parse(localStorage.getItem(CHANNEL_CACHE_KEY) ?? 'null') as ChannelCache | null
      if (cache?.identity === this.identity() && Date.now() - cache.fetchedAt < CHANNEL_TTL_MS && cache.channels.length) return cache.channels
    } catch {
      localStorage.removeItem(CHANNEL_CACHE_KEY)
    }
    return undefined
  }

  private writeCache(channels: IptvChannel[]): void {
    const cache: ChannelCache = { identity: this.identity(), fetchedAt: Date.now(), channels }
    localStorage.setItem(CHANNEL_CACHE_KEY, JSON.stringify(cache))
  }

  private async genres(): Promise<Record<string, string>> {
    try {
      const payload = await this.request('itv', 'get_genres')
      return Object.fromEntries(rawList(payload.js).map((raw) => asRecord(raw)).map((item) => [stringValue(item.id) ?? '', stringValue(item.title) ?? '']).filter(([id, title]) => id && id !== '*' && title))
    } catch {
      return {}
    }
  }

  async getChannels(force = false): Promise<{ channels: IptvChannel[]; issue?: ProviderIssue }> {
    const cached = !force ? this.readCache() : undefined
    if (cached) return { channels: cached }
    if (!(await this.authenticate(force))) return { channels: [], issue: { provider: 'IPTV portal', message: 'Portal sign-in failed', detail: 'The Stalker handshake or profile activation was rejected.' } }
    const startedAt = performance.now()
    try {
      const [genreMap, payload] = await Promise.all([this.genres(), this.request('itv', 'get_all_channels')])
      let channels = parseStalkerChannels(payload.js, genreMap)
      if (!channels.length) {
        const first = await this.request('itv', 'get_ordered_list', { p: '1' })
        channels = parseStalkerChannels(first.js, genreMap)
      }
      if (!channels.length && !force && await this.authenticate(true)) return this.getChannels(true)
      channels = Array.from(new Map(channels.map((channel) => [channel.id, channel])).values())
      this.writeCache(channels)
      this.diagnostics.push({ label: 'Channel catalog', status: channels.length ? 'ready' : 'warning', detail: `${channels.length} channels loaded.`, latencyMs: Math.round(performance.now() - startedAt) })
      return { channels }
    } catch (error) {
      const fallback = this.readCache() ?? []
      return { channels: fallback, issue: { provider: 'IPTV portal', message: 'Channel catalog unavailable', detail: error instanceof Error ? error.message : undefined } }
    }
  }

  async searchChannels(query: string, limit = 24): Promise<IptvChannel[]> {
    const normalized = normalizeMatchText(query)
    if (!normalized) return []
    const result = await this.getChannels()
    return result.channels.filter((channel) => normalizeMatchText(`${channel.number} ${channel.name} ${channel.category}`).includes(normalized)).slice(0, limit)
  }

  async getChannelGuide(channelId: string): Promise<ChannelGuide | undefined> {
    const cached = this.guideCache.get(channelId)
    if (cached && Date.now() - cached.fetchedAt < GUIDE_TTL_MS) return cached.guide
    if (!this.authToken && !(await this.authenticate())) return cached?.guide
    try {
      const payload = await this.request('itv', 'get_short_epg', { ch_id: channelId, size: '4' })
      const guide = parseChannelGuide(payload.js)
      if (guide) this.guideCache.set(channelId, { fetchedAt: Date.now(), guide })
      return guide ?? cached?.guide
    } catch {
      return cached?.guide
    }
  }

  async resolveStream(channel: IptvChannel): Promise<string> {
    const direct = channel.streamUrl?.trim() ?? ''
    if (/^https?:\/\//i.test(direct) && !direct.includes('localhost')) return direct
    if (!this.authToken && !(await this.authenticate())) throw new Error('Portal session expired')
    try {
      const payload = await this.request('itv', 'create_link', { cmd: direct || channel.id })
      const raw = stringValue(asRecord(payload.js).cmd) ?? stringValue(payload.js)
      if (!raw) throw new Error('Portal did not return a playback URL')
      return raw.replace(/^(?:ffmpeg|ffrt|auto)\s+/i, '').trim()
    } catch (error) {
      if (await this.authenticate(true)) {
        const payload = await this.request('itv', 'create_link', { cmd: direct || channel.id })
        const raw = stringValue(asRecord(payload.js).cmd) ?? stringValue(payload.js)
        if (raw) return raw.replace(/^(?:ffmpeg|ffrt|auto)\s+/i, '').trim()
      }
      throw error
    }
  }

  getDiagnostics(): ProviderDiagnostic[] {
    return [...this.diagnostics]
  }
}

export function channelLooksLikeSport(channel: IptvChannel): boolean {
  const text = normalizeMatchText(`${channel.name} ${channel.category}`)
  return /sport|espn|fox|nbc|cbs|abc|nfl|nba|mlb|nhl|soccer|football|basket|baseball|hockey/.test(text)
}
