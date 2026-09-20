import { useEffect, useState } from 'react'
import type { DeviceCapabilities, SourceCandidate, ViewingPreferences } from '../domain'
import { Icon } from './Icon'
import { PlaybackSurface, type PlaybackStatus } from './PlaybackSurface'
import { setPlaybackScreenSaver } from '../webos'

interface MultiViewViewProps {
  candidates: SourceCandidate[]
  available: SourceCandidate[]
  capabilities: DeviceCapabilities
  preferences: ViewingPreferences
  onChange: (candidates: SourceCandidate[]) => void
  onFullScreen: (candidate: SourceCandidate, index: number) => void
  onBack: () => void
}

type MultiViewLayout = 'grid' | 'focus'
type PickerState = { mode: 'add' } | { mode: 'replace'; index: number }

export function MultiViewView({ candidates, available, capabilities, preferences, onChange, onFullScreen, onBack }: MultiViewViewProps) {
  const [audioIndex, setAudioIndex] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [immersive, setImmersive] = useState(false)
  const [layout, setLayout] = useState<MultiViewLayout>('grid')
  const [picker, setPicker] = useState<PickerState>()
  const [statuses, setStatuses] = useState<Record<string, PlaybackStatus>>({})
  const limit = Math.max(1, Math.min(4, capabilities.maxConcurrentStreams))
  const visible = candidates.slice(0, limit)
  const selectable = available.filter((candidate) => picker?.mode === 'replace' || !visible.some((slot) => slot.id === candidate.id))

  const commit = (next: SourceCandidate[]) => {
    onChange(next.slice(0, limit))
    setFocusedIndex((current) => Math.max(0, Math.min(current, next.length - 1)))
    setAudioIndex((current) => Math.max(0, Math.min(current, next.length - 1)))
  }
  const remove = (index: number) => commit(visible.filter((_, itemIndex) => itemIndex !== index))
  const swap = (from: number, to: number) => {
    if (to < 0 || to >= visible.length) return
    const next = [...visible]
    ;[next[from], next[to]] = [next[to], next[from]]
    commit(next)
    setFocusedIndex(to)
    if (audioIndex === from) setAudioIndex(to)
    else if (audioIndex === to) setAudioIndex(from)
  }

  useEffect(() => {
    const isPlaying = Object.values(statuses).some((status) => status === 'playing')
    if (isPlaying) {
      return setPlaybackScreenSaver(false)
    }
    const timer = window.setTimeout(() => setPlaybackScreenSaver(true), 120_000)
    return () => {
      window.clearTimeout(timer)
      setPlaybackScreenSaver(false)
    }
  }, [statuses])
  const promote = (index: number) => {
    if (index > 0) swap(index, 0)
    setFocusedIndex(0)
    setLayout('focus')
  }
  const choose = (candidate: SourceCandidate) => {
    if (!picker || picker.mode === 'add') commit([...visible, candidate])
    else {
      const next = [...visible]
      next[picker.index] = candidate
      commit(next)
    }
    setPicker(undefined)
  }
  const selected = visible[focusedIndex]

  return <div className={`multiview-page layout-${layout} ${immersive ? 'is-immersive' : ''}`}>
    <header><div><span className="panel-label">RALLY MULTI-VIEW</span><h2>{visible.length} of {limit} streams</h2><small>{limit < 4 ? `This TV is limited to ${limit} simultaneous decoders.` : 'Four-stream mode available.'}</small></div><div data-focus-row><button className={`button ${layout === 'grid' ? 'button-primary' : 'button-quiet'}`} onClick={() => setLayout('grid')}>Grid</button><button className={`button ${layout === 'focus' ? 'button-primary' : 'button-quiet'}`} onClick={() => setLayout('focus')} disabled={visible.length < 2}>Focus</button><button className="button button-quiet" onClick={() => setImmersive(!immersive)}>{immersive ? 'Show controls' : 'Immersive'}</button><button className="button button-primary" onClick={onBack}>Done</button></div></header>
    {visible.length ? <div className={`multiview-grid slots-${visible.length}`} data-focus-grid data-focus-columns={visible.length === 1 ? '1' : '2'}>{visible.map((candidate, index) => <article className={`${audioIndex === index ? 'has-audio' : ''} ${focusedIndex === index ? 'is-focused' : ''} ${layout === 'focus' && index === 0 ? 'is-primary' : ''}`} key={`${candidate.id}:${index}`}><button className="multiview-video-button" onFocus={() => setFocusedIndex(index)} onClick={() => { setFocusedIndex(index); setAudioIndex(index) }} aria-label={`Select ${candidate.title} audio`}><PlaybackSurface candidate={candidate} preferences={preferences} muted={audioIndex !== index} onStatus={(status) => setStatuses((current) => ({ ...current, [candidate.id]: status }))} /><span className="multiview-status">{statuses[candidate.id] ?? 'loading'}</span></button><div><strong>{candidate.title}</strong><span>{audioIndex === index ? 'AUDIO' : 'MUTED'}</span><button className="icon-button" onClick={() => setAudioIndex(index)} aria-label={`Use ${candidate.title} audio`}><Icon name="play" size={14} /></button><button className="icon-button" onClick={() => onFullScreen(candidate, index)} aria-label={`Open ${candidate.title} full screen`}>↗</button></div></article>)}</div> : <div className="multiview-empty"><h2>Build your Multi-View</h2><p>Add up to {limit} discovered streams supported by this TV.</p><button className="button button-primary" onClick={() => setPicker({ mode: 'add' })}>Choose a stream</button></div>}
    {!immersive && selected && <nav className="multiview-actions" data-focus-row><button className="button button-quiet" onClick={() => swap(focusedIndex, focusedIndex - 1)} disabled={focusedIndex === 0}>Move left</button><button className="button button-quiet" onClick={() => swap(focusedIndex, focusedIndex + 1)} disabled={focusedIndex === visible.length - 1}>Move right</button><button className="button button-quiet" onClick={() => promote(focusedIndex)}>Promote</button><button className="button button-quiet" onClick={() => setAudioIndex(focusedIndex)}>{audioIndex === focusedIndex ? 'Audio active' : 'Use audio'}</button><button className="button button-quiet" onClick={() => setPicker({ mode: 'replace', index: focusedIndex })}>Replace</button><button className="button button-quiet" onClick={() => remove(focusedIndex)}>Remove</button><button className="button button-primary" onClick={() => onFullScreen(selected, focusedIndex)}>Full screen</button>{visible.length < limit && <button className="button button-primary" onClick={() => setPicker({ mode: 'add' })}>Add stream</button>}</nav>}
    {picker && <aside className="multiview-picker" data-focus-scope="modal"><header><span className="panel-label">{picker.mode === 'add' ? 'ADD A STREAM' : 'REPLACE STREAM'}</span><button className="icon-button" onClick={() => setPicker(undefined)}>×</button></header>{selectable.length ? <div data-focus-column>{selectable.slice(0, 12).map((candidate) => <button className="source-picker-row" key={candidate.id} onClick={() => choose(candidate)}><span><strong>{candidate.title}</strong><small>{candidate.matchEvidence}</small></span><b>{candidate.quality.resolution ?? candidate.sourceKind}</b></button>)}</div> : <p>Open another event and discover its sources first.</p>}</aside>}
  </div>
}
