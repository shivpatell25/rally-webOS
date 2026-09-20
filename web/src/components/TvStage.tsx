import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

const STAGE_WIDTH = 1920
const STAGE_HEIGHT = 1080

interface StageMetrics {
  scale: number
  left: number
  top: number
}

function measureStage(): StageMetrics {
  const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
  return {
    scale,
    left: (window.innerWidth - STAGE_WIDTH * scale) / 2,
    top: (window.innerHeight - STAGE_HEIGHT * scale) / 2,
  }
}

export function TvStage({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState<StageMetrics>(() => measureStage())

  useEffect(() => {
    const resize = () => setMetrics(measureStage())
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
    }
  }, [])

  const style = {
    '--tv-scale': metrics.scale,
    '--tv-left': `${metrics.left}px`,
    '--tv-top': `${metrics.top}px`,
  } as CSSProperties

  return <div className="tv-viewport" style={style}><div className="tv-stage">{children}</div></div>
}
