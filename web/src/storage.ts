import { normalizeAddon, normalizePortal, toggleFavorite } from './domain'
import type { ProviderConfig } from './domain'

const PROVIDER_KEY = 'rally-web-provider-config-v1'
const FAVORITES_KEY = 'rally-web-favorite-teams-v1'

const defaultConfig: ProviderConfig = { portalUrl: '', macAddress: '', addonUrls: [] }

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

export function readProviderConfig(): ProviderConfig {
  const value = readJson<Partial<ProviderConfig>>(PROVIDER_KEY, {})
  return {
    portalUrl: normalizePortal(value.portalUrl ?? defaultConfig.portalUrl),
    macAddress: value.macAddress?.trim().toUpperCase() ?? '',
    addonUrls: (value.addonUrls ?? []).map(normalizeAddon).filter((url): url is string => Boolean(url)),
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  const stored: ProviderConfig = {
    portalUrl: normalizePortal(config.portalUrl),
    macAddress: config.macAddress.trim().toUpperCase(),
    addonUrls: Array.from(new Set(config.addonUrls.map(normalizeAddon).filter((url): url is string => Boolean(url)))),
  }
  window.localStorage.setItem(PROVIDER_KEY, JSON.stringify(stored))
}

export function readFavoriteTeams(): string[] {
  return readJson<string[]>(FAVORITES_KEY, []).filter((id) => typeof id === 'string')
}

export function toggleFavoriteTeam(teamId: string): string[] {
  const next = toggleFavorite(readFavoriteTeams(), teamId)
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
  return next
}
