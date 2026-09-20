import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { classifyPlaybackError } from '../domain'
import type { SourceCandidate } from '../domain'
import { Icon } from './Icon'

interface PlaybackViewProps {
  candidate: SourceCandidate
  onBack: () => void
  onMultiView?: () => void
}

export function PlaybackView({ candidate, onBack, onMultiView }: PlaybackViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [startedAt] = useState(() => performance.now())

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let hls: Hls | undefined
    let active = true
    const source = candidate.playbackTarget
    const isHls = /\.m3u8(?:$|\?)/i.test(source)
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== ''

    const onVideoError = () => {
      setError(classifyPlaybackError(video.error?.message || 'The video element reported a playback error.'))
    }
    const onPlaying = () => {
      setPlaying(true)
      setError(null)
    }
    video.addEventListener('error', onVideoError)
    video.addEventListener('playing', onPlaying)

    if (!isHls || nativeHls) {
      video.src = source
      video.load()
    } else {
      void import('hls.js').then(({ default: HlsPlayer }) => {
        if (!active) return
        if (!HlsPlayer.isSupported()) {
          setError('This TV has no native HLS or Media Source support for this stream.')
          return
        }
        hls = new HlsPlayer({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 })
        hls.loadSource(source)
        hls.attachMedia(video)
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) setError(classifyPlaybackError(data.details || data.type))
        })
      }).catch((loadError: unknown) => {
        if (active) setError(classifyPlaybackError(loadError))
      })
    }

    return () => {
      active = false
      hls?.destroy()
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('playing', onPlaying)
      video.removeAttribute('src')
      video.load()
    }
  }, [candidate.playbackTarget])

  const startPlayback = async () => {
    try {
      await videoRef.current?.play()
      setPlaying(true)
    } catch (playError) {
      setError(classifyPlaybackError(playError))
    }
  }

  return (
    <div className="playback-page">
      <div className="playback-header"><div><button className="button button-quiet" onClick={onBack}><Icon name="back" size={16} />Back</button>{onMultiView && <button className="button button-quiet" onClick={onMultiView}>Open Multi-View</button>}</div><span className="playback-source-label">{candidate.sourceKind} · {candidate.title}</span></div>
      <div className="player-stage">
        <video ref={videoRef} controls playsInline preload="metadata" aria-label={`Rally playback for ${candidate.title}`} />
        {!playing && !error && <button className="player-start" onClick={startPlayback} aria-label="Start playback"><Icon name="play" size={28} /></button>}
        {error && <div className="player-error"><div className="state-icon"><Icon name="alert" size={22} /></div><h2>Playback could not start</h2><p>{error}</p><div className="player-error-actions"><button className="button button-primary button-small" onClick={startPlayback}><Icon name="refresh" size={14} />Retry</button><button className="button button-quiet button-small" onClick={onBack}>Choose another source</button></div></div>}
      </div>
      <div className="playback-diagnostics"><span className="diagnostic-label"><Icon name="shield" size={14} />Playback diagnostics</span><span>{candidate.quality.resolution || 'Quality not reported'}</span><span>{candidate.headers ? 'Provider headers supplied' : 'Direct request'}</span><span>{Math.round(performance.now() - startedAt)} ms session</span></div>
    </div>
  )
}
