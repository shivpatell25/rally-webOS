import { asRecord, isRecord, normalizeMatchText, stringValue } from '../domain'
import type { IptvChannel, JsonRecord, ProviderIssue } from '../domain'


export function parseStalkerChannels(value: unknown): IptvChannel[] {
  const record = asRecord(value)
  const rawChannels = Array.isArray(value)
    ? value
    : Array.isArray(record.data)
      ? record.data
      : isRecord(record.data)
        ? Object.values(record.data)
        : Object.values(record).filter((item) => isRecord(item) && (stringValue(item.id) || stringValue(item.ch_id)))
  return rawChannels.map((raw) => {
    const channel = asRecord(raw)
    return {
      id: stringValue(channel.id) ?? stringValue(channel.ch_id) ?? '',
      number: stringValue(channel.number) ?? stringValue(channel.num) ?? stringValue(channel.id) ?? '',
      name: stringValue(channel.name) ?? 'Unnamed channel',
      category: stringValue(channel.tv_genre_id) ?? 'Live TV',
      logoUrl: stringValue(channel.logo),
      streamUrl: stringValue(channel.cmd),
    }
  }).filter((channel) => channel.id && channel.name)
}

export class StalkerBrowserClient {
  private authToken = ''

  constructor(private readonly portalUrl: string, private readonly macAddress: string) {}

  private endpoint(action: string, params: Record<string, string> = {}): string {
    const base = this.portalUrl.endsWith('/') ? this.portalUrl : `${this.portalUrl}/`
    const url = new URL('server/load.php', base)
    url.searchParams.set('type', 'stb')
    url.searchParams.set('action', action)
    url.searchParams.set('JsHttpRequest', '1-xml')
    if (this.macAddress) url.searchParams.set('mac', this.macAddress)
    if (action === 'handshake') {
      url.searchParams.set('token', '')
      url.searchParams.set('prehash', '0')
    }
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
    return url.toString()
  }

  private async request(action: string, params: Record<string, string> = {}): Promise<JsonRecord> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-User-Agent': 'Model MAG250; Link: WiFi',
      'User-Agent': 'Rally Web',
    }
    if (this.authToken) headers.Authorization = this.authToken
    const response = await fetch(this.endpoint(action, params), { credentials: 'include', headers })
    if (!response.ok) throw new Error(`Portal returned HTTP ${response.status}`)
    const payload: unknown = await response.json()
    return asRecord(payload)
  }

  async authenticate(): Promise<boolean> {
    try {
      const payload = await this.request('handshake')
      const js = asRecord(payload.js)
      const token = stringValue(js.token) ?? stringValue(js.random)
      if (!token) return false
      this.authToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`
      return true
    } catch {
      this.authToken = ''
      return false
    }
  }

  async getChannels(): Promise<{ channels: IptvChannel[]; issue?: ProviderIssue }> {
    if (!this.authToken && !(await this.authenticate())) {
      return { channels: [], issue: { provider: 'IPTV portal', message: 'Portal sign-in failed', detail: 'The browser could not complete the Stalker handshake. The portal may require CORS or provider-specific cookies.' } }
    }
    try {
      const payload = await this.request('get_all_channels')
      const channels = parseStalkerChannels(payload.js)
      return { channels }
    } catch (error) {
      return { channels: [], issue: { provider: 'IPTV portal', message: 'Channel catalog unavailable', detail: error instanceof Error ? error.message : undefined } }
    }
  }

  async resolveStream(channel: IptvChannel): Promise<string> {
    const direct = channel.streamUrl?.trim() ?? ''
    if (/^https?:\/\//i.test(direct) && !direct.includes('localhost')) return direct
    if (!this.authToken && !(await this.authenticate())) throw new Error('Portal session expired')
    const payload = await this.request('create_link', { cmd: direct || channel.id })
    const js = asRecord(payload.js)
    const raw = stringValue(js.cmd) ?? stringValue(payload.js)
    if (!raw) throw new Error('Portal did not return a playback URL')
    return raw.replace(/^(?:ffmpeg|ffrt|auto)\s+/i, '').trim()
  }

}

export function channelLooksLikeSport(channel: IptvChannel): boolean {
  const text = normalizeMatchText(`${channel.name} ${channel.category}`)
  return /sport|espn|fox|nbc|cbs|abc|nfl|nba|mlb|nhl|soccer|football|basket|baseball|hockey/.test(text)
}
