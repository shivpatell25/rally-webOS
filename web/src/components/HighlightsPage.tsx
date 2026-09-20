import { useEffect, useState } from 'react'
import { loadEventSummary } from '../data'
import { parseQualityFromText, qualityRank } from '../domain'
import type { SourceCandidate, SportEvent } from '../domain'
import { EmptyState, LoadingState } from './States'

export function HighlightsPage({ events, onPlay }: { events: SportEvent[]; onPlay: (candidate: SourceCandidate) => void }) {
  const [loaded, setLoaded] = useState(false)
  const [summaries, setSummaries] = useState<SportEvent[]>([])
  useEffect(() => {
    let active = true
    const candidates = [...events].sort((a, b) => {
      const rank = (event: SportEvent) => event.status === 'LIVE' || event.status === 'HALFTIME' ? 0 : event.status === 'FINISHED' ? 1 : 2
      return rank(a) - rank(b) || Date.parse(b.startTime) - Date.parse(a.startTime)
    }).slice(0, 18)
    const result = new Array<SportEvent>(candidates.length)
    const workers = Array.from({ length: Math.min(3, candidates.length) }, async (_, worker) => {
      for (let index = worker; index < candidates.length; index += 3) result[index] = await loadEventSummary(candidates[index])
    })
    void Promise.all(workers).then(() => {
      if (active) { setSummaries(result.filter(Boolean)); setLoaded(true) }
    })
    return () => { active = false }
  }, [events])
  const clips = summaries.flatMap((event) => (event.highlightClips ?? []).map((clip) => ({ event, clip })))
  if (!loaded && events.length) return <LoadingState label="Loading the biggest moments" />
  return <div className="directory-page"><div className="directory-intro"><span>HIGHLIGHTS</span><h2>The biggest moments, right now.</h2><p>Event-linked clips from supported leagues.</p></div>{clips.length ? <div className="highlight-grid" data-focus-row data-focus-paging="true" data-focus-page-size="5">{clips.map(({ event, clip }) => <button key={clip.id} className="highlight-card" onClick={() => { const quality = parseQualityFromText(clip.title); onPlay({ id: `highlight:${clip.id}`, sourceKind: 'STREMIO', title: clip.title, playbackTarget: clip.playbackUrl, quality, qualityRank: qualityRank(quality), exactGameMatch: true, matchConfidence: 1, matchEvidence: event.name, browserStatus: 'unknown' }) }} style={clip.thumbnailUrl ? { backgroundImage: `linear-gradient(rgba(5,8,15,.18),rgba(5,8,15,.94)),url(${clip.thumbnailUrl})` } : undefined}><span>{event.league}</span><strong>{clip.title}</strong><small>{event.name}</small></button>)}</div> : <EmptyState title="No highlights are available" body="Rally only shows official event-linked clips returned by the public sports feeds." />}</div>
}
