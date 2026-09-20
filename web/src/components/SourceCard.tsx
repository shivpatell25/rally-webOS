import type { SourceCandidate } from '../domain'
import { Icon } from './Icon'

interface SourceCardProps {
  candidate: SourceCandidate
  onPlay: () => void
  onCheck: () => void
}

function statusLabel(candidate: SourceCandidate): string {
  if (candidate.browserStatus === 'ready') return 'Browser ready'
  if (candidate.browserStatus === 'checking') return 'Checking browser access'
  if (candidate.browserStatus === 'blocked') return 'Browser access blocked'
  if (candidate.browserStatus === 'unsupported') return 'Not browser playable'
  if (candidate.requiresProviderResolution) return 'Portal resolution required'
  return 'Not checked'
}

export function SourceCard({ candidate, onPlay, onCheck }: SourceCardProps) {
  const canAttempt = candidate.browserStatus !== 'unsupported'
  const quality = [candidate.quality.resolution, candidate.quality.fps, candidate.quality.isHdr ? 'HDR' : undefined].filter(Boolean).join(' · ') || 'Quality unknown'
  return (
    <article className={`source-card source-${candidate.sourceKind.toLowerCase()} source-status-${candidate.browserStatus}`}>
      <div className="source-card-heading">
        <div>
          <span className="source-kind">{candidate.sourceKind === 'IPTV' ? 'IPTV' : 'STREMIO'}</span>
          <h3>{candidate.title}</h3>
        </div>
        <span className={`status-chip status-${candidate.browserStatus}`}><span className="status-chip-dot" />{statusLabel(candidate)}</span>
      </div>
      <div className="source-card-meta"><span>{quality}</span><span>{Math.round(candidate.matchConfidence * 100)}% match</span><span>{candidate.matchEvidence}</span></div>
      {candidate.browserStatusDetail && <p className="source-card-detail">{candidate.browserStatusDetail}</p>}
      <div className="source-card-actions">
        <button className="button button-primary button-small" onClick={onPlay} disabled={!canAttempt}><Icon name="play" size={14} />{candidate.browserStatus === 'blocked' ? 'Try anyway' : 'Play source'}</button>
        {!candidate.requiresProviderResolution && candidate.browserStatus === 'unknown' && <button className="button button-quiet button-small" onClick={onCheck}><Icon name="shield" size={14} />Check access</button>}
      </div>
    </article>
  )
}
