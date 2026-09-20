import { webosServiceFetch } from '../webos'

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export async function providerFetchJson<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(url, { ...init, signal, credentials: init.credentials ?? 'include' })
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`)
    return await response.json() as T
  } catch (directError) {
    if (signal?.aborted) throw directError
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    try {
      const response = await webosServiceFetch(url, headers, signal)
      if (response.status < 200 || response.status >= 300) throw new Error(`Provider returned HTTP ${response.status}`)
      return JSON.parse(decodeBase64(response.bodyBase64)) as T
    } catch (serviceError) {
      const directMessage = directError instanceof Error ? directError.message : 'Direct browser request failed.'
      const serviceMessage = serviceError instanceof Error ? serviceError.message : 'webOS service request failed.'
      throw new Error(`${directMessage} ${serviceMessage}`)
    }
  }
}
