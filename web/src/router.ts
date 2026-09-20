import type { RallyRoute } from './domain'

function decode(value?: string): string {
  if (!value) return ''
  try { return decodeURIComponent(value) } catch { return value }
}

function encode(value: string): string {
  return encodeURIComponent(value)
}

export function parseRoute(hash = window.location.hash): RallyRoute {
  const [rawPath, rawQuery = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = rawPath.split('/').filter(Boolean).map(decode)
  const query = new URLSearchParams(rawQuery)
  switch (parts[0]) {
    case 'onboarding': return { page: 'onboarding' }
    case 'live': return { page: 'live' }
    case 'leagues': return { page: 'leagues' }
    case 'league': return parts[1] ? { page: 'league', league: parts[1] } : { page: 'leagues' }
    case 'team': return parts[1] && parts[2] ? { page: 'team', league: parts[1], teamId: parts[2] } : { page: 'favorites' }
    case 'highlights': return { page: 'highlights' }
    case 'search': return { page: 'search' }
    case 'favorites': return { page: 'favorites' }
    case 'settings': return { page: 'settings', section: parts[1] || undefined }
    case 'event': return parts[1] ? { page: 'event', eventId: parts[1] } : { page: 'home' }
    case 'player': {
      const candidateId = query.get('candidate') || parts[1]
      return candidateId ? { page: 'player', candidateId, eventId: query.get('event') || undefined } : { page: 'home' }
    }
    case 'multiview': return {
      page: 'multiview',
      candidateIds: query.getAll('candidate').filter(Boolean),
      eventIds: query.getAll('event').filter(Boolean),
    }
    default: return { page: 'home' }
  }
}

export function routeHash(route: RallyRoute): string {
  switch (route.page) {
    case 'onboarding': return '#/onboarding'
    case 'home': return '#/home'
    case 'live': return '#/live'
    case 'leagues': return '#/leagues'
    case 'league': return `#/league/${encode(route.league)}`
    case 'team': return `#/team/${encode(route.league)}/${encode(route.teamId)}`
    case 'highlights': return '#/highlights'
    case 'search': return '#/search'
    case 'favorites': return '#/favorites'
    case 'settings': return `#/settings${route.section ? `/${encode(route.section)}` : ''}`
    case 'event': return `#/event/${encode(route.eventId)}`
    case 'player': {
      const query = new URLSearchParams({ candidate: route.candidateId })
      if (route.eventId) query.set('event', route.eventId)
      return `#/player?${query}`
    }
    case 'multiview': {
      const query = new URLSearchParams()
      route.candidateIds.forEach((candidateId) => query.append('candidate', candidateId))
      route.eventIds.forEach((event) => query.append('event', event))
      return `#/multiview?${query}`
    }
  }
}

export function navigate(route: RallyRoute, replace = false): void {
  const hash = routeHash(route)
  if (replace) window.location.replace(hash)
  else window.location.hash = hash
  window.scrollTo(0, 0)
}

export function routeKey(route: RallyRoute): string {
  return routeHash(route)
}

export function topLevelPage(route: RallyRoute): 'home' | 'live' | 'leagues' | 'highlights' | 'favorites' | undefined {
  if (route.page === 'event' || route.page === 'player' || route.page === 'multiview') return 'home'
  if (route.page === 'league') return 'leagues'
  if (route.page === 'team') return 'favorites'
  if (['home', 'live', 'leagues', 'highlights', 'favorites'].includes(route.page)) return route.page as 'home' | 'live' | 'leagues' | 'highlights' | 'favorites'
  return undefined
}
