import type { DeviceCapabilities } from './domain'

declare global {
  interface Window {
    webOS?: {
      service?: {
        request: (uri: string, options: {
          method: string
          parameters?: Record<string, unknown>
          onSuccess?: (result: unknown) => void
          onFailure?: (error: unknown) => void
        }) => { cancel?: () => void }
      }
      deviceInfo?: (callback: (info: Record<string, unknown>) => void) => void
    }
    PalmSystem?: {
      activate?: () => void
      deactivate?: () => void
      screenOrientation?: string
    }
  }
}

export function detectDeviceCapabilities(): DeviceCapabilities {
  const video = document.createElement('video')
  const userAgent = navigator.userAgent
  const webos = /web0s|webos|netcast/i.test(userAgent) || Boolean(window.webOS)
  const nativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'))
  const mediaSource = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 2
  const maxConcurrentStreams = webos ? (mediaSource && memory >= 4 ? 4 : mediaSource || nativeHls ? 2 : 1) : mediaSource && memory >= 4 ? 4 : mediaSource ? 2 : 1
  return { webos, nativeHls, mediaSource, maxConcurrentStreams, serviceBridge: Boolean(window.webOS?.service?.request), userAgent }
}
let activeProxyPort = 0

export async function resolveProxyUrl(url: string, headers?: Record<string, string>): Promise<string> {
  if (!window.webOS?.service?.request) return url
  if (!activeProxyPort) {
    activeProxyPort = await new Promise<number>((resolve, reject) => {
      window.webOS?.service?.request('luna://com.shiv.rally.service', {
        method: 'getProxyPort',
        onSuccess: (result: unknown) => {
          const port = Number((result as Record<string, unknown>).port)
          if (port > 0) resolve(port)
          else reject(new Error('Proxy port was zero or missing'))
        },
        onFailure: (error) => reject(new Error(`Failed to fetch proxy port: ${JSON.stringify(error)}`)),
      })
    })
  }
  const target = new URL(url)
  return `http://127.0.0.1:${activeProxyPort}/?url=${encodeURIComponent(target.toString())}&headers=${encodeURIComponent(JSON.stringify(headers || {}))}`
}

export function setPlaybackScreenSaver(enabled: boolean): () => void {
  const request = window.webOS?.service?.request
  if (!request) return () => undefined
  const call = request('luna://com.webos.service.tvpower/power', {
    method: 'setScreenSaverEnabled',
    parameters: { enabled },
  })
  return () => call.cancel?.()
}

export function notifyApplicationActive(active: boolean): void {
  if (active) window.PalmSystem?.activate?.()
  else window.PalmSystem?.deactivate?.()
}

export interface ServiceFetchResult {
  status: number
  headers: Record<string, string>
  bodyBase64: string
}

export function webosServiceFetch(url: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<ServiceFetchResult> {
  const request = window.webOS?.service?.request
  if (!request) return Promise.reject(new Error('The packaged webOS network service is unavailable.'))
  return new Promise((resolve, reject) => {
    const call = request('luna://com.shiv.rally.service', {
      method: 'fetch',
      parameters: { url, headers },
      onSuccess: (result) => {
        const value = result as Partial<ServiceFetchResult> & { returnValue?: boolean; errorText?: string }
        if (value.returnValue === false || typeof value.status !== 'number' || typeof value.bodyBase64 !== 'string') {
          reject(new Error(value.errorText || 'The webOS network service returned an invalid response.'))
          return
        }
        resolve({ status: value.status, headers: value.headers ?? {}, bodyBase64: value.bodyBase64 })
      },
      onFailure: (error) => reject(new Error(`webOS service request failed: ${JSON.stringify(error)}`)),
    })
    const abort = () => {
      call.cancel?.()
      reject(new DOMException('Request aborted', 'AbortError'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}
