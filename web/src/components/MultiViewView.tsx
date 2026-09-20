import { useState } from 'react'
import type { SourceCandidate } from '../domain'
import { Icon } from './Icon'

interface MultiViewViewProps {
  candidates: SourceCandidate[]
  available: SourceCandidate[]
  onChange: (candidates: SourceCandidate[]) => void
  onBack: () => void
}

export function MultiViewView({ candidates, available, onChange, onBack }: MultiViewViewProps) {
  const [audioIndex, setAudioIndex] = useState(0)
  const [immersive, setImmersive] = useState(false)
  const addable = available.filter((candidate) => !candidates.some((slot) => slot.id === candidate.id))
  return <div className={`multiview-page ${immersive ? 'is-immersive' : ''}`}><header><div><span className="panel-label">RALLY MULTI-VIEW</span><h2>{candidates.length} of 4 streams</h2></div><div><button className="button button-quiet" onClick={() => setImmersive(!immersive)}>{immersive ? 'Show controls' : 'Immersive'}</button><button className="button button-primary" onClick={onBack}>Done</button></div></header><div className={`multiview-grid slots-${candidates.length}`}>{candidates.map((candidate, index) => <article className={audioIndex === index ? 'has-audio' : ''} key={candidate.id}><video src={candidate.playbackTarget} autoPlay muted={audioIndex !== index} controls /><div><strong>{candidate.title}</strong><button className="button button-small button-quiet" onClick={() => setAudioIndex(index)}>{audioIndex === index ? 'Audio active' : 'Use audio'}</button><button className="icon-button" onClick={() => onChange(candidates.filter((_, slotIndex) => slotIndex !== index))} aria-label={`Remove ${candidate.title}`}><Icon name="close" size={14} /></button></div></article>)}</div>{!immersive && candidates.length < 4 && <aside className="multiview-picker"><span className="panel-label">ADD A STREAM</span>{addable.length ? addable.map((candidate) => <button key={candidate.id} className="button button-quiet" onClick={() => onChange([...candidates, candidate].slice(0, 4))}>{candidate.title}</button>) : <p>Discover sources from another event, then return to Multi-View.</p>}</aside>}</div>
}
