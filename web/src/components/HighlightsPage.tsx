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
    const candidates = events.filter((event) => event.status === 'FINISHED' || event.status === 'LIVE').slice(0, 12)
    void Promise.all(candidates.map((event) => loadEventSummary(event))).then((result) => {
      if (active) { setSummaries(result); setLoaded(true) }
    })
    return () => { active = false }
  }, [events])
  const clips = summaries.flatMap((event) => (event.highlightClips ?? []).map((clip) => ({ event, clip })))
  if (!loaded && events.length) return <LoadingState label="Loading the biggest moments" />
  return <div className="directory-page"><div className="directory-intro"><span>HIGHLIGHTS</span><h2>The biggest moments, right now.</h2><p>Event-linked clips from supported leagues.</p></div>{clips.length ? <div className="highlight-grid">{clips.map(({ event, clip }) => <button key={clip.id} className="highlight-card" onClick={() => { const quality = parseQualityFromText(clip.title); onPlay({ id: `highlight:${clip.id}`, sourceKind: 'STREMIO', title: clip.title, playbackTarget: clip.playbackUrl, quality, qualityRank: qualityRank(quality), exactGameMatch: true, matchConfidence: 1, matchEvidence: event.name, browserStatus: 'unknown' }) }} style={clip.thumbnailUrl ? { backgroundImage: `linear-gradient(rgba(5,8,15,.18),rgba(5,8,15,.94)),url(${clip.thumbnailUrl})` } : undefined}><span>{event.league}</span><strong>{clip.title}</strong><small>{event.name}</small></button>)}</div> : <EmptyState title="No league clips have been published yet" body="This page fills automatically as supported leagues release highlights." />}</div>
}
