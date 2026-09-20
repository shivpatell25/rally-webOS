import { DEFAULT_PREFERENCES, normalizeAddon, normalizePortal } from './domain'
import type { FavoriteTeamProfile, ProviderConfig, RallyPreferences, SourceCandidate, SportEvent, ViewingPreferences } from './domain'

const PREFERENCES_KEY = 'rally-web-preferences-v2'
const LEGACY_PROVIDER_KEY = 'rally-web-provider-config-v1'
const LEGACY_FAVORITES_KEY = 'rally-web-favorite-teams-v1'
const PLAYBACK_KEY = 'rally-web-playback-candidates-v1'
const PLAYBACK_TTL_MS = 2 * 60 * 60 * 1000

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function cleanProvider(value?: Partial<ProviderConfig>): ProviderConfig {
  const serialNumber = value?.serialNumber?.trim()
  const deviceId = value?.deviceId?.trim()
  return {
    portalUrl: normalizePortal(value?.portalUrl ?? ''),
    macAddress: value?.macAddress?.trim().toUpperCase() ?? '',
    ...(serialNumber ? { serialNumber } : {}),
    ...(deviceId ? { deviceId } : {}),
    addonUrls: Array.from(new Set((value?.addonUrls ?? []).map(normalizeAddon).filter((url): url is string => Boolean(url)))),
  }
}

function cleanProfiles(value: unknown): FavoriteTeamProfile[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is FavoriteTeamProfile => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.league === 'string'))
}

export function readPreferences(): RallyPreferences {
  const current = readJson<Partial<RallyPreferences>>(PREFERENCES_KEY, {})
  const legacyProvider = readJson<Partial<ProviderConfig>>(LEGACY_PROVIDER_KEY, {})
  const provider = cleanProvider(current.provider ?? legacyProvider)
  const favoriteTeams = cleanProfiles(current.favoriteTeams)
  const viewing: ViewingPreferences = { ...DEFAULT_PREFERENCES.viewing, ...(current.viewing ?? {}) }
  viewing.enabledLeagues = Array.isArray(viewing.enabledLeagues) ? viewing.enabledLeagues : []
  viewing.favoriteSports = Array.isArray(viewing.favoriteSports) ? viewing.favoriteSports : []
  viewing.sportsOrder = Array.isArray(viewing.sportsOrder) && viewing.sportsOrder.length ? viewing.sportsOrder : DEFAULT_PREFERENCES.viewing.sportsOrder
  return {
    provider,
    favoriteTeams,
    viewing,
    setupComplete: Boolean(current.setupComplete ?? (provider.portalUrl || provider.addonUrls.length)),
  }
}

export function savePreferences(preferences: RallyPreferences): void {
  const stored: RallyPreferences = {
    ...preferences,
    provider: cleanProvider(preferences.provider),
    favoriteTeams: cleanProfiles(preferences.favoriteTeams),
    viewing: { ...DEFAULT_PREFERENCES.viewing, ...preferences.viewing },
  }
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(stored))
}

export function readProviderConfig(): ProviderConfig {
  return readPreferences().provider
}

export function saveProviderConfig(config: ProviderConfig): void {
  const current = readPreferences()
  savePreferences({ ...current, provider: cleanProvider(config), setupComplete: true })
}

export function readFavoriteTeams(): string[] {
  const profiles = readPreferences().favoriteTeams
  if (profiles.length) return profiles.map((team) => team.id)
  return readJson<string[]>(LEGACY_FAVORITES_KEY, []).filter((id) => typeof id === 'string')
}

export function toggleFavoriteTeam(teamId: string, event?: SportEvent): FavoriteTeamProfile[] {
  const current = readPreferences()
  const existing = current.favoriteTeams.some((team) => team.id === teamId && (!event || team.league === event.league))
  const next = existing
    ? current.favoriteTeams.filter((team) => !(team.id === teamId && (!event || team.league === event.league)))
    : [...current.favoriteTeams, ...event ? [event.homeTeam, event.awayTeam].filter((team): team is NonNullable<typeof team> => team?.id === teamId).map((team) => ({ ...team, league: event.league })) : []]
  savePreferences({ ...current, favoriteTeams: next })
  return next
}

export function exportPersonalization(preferences = readPreferences()): string {
  return JSON.stringify({ version: 2, favoriteTeams: preferences.favoriteTeams, viewing: preferences.viewing }, null, 2)
}

export function importPersonalization(raw: string): RallyPreferences {
  const parsed = JSON.parse(raw) as { favoriteTeams?: unknown; viewing?: Partial<ViewingPreferences> }
  const current = readPreferences()
  const next = {
    ...current,
    favoriteTeams: cleanProfiles(parsed.favoriteTeams),
    viewing: { ...DEFAULT_PREFERENCES.viewing, ...current.viewing, ...(parsed.viewing ?? {}) },
  }
  savePreferences(next)
  return next
}

interface StoredCandidate {
  candidate: SourceCandidate
  savedAt: number
}

function readCandidateStore(): Record<string, StoredCandidate> {
  const stored = readJson<Record<string, StoredCandidate>>(PLAYBACK_KEY, {})
  const now = Date.now()
  return Object.fromEntries(Object.entries(stored).filter(([, value]) => value?.candidate?.id && now - value.savedAt < PLAYBACK_TTL_MS))
}

export function savePlaybackCandidate(candidate: SourceCandidate): void {
  const stored = readCandidateStore()
  stored[candidate.id] = { candidate, savedAt: Date.now() }
  window.localStorage.setItem(PLAYBACK_KEY, JSON.stringify(stored))
}

export function readPlaybackCandidate(candidateId: string): SourceCandidate | undefined {
  return readCandidateStore()[candidateId]?.candidate
}

export function savePlaybackCandidates(candidates: SourceCandidate[]): void {
  const stored = readCandidateStore()
  const savedAt = Date.now()
  for (const candidate of candidates) stored[candidate.id] = { candidate, savedAt }
  window.localStorage.setItem(PLAYBACK_KEY, JSON.stringify(stored))
}
