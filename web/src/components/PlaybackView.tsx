import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaybackMetrics, SourceCandidate, SportEvent, ViewingPreferences } from '../domain'
import { eventStatusLabel, parseQualityFromText, qualityRank, selectRecoveryCandidate } from '../domain'
import { Icon } from './Icon'
import { PlaybackSurface, type PlaybackStatus, type PlaybackSurfaceHandle } from './PlaybackSurface'
import { setPlaybackScreenSaver } from '../webos'

interface PlaybackViewProps {
  candidate: SourceCandidate
  preferences: ViewingPreferences
  event?: SportEvent
  alternatives: SourceCandidate[]
  onSelect: (candidate: SourceCandidate) => void
  onBack: () => void
  onMultiView?: () => void
}

type GameViewTab = 'Summary' | 'Leaders' | 'Plays'

export function PlaybackView({ candidate, preferences, event, alternatives, onSelect, onBack, onMultiView }: PlaybackViewProps) {
  const player = useRef<PlaybackSurfaceHandle>(null)
  const [status, setStatus] = useState<PlaybackStatus>('loading')
  const [statusDetail, setStatusDetail] = useState<string>()
  const [metrics, setMetrics] = useState<PlaybackMetrics>({ bufferedSeconds: 0, recoveryAttempt: 0 })
  const [controlsVisible, setControlsVisible] = useState(true)
  const [sourcePicker, setSourcePicker] = useState(false)
  const [gameView, setGameView] = useState(false)
  const [gameViewTab, setGameViewTab] = useState<GameViewTab>('Summary')

  const handleStatus = useCallback((next: PlaybackStatus, detail?: string) => {
    setStatus(next)
    setStatusDetail(detail)
    if (next !== 'playing') setControlsVisible(true)
  }, [])
  const handleMetrics = useCallback((next: PlaybackMetrics) => setMetrics(next), [])
  const handleFatal = useCallback(() => {
    const fallback = selectRecoveryCandidate(alternatives, candidate.id)
    if (fallback) window.setTimeout(() => onSelect(fallback), 1200)
  }, [alternatives, candidate.id, onSelect])
  const closeOrBack = useCallback(() => {
    if (sourcePicker) setSourcePicker(false)
    else if (gameView) setGameView(false)
    else onBack()
  }, [sourcePicker, gameView, onBack])
  useEffect(() => {
    if (!sourcePicker && !gameView) return
    window.addEventListener('rally:close-overlay', closeOrBack)
    return () => window.removeEventListener('rally:close-overlay', closeOrBack)
  }, [sourcePicker, gameView, closeOrBack])

  useEffect(() => {
    if (!controlsVisible || status !== 'playing' || sourcePicker || gameView) return
    const timer = window.setTimeout(() => setControlsVisible(false), 5000)
    return () => window.clearTimeout(timer)
  }, [controlsVisible, gameView, sourcePicker, status])

  useEffect(() => {
    if (status === 'playing') {
      return setPlaybackScreenSaver(false)
    }
    const timer = window.setTimeout(() => setPlaybackScreenSaver(true), 120_000)
    return () => {
      window.clearTimeout(timer)
      setPlaybackScreenSaver(false)
    }
  }, [status])

  useEffect(() => {
    const reveal = () => setControlsVisible(true)
    window.addEventListener('keydown', reveal, true)
    return () => window.removeEventListener('keydown', reveal, true)
  }, [])

  useEffect(() => {
    if (!preferences.spokenScores || !event || !('speechSynthesis' in window)) return
    const teams = `${event.awayTeam?.name ?? 'Away'} ${event.scoreAway ?? ''}, ${event.homeTeam?.name ?? 'Home'} ${event.scoreHome ?? ''}`
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${eventStatusLabel(event)}. ${teams}`))
    return () => window.speechSynthesis.cancel()
  }, [event, preferences.spokenScores])

  const openHighlight = (clip: NonNullable<SportEvent['highlightClips']>[number]) => {
    const quality = parseQualityFromText(clip.title)
    onSelect({ id: `highlight:${clip.id}`, sourceKind: 'STREMIO', title: clip.title, playbackTarget: clip.playbackUrl, quality, qualityRank: qualityRank(quality), exactGameMatch: true, matchConfidence: 1, matchEvidence: event?.name ?? 'Current highlight', browserStatus: 'unknown' })
  }

  return <div className={`playback-page ${preferences.scoreSaver ? 'score-saver-enabled' : ''}`} onMouseMove={() => setControlsVisible(true)}>
    <PlaybackSurface ref={player} candidate={candidate} preferences={preferences} onStatus={handleStatus} onMetrics={handleMetrics} onFatal={handleFatal} />
    {event && <div className={`player-score-bug ${preferences.scoreSaver ? 'is-shifting' : ''}`}><span>{event.awayTeam?.abbreviation ?? 'AWAY'}</span><strong>{event.scoreAway ?? '–'}</strong><i>·</i><strong>{event.scoreHome ?? '–'}</strong><span>{event.homeTeam?.abbreviation ?? 'HOME'}</span><small>{eventStatusLabel(event)}</small></div>}
    <div className={`player-chrome ${controlsVisible ? 'is-visible' : ''}`} data-focus-scope={sourcePicker ? 'modal' : undefined}>
      <header className="playback-header"><button className="button button-quiet" onClick={closeOrBack}><Icon name="back" size={16} />Back</button><div><strong>{event?.name ?? candidate.title}</strong><span>{candidate.sourceKind} · {candidate.title}</span></div></header>
      <div className="player-control-bar" data-focus-row>{event && <button className="button button-primary" onClick={() => { setSourcePicker(false); setGameView(!gameView) }}>Game View</button>}<button className="button button-quiet" onClick={() => { setGameView(false); setSourcePicker(!sourcePicker) }}>Sources ({alternatives.length || 1})</button><button className="button button-quiet" onClick={() => player.current?.restart()}>Restart</button>{onMultiView && <button className="button button-quiet" onClick={onMultiView}>Multi-View</button>}<span className="player-specs-pill">{metrics.resolution ?? candidate.quality.resolution ?? statusDetail ?? status}</span></div>
      {gameView && event && <aside className="game-view-panel"><span className="panel-label">GAME VIEW</span><h2>{event.name}</h2><div className="game-view-score"><strong>{event.awayTeam?.name ?? 'Away'}</strong><b>{event.scoreAway ?? '–'}</b><i>—</i><b>{event.scoreHome ?? '–'}</b><strong>{event.homeTeam?.name ?? 'Home'}</strong></div><nav className="game-view-tabs" data-focus-row>{(['Summary', 'Leaders', 'Plays'] as const).map((tab) => <button className={gameViewTab === tab ? 'is-active' : ''} key={tab} onClick={() => setGameViewTab(tab)}>{tab}</button>)}</nav>{gameViewTab === 'Summary' && <><div className="game-view-stats">{event.teamStats?.length ? event.teamStats.map((stat) => <div key={stat.label}><strong>{stat.awayValue}</strong><span>{stat.label}</span><strong>{stat.homeValue}</strong></div>) : Object.entries(event.liveStats).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{event.highlightClips?.length ? <div className="current-highlights"><span className="panel-label">CURRENT HIGHLIGHTS</span>{event.highlightClips.map((clip) => <button className="source-picker-row" key={clip.id} onClick={() => openHighlight(clip)}><span><strong>{clip.title}</strong><small>{clip.description}</small></span><b>PLAY</b></button>)}</div> : null}</>}{gameViewTab === 'Leaders' && <div className="game-view-leaders">{event.playerLeaders?.length ? event.playerLeaders.map((leader) => <article key={`${leader.category}:${leader.playerShortName}`}>{leader.headshotUrl ? <img src={leader.headshotUrl} alt="" /> : <span>{leader.position ?? '—'}</span>}<div><strong>{leader.playerShortName}</strong><small>{leader.category} · {leader.statDisplay}</small></div></article>) : <p>Player leaders are not available yet.</p>}</div>}{gameViewTab === 'Plays' && <div className="game-view-plays">{event.plays?.length ? event.plays.slice(0, 30).map((play) => <article className={play.isScoringPlay ? 'is-scoring' : ''} key={play.id}><span>{[play.period && `P${play.period}`, play.clock].filter(Boolean).join(' · ')}</span><strong>{play.text}</strong><small>{play.awayScore ?? '–'} – {play.homeScore ?? '–'}</small></article>) : <p>Play-by-play is not available yet.</p>}</div>}</aside>}
      {status === 'error' && <div className="playback-error-overlay" data-focus-scope="modal"><strong>Playback interrupted</strong>{statusDetail && <p>{statusDetail}</p>}<div data-focus-row><button className="button button-primary" data-initial-focus="true" onClick={() => onSelect(candidate)}>Retry</button>{alternatives.length > 0 && <button className="button button-quiet" onClick={() => setSourcePicker(true)}>Choose source</button>}<button className="button button-quiet" onClick={closeOrBack}>Back</button></div></div>}
      {sourcePicker && <aside className="player-source-picker" data-focus-scope="modal"><header><span className="panel-label">SOURCE PICKER</span><button className="icon-button" onClick={() => setSourcePicker(false)} aria-label="Close source picker">×</button></header><div data-focus-column>{alternatives.length ? alternatives.map((option) => <button key={option.id} data-initial-focus={option.id === candidate.id ? 'true' : undefined} className={`source-picker-row ${option.id === candidate.id ? 'is-active' : ''}`} onClick={() => { setSourcePicker(false); onSelect(option) }}><span><strong>{option.title}</strong><small>{option.matchEvidence}</small></span><b>{option.quality.resolution ?? option.sourceKind}</b></button>) : <p>No alternate sources were discovered.</p>}</div></aside>}
      <footer className="playback-diagnostics"><span><Icon name="shield" size={14} />{status}</span><span>{metrics.resolution ?? candidate.quality.resolution ?? 'Resolution pending'}</span><span>{metrics.bufferedSeconds}s buffered</span><span>{metrics.droppedFrames ?? 0} dropped</span><span>{metrics.recoveryAttempt} recoveries</span></footer>
    </div>
  </div>
}
