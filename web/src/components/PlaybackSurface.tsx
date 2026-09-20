import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { resolveProxyUrl } from '../webos'
import type Hls from 'hls.js'
import type { PlaybackMetrics, SourceCandidate, ViewingPreferences } from '../domain'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'stalled' | 'ended' | 'error'

export interface PlaybackSurfaceHandle {
  play: () => Promise<void>
  pause: () => void
  seekLive: () => void
}

interface PlaybackSurfaceProps {
  candidate: SourceCandidate
  preferences: ViewingPreferences
  muted?: boolean
  autoPlay?: boolean
  className?: string
  onStatus?: (status: PlaybackStatus, detail?: string) => void
  onMetrics?: (metrics: PlaybackMetrics) => void
  onFatal?: () => void
}

const STARTUP_TIMEOUT_MS = 12_000
const STALL_TIMEOUT_MS = 8_000
const MAX_RECOVERY_ATTEMPTS = 2

export const PlaybackSurface = forwardRef<PlaybackSurfaceHandle, PlaybackSurfaceProps>(function PlaybackSurface({ candidate, preferences, muted = false, autoPlay = true, className, onStatus, onMetrics, onFatal }, forwardedRef) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [detail, setDetail] = useState<string>()
  const recoveryAttempts = useRef(0)
  const callbacks = useRef({ onStatus, onMetrics, onFatal })
  callbacks.current = { onStatus, onMetrics, onFatal }
  const audioGraph = useRef<{ context: AudioContext; source: MediaElementAudioSourceNode; compressor: DynamicsCompressorNode }>()

  const report = (next: PlaybackStatus, message?: string) => {
    setStatus(next)
    setDetail(message)
    callbacks.current.onStatus?.(next, message)
  }

  useImperativeHandle(forwardedRef, () => ({
    async play() {
      await videoRef.current?.play()
    },
    pause() {
      videoRef.current?.pause()
    },
    seekLive() {
      const video = videoRef.current
      if (video?.seekable.length) video.currentTime = video.seekable.end(video.seekable.length - 1) - 1
    },
  }), [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !preferences.audioNormalization) return
    try {
      if (!audioGraph.current) {
        const AudioContextClass = window.AudioContext
        const context = new AudioContextClass()
        const source = context.createMediaElementSource(video)
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = -24
        compressor.knee.value = 18
        compressor.ratio.value = 4
        compressor.attack.value = .01
        compressor.release.value = .22
        source.connect(compressor)
        compressor.connect(context.destination)
        audioGraph.current = { context, source, compressor }
      }
      const resume = () => { void audioGraph.current?.context.resume() }
      video.addEventListener('play', resume)
      return () => video.removeEventListener('play', resume)
    } catch {
      // Some provider media cannot enter a Web Audio graph; playback remains direct.
    }
  }, [preferences.audioNormalization])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let hls: Hls | undefined
    let active = true
    let startupTimer = 0
    let stallTimer = 0
    const startedAt = performance.now()
    let terminalError = false
    recoveryAttempts.current = 0
    report('loading')

    const publishMetrics = () => {
      const bufferedSeconds = video.buffered.length ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime) : 0
      const quality = video.getVideoPlaybackQuality?.()
      callbacks.current.onMetrics?.({
        startupMs: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? Math.round(performance.now() - startedAt) : undefined,
        resolution: video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : candidate.quality.resolution,
        bufferedSeconds: Math.round(bufferedSeconds * 10) / 10,
        droppedFrames: quality?.droppedVideoFrames,
        recoveryAttempt: recoveryAttempts.current,
      })
    }
    const fail = (message: string) => {
      terminalError = true
      report('error', message)
      callbacks.current.onFatal?.()
    }
    const recover = () => {
      if (recoveryAttempts.current >= MAX_RECOVERY_ATTEMPTS) {
        fail('Playback stalled after two recovery attempts.')
        return
      }
      recoveryAttempts.current += 1
      if (video.seekable.length) video.currentTime = Math.max(0, video.seekable.end(video.seekable.length - 1) - 1)
      void video.play().catch(() => undefined)
      publishMetrics()
    }
    const onPlaying = () => {
      window.clearTimeout(startupTimer)
      window.clearTimeout(stallTimer)
      report('playing')
      publishMetrics()
    }
    const onWaiting = () => {
      report('stalled', 'Recovering the live stream…')
      window.clearTimeout(stallTimer)
      stallTimer = window.setTimeout(recover, STALL_TIMEOUT_MS)
    }
    const onError = () => fail(video.error?.message || 'The TV decoder rejected this stream.')
    const onTimeUpdate = () => publishMetrics()
    const onEnded = () => report('ended', 'The stream has ended.')

    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('stalled', onWaiting)
    video.addEventListener('error', onError)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    startupTimer = window.setTimeout(() => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) recover()
    }, STARTUP_TIMEOUT_MS)
    let source = candidate.playbackTarget
    const isHls = /\.m3u8(?:$|\?)/i.test(source)
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== ''
    const requiresHeaders = Boolean(candidate.headers && Object.keys(candidate.headers).length)

    const loadMedia = async () => {
      if (requiresHeaders && window.webOS) {
        try {
          source = await resolveProxyUrl(source, candidate.headers)
        } catch {
          fail('Local proxy resolution failed for secure webOS playback.')
          return
        }
      }
      if (requiresHeaders && (!isHls || nativeHls) && !window.webOS) {
        fail('This source requires request headers that native LG playback cannot attach.')
      } else if (!isHls || nativeHls) {
        video.src = source
        video.load()
        if (autoPlay) void video.play().catch(() => { if (!terminalError) report('idle', 'Press play to start.') })
      } else {
        void import('hls.js').then(({ default: HlsPlayer }) => {
          if (!active) return
          if (!HlsPlayer.isSupported()) {
            fail('This TV has no native HLS or Media Source support for this stream.')
            return
          }
          hls = new HlsPlayer({
            enableWorker: true,
            lowLatencyMode: preferences.lowLatency,
            startLevel: preferences.adaptiveQuality ? -1 : 0,
            capLevelToPlayerSize: preferences.adaptiveQuality,
            backBufferLength: 30,
            xhrSetup: (xhr) => {
              if (!window.webOS) Object.entries(candidate.headers ?? {}).forEach(([name, value]) => xhr.setRequestHeader(name, value))
            },
          })
          hls.loadSource(source)
          hls.attachMedia(video)
          hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
            if (!data.fatal) return
            if (data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR && recoveryAttempts.current < MAX_RECOVERY_ATTEMPTS) {
              recoveryAttempts.current += 1
              hls?.startLoad()
              report('loading', 'Retrying the media connection…')
              return
            }
            if (data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR && recoveryAttempts.current < MAX_RECOVERY_ATTEMPTS) {
              recoveryAttempts.current += 1
              hls?.recoverMediaError()
              report('loading', 'Recovering the TV decoder…')
              return
            }
            fail(data.details || data.type)
          })
          if (autoPlay) void video.play().catch(() => { if (!terminalError) report('idle', 'Press play to start.') })
        }).catch((error: unknown) => fail(error instanceof Error ? error.message : 'The HLS player could not load.'))
      }
    }
    
    void loadMedia()

    const media = (event: Event) => {
      const action = (event as CustomEvent<'play' | 'pause' | 'stop' | 'rewind' | 'forward'>).detail
      if (action === 'play') void video.play()
      else if (action === 'pause') video.pause()
      else if (action === 'stop') { video.pause(); video.currentTime = 0 }
      else if (action === 'rewind') video.currentTime = Math.max(0, video.currentTime - 10)
      else if (action === 'forward') video.currentTime += 10
    }
    window.addEventListener('rally:media', media)

    return () => {
      active = false
      window.clearTimeout(startupTimer)
      window.clearTimeout(stallTimer)
      window.removeEventListener('rally:media', media)
      hls?.destroy()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onWaiting)
      video.removeEventListener('error', onError)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [autoPlay, candidate, preferences.adaptiveQuality, preferences.lowLatency])

  return <div className={`playback-surface ${className ?? ''}`}><video ref={videoRef} playsInline muted={muted} preload="auto" aria-label={`Rally playback for ${candidate.title}`} />{status !== 'playing' && <div className={`playback-surface-status is-${status}`}><strong>{status === 'loading' ? 'Starting stream' : status === 'stalled' ? 'Recovering playback' : status === 'ended' ? 'Stream ended' : status === 'error' ? 'Playback unavailable' : 'Ready'}</strong>{detail && <span>{detail}</span>}</div>}</div>
})
