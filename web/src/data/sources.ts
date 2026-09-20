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
      const client = new StalkerBrowserClient(validation.config.portalUrl, validation.config.macAddress)
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

export async function checkBrowserSource(candidate: SourceCandidate): Promise<SourceCandidate> {
  if (candidate.requiresProviderResolution) return { ...candidate, browserStatus: 'unknown', browserStatusDetail: 'The portal must resolve this channel before the browser can test it.' }
  if (!/^https?:\/\//i.test(candidate.playbackTarget)) return { ...candidate, browserStatus: 'unsupported', browserStatusDetail: 'The source is not an HTTP media URL.' }
  if (candidate.playbackTarget.startsWith('http://') && window.location.protocol === 'https:') {
    return { ...candidate, browserStatus: 'blocked', browserStatusDetail: 'HTTP media is blocked inside this HTTPS app.' }
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 4_000)
  try {
    const response = await fetch(candidate.playbackTarget, {
      method: 'HEAD',
      mode: 'cors',
      signal: controller.signal,
      headers: candidate.headers,
    })
    if (!response.ok) return { ...candidate, browserStatus: 'blocked', browserStatusDetail: `The source returned HTTP ${response.status}.` }
    return { ...candidate, browserStatus: 'ready', browserStatusDetail: response.headers.get('content-type') ?? 'Browser access allowed.' }
  } catch (error) {
    return { ...candidate, browserStatus: 'blocked', browserStatusDetail: error instanceof Error ? 'The browser could not access this URL (often CORS or provider policy).' : 'Browser access failed.' }
  } finally {
    window.clearTimeout(timeout)
  }
}
