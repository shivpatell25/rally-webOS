import { asArray, asRecord, isRecord, normalizeMatchText, parseStremioStream, stremioToCandidate, textMatchesEvent } from '../domain'
import type { ProviderIssue, SourceCandidate, SportEvent, StremioManifest, StremioMeta, StremioStreamOption } from '../domain'
import { providerFetchJson } from './network'

interface StremioResponse {
  streams?: unknown[]
  metas?: unknown[]
}


async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    return await providerFetchJson<T>(url, { headers: { Accept: 'application/json' } }, controller.signal)
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function manifestUrl(addonUrl: string): string {
  return addonUrl.toLowerCase().endsWith('manifest.json') ? addonUrl : `${addonUrl.replace(/\/+$/, '')}/manifest.json`
}

function baseUrl(manifest: string): string {
  return manifest.slice(0, manifest.lastIndexOf('manifest.json'))
}
export function redactProviderUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of ['token', 'api_key', 'api-key', 'auth']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]')
    }
    return url.toString()
  } catch {
    return value.split('?')[0]
  }
}

function metaFrom(raw: unknown): StremioMeta | null {
  const value = asRecord(raw)
  const id = typeof value.id === 'string' ? value.id : ''
  if (!id) return null
  return {
    id,
    type: typeof value.type === 'string' ? value.type : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    poster: typeof value.poster === 'string' ? value.poster : undefined,
  }
}

function searchTerms(event: SportEvent): string[] {
  const teams = [event.homeTeam, event.awayTeam].filter((team): team is NonNullable<typeof team> => Boolean(team))
  const compactTerms = teams.flatMap((team) => {
    const firstName = team.name.split(/\s+/).find((word) => normalizeMatchText(word).length >= 3)
    return [firstName, team.abbreviation]
  })
  return Array.from(new Set([...compactTerms, ...teams.map((team) => team.name), event.name].filter((value): value is string => Boolean(value && value.trim())).map(normalizeMatchText).filter((value) => value.length > 2)))
}

function metaMatches(meta: StremioMeta, event: SportEvent): boolean {
  const text = normalizeMatchText(`${meta.name ?? ''} ${meta.description ?? ''}`)
  return textMatchesEvent(text, event)
}

async function discoverAddon(addonUrl: string, event: SportEvent, signal?: AbortSignal): Promise<{ streams: StremioStreamOption[]; issues: ProviderIssue[] }> {
  const issues: ProviderIssue[] = []
  const manifest = manifestUrl(addonUrl)
  try {
    const descriptor = await fetchJson<StremioManifest>(manifest, signal)
    const addonName = descriptor.name || 'Stremio addon'
    const catalogs = (descriptor.catalogs ?? []).filter((catalog) => catalog.id).slice(0, 4)
    const base = baseUrl(manifest)
    const metas: StremioMeta[] = []
    for (const catalog of catalogs) {
      const type = catalog.type || 'sport'
      const id = catalog.id || ''
      const urls = searchTerms(event).slice(0, 4).map((term) => `${base}catalog/${type}/${id}/search=${encodeURIComponent(term)}.json`)
      if (!urls.length) urls.push(`${base}catalog/${type}/${id}.json`)
      for (const url of urls) {
        try {
          const response = await fetchJson<StremioResponse>(url, signal)
          metas.push(...asArray(response.metas).map(metaFrom).filter((meta): meta is StremioMeta => Boolean(meta)).filter((meta) => metaMatches(meta, event)))
          if (metas.length >= 12) break
        } catch {
          // A catalog can fail while another catalog from the same addon remains usable.
        }
      }
      if (metas.length >= 12) break
    }
    const uniqueMetas = Array.from(new Map(metas.map((meta) => [meta.id, meta])).values()).slice(0, 8)
    const streams: StremioStreamOption[] = []
    for (const meta of uniqueMetas) {
      try {
        const response = await fetchJson<StremioResponse>(`${base}stream/${meta.type || 'sport'}/${encodeURIComponent(meta.id)}.json`, signal)
        for (const raw of asArray(response.streams)) {
          if (!isRecord(raw)) continue
          const parsed = parseStremioStream(raw, addonName)
          if (parsed) streams.push(parsed)
        }
      } catch {
        // Keep successful streams from the other matches.
      }
    }
    return { streams: Array.from(new Map(streams.map((stream) => [stream.streamUrl, stream])).values()), issues }
  } catch (error) {
    issues.push({ provider: redactProviderUrl(addonUrl), message: 'Addon manifest unavailable', detail: error instanceof Error ? error.message.split('https://')[0].trim() : undefined })
    return { streams: [], issues }
  }
}

export async function discoverStremioSources(addonUrls: string[], event: SportEvent, signal?: AbortSignal): Promise<{ candidates: SourceCandidate[]; streams: StremioStreamOption[]; issues: ProviderIssue[] }> {
  const results = await Promise.all(addonUrls.map((addonUrl) => discoverAddon(addonUrl, event, signal)))
  const streams = results.flatMap((result) => result.streams)
  const issues = results.flatMap((result) => result.issues)
  const candidates = streams.map((stream) => stremioToCandidate(stream, event))
  return { candidates, streams, issues }
}

export async function searchStremioStreams(addonUrls: string[], query: string, signal?: AbortSignal): Promise<{ streams: StremioStreamOption[]; issues: ProviderIssue[] }> {
  const normalized = query.trim()
  if (normalized.length < 3) return { streams: [], issues: [] }
  const results = await Promise.all(addonUrls.map(async (addonUrl) => {
    const manifest = manifestUrl(addonUrl)
    try {
      const descriptor = await fetchJson<StremioManifest>(manifest, signal)
      const base = baseUrl(manifest)
      const addonName = descriptor.name || 'Stremio addon'
      const metas: StremioMeta[] = []
      for (const catalog of (descriptor.catalogs ?? []).slice(0, 6)) {
        if (!catalog.id) continue
        try {
          const response = await fetchJson<StremioResponse>(`${base}catalog/${catalog.type || 'sport'}/${catalog.id}/search=${encodeURIComponent(normalized)}.json`, signal)
          metas.push(...asArray(response.metas).map(metaFrom).filter((meta): meta is StremioMeta => Boolean(meta)))
        } catch {
          // Continue through the addon's other catalogs.
        }
      }
      const streams: StremioStreamOption[] = []
      for (const meta of Array.from(new Map(metas.map((item) => [item.id, item])).values()).slice(0, 10)) {
        try {
          const response = await fetchJson<StremioResponse>(`${base}stream/${meta.type || 'sport'}/${encodeURIComponent(meta.id)}.json`, signal)
          for (const raw of asArray(response.streams)) {
            if (!isRecord(raw)) continue
            const parsed = parseStremioStream(raw, addonName)
            if (parsed) streams.push(parsed)
          }
        } catch {
          // Keep successful stream results.
        }
      }
      return { streams, issues: [] as ProviderIssue[] }
    } catch (error) {
      return { streams: [], issues: [{ provider: redactProviderUrl(addonUrl), message: 'Addon search unavailable', detail: error instanceof Error ? error.message : undefined }] }
    }
  }))
  return {
    streams: Array.from(new Map(results.flatMap((result) => result.streams).map((stream) => [stream.streamUrl, stream])).values()).slice(0, 20),
    issues: results.flatMap((result) => result.issues),
  }
}
