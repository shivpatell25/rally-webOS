import { channelLooksLikeSport, StalkerBrowserClient } from './stalker'
import { discoverStremioSources } from './stremio'
import { matchChannelToEvent, rankStreamCandidates, validateProviderConfig } from '../domain'
import type { ProviderConfig, ProviderIssue, SourceCandidate, SportEvent } from '../domain'

export async function discoverSources(event: SportEvent, input: ProviderConfig, signal?: AbortSignal): Promise<{ candidates: SourceCandidate[]; issues: ProviderIssue[] }> {
  const validation = validateProviderConfig(input)
  if (validation.errors.length) {
    return { candidates: [], issues: validation.errors.map((message) => ({ provider: 'Configuration', message })) }
  }
  const issues: ProviderIssue[] = validation.warnings.map((message) => ({ provider: 'Configuration', message }))
  const tasks: Array<Promise<{ candidates: SourceCandidate[]; issues: ProviderIssue[] }>> = []

  if (validation.config.portalUrl) {
    tasks.push((async () => {
      const client = new StalkerBrowserClient(validation.config)
      const result = await client.getChannels()
      if (result.issue) return { candidates: [], issues: [result.issue] }
      const candidates = result.channels.filter(channelLooksLikeSport).map((channel) => matchChannelToEvent(channel, event)).filter((candidate): candidate is SourceCandidate => Boolean(candidate))
      return { candidates, issues: [] }
    })())
  }

  if (validation.config.addonUrls.length) {
    tasks.push((async () => {
      const result = await discoverStremioSources(validation.config.addonUrls, event, signal)
      return { candidates: result.candidates, issues: result.issues }
    })())
  }

  const results = await Promise.all(tasks)
  return {
    candidates: rankStreamCandidates(results.flatMap((result) => result.candidates)),
    issues: [...issues, ...results.flatMap((result) => result.issues)],
  }
}
type BrowserProbe = { response: Response; method: 'GET' | 'HEAD' }

async function probeRequest(url: string, method: 'GET' | 'HEAD', headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 4_000)
  try {
    return await fetch(url, {
      method,
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
      headers,
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function probeBrowserSource(url: string, headers?: Record<string, string>): Promise<BrowserProbe> {
  let lastError: unknown
  for (const method of ['GET', 'HEAD'] as const) {
    try {
      const response = await probeRequest(url, method, headers)
      if (method === 'GET' && response.body) {
        try {
          await response.body.cancel()
        } catch {
          // The response headers are sufficient for this lightweight probe.
        }
      }
      if (method === 'GET' && (response.status === 405 || response.status === 501)) continue
      return { response, method }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Browser access probe failed.')
}

export async function checkBrowserSource(candidate: SourceCandidate): Promise<SourceCandidate> {
  if (candidate.requiresProviderResolution) return { ...candidate, browserStatus: 'unknown', browserStatusDetail: 'The portal must resolve this channel before the browser can test it.' }
  if (!/^https?:\/\//i.test(candidate.playbackTarget)) return { ...candidate, browserStatus: 'unsupported', browserStatusDetail: 'The source is not an HTTP media URL.' }
  if (candidate.playbackTarget.startsWith('http://') && window.location.protocol === 'https:') return { ...candidate, browserStatus: 'blocked', browserStatusDetail: 'HTTP media is blocked inside this HTTPS app.' }
  try {
    const probe = await probeBrowserSource(candidate.playbackTarget, candidate.headers)
    if (!probe.response.ok) return { ...candidate, browserStatus: 'blocked', browserStatusDetail: `The source returned HTTP ${probe.response.status}.` }
    if (probe.method === 'HEAD') return { ...candidate, browserStatus: 'unknown', browserStatusDetail: 'The provider only answered a metadata probe. Try playback to verify media access.' }
    return { ...candidate, browserStatus: 'ready', browserStatusDetail: probe.response.headers.get('content-type') ?? 'Browser media probe allowed.' }
  } catch (error) {
    return { ...candidate, browserStatus: 'blocked', browserStatusDetail: error instanceof Error ? 'The browser could not access this URL (often CORS or provider policy).' : 'Browser access failed.' }
  }
}
