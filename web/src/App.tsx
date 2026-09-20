import { useCallback, useEffect, useState } from 'react'
import { discoverSources, checkBrowserSource, loadEventSummary, loadSportsSnapshot, StalkerBrowserClient } from './data'
import { classifyPlaybackError, eventStatusLabel, sportBackdrop, splitAddonInputs, toggleFavorite, validateProviderConfig } from './domain'
import type { ProviderConfig, ProviderIssue, SourceCandidate, SportEvent, SportsSnapshot } from './domain'
import { readFavoriteTeams, readProviderConfig, saveProviderConfig, toggleFavoriteTeam } from './storage'
import { Brand } from './components/Brand'
import { EventCard } from './components/EventCard'
import { Icon, type IconName } from './components/Icon'
import { LoadingState, EmptyState, ErrorState } from './components/States'
import { PlaybackView } from './components/PlaybackView'
import { SourceCard } from './components/SourceCard'

interface RouteState {
  page: 'home' | 'live' | 'leagues' | 'highlights' | 'search' | 'favorites' | 'sources' | 'event' | 'play'
  eventId?: string
  sourceId?: string
}

interface SourceState {
  loading: boolean
  loaded: boolean
  candidates: SourceCandidate[]
  issues: ProviderIssue[]
}

const emptySourceState: SourceState = { loading: false, loaded: false, candidates: [], issues: [] }

function parseHash(): RouteState {
  const parts = window.location.hash.replace(/^#/, '').split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part)
    } catch {
      return part
    }
  })
  if (parts[0] === 'event' && parts[1]) return { page: 'event', eventId: parts[1] }
  if (parts[0] === 'play' && parts[1] && parts[2]) return { page: 'play', eventId: parts[1], sourceId: parts[2] }
  if (parts[0] === 'leagues') return { page: 'leagues' }
  if (parts[0] === 'highlights') return { page: 'highlights' }
  if (parts[0] === 'live') return { page: 'live' }
  if (parts[0] === 'search') return { page: 'search' }
  if (parts[0] === 'favorites') return { page: 'favorites' }
  if (parts[0] === 'sources') return { page: 'sources' }
  return { page: 'home' }
}

function navigate(hash: string): void {
  window.location.hash = hash
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function isLive(event: SportEvent): boolean {
  return event.status === 'LIVE' || event.status === 'HALFTIME'
}

function isUpcoming(event: SportEvent): boolean {
  return event.status === 'NOT_STARTED' || event.status === 'DELAYED'
}

function eventsForTeams(events: SportEvent[], favorites: string[]): SportEvent[] {
  if (!favorites.length) return []
  return events.filter((event) => favorites.includes(event.homeTeam?.id ?? '') || favorites.includes(event.awayTeam?.id ?? ''))
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseHash())
  const [snapshot, setSnapshot] = useState<SportsSnapshot | null>(null)
  const [loadingSports, setLoadingSports] = useState(true)
  const [sportsError, setSportsError] = useState<string | null>(null)
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(() => readProviderConfig())
  const [favoriteTeamIds, setFavoriteTeamIds] = useState<string[]>(() => readFavoriteTeams())
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>({})
  const [searchQuery, setSearchQuery] = useState('')

  const refreshSports = useCallback(async () => {
    setLoadingSports(true)
    setSportsError(null)
    try {
      const nextSnapshot = await loadSportsSnapshot()
      setSnapshot(nextSnapshot)
      if (!nextSnapshot.events.length && nextSnapshot.sourceIssues.length) setSportsError('The public sports feeds did not return usable events.')
    } catch (error) {
      setSportsError(error instanceof Error ? error.message : 'The public sports feeds could not be reached.')
    } finally {
      setLoadingSports(false)
    }
  }, [])

  useEffect(() => {
    void refreshSports()
    const onHashChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [refreshSports])

  const events = snapshot?.events ?? []
  const selectedEvent = events.find((event) => event.id === route.eventId)
  const sourceState = selectedEvent ? sourceStates[selectedEvent.id] ?? emptySourceState : emptySourceState

  const ensureSources = useCallback(async (event: SportEvent, force = false) => {
    const current = sourceStates[event.id]
    if (current?.loading || (!force && current?.loaded)) return
    setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), loading: true, loaded: false, issues: [] } }))
    try {
      const result = await discoverSources(event, providerConfig)
      setSourceStates((states) => ({ ...states, [event.id]: { loading: false, loaded: true, candidates: result.candidates, issues: result.issues } }))
    } catch (error) {
      setSourceStates((states) => ({ ...states, [event.id]: { loading: false, loaded: true, candidates: [], issues: [{ provider: 'Source discovery', message: 'Source discovery failed', detail: error instanceof Error ? error.message : undefined }] } }))
    }
  }, [providerConfig, sourceStates])

  useEffect(() => {
    if (route.page === 'event' && selectedEvent) void ensureSources(selectedEvent)
  }, [ensureSources, route.page, selectedEvent])

  const toggleTeam = (teamId: string) => {
    const next = toggleFavorite(favoriteTeamIds, teamId)
    setFavoriteTeamIds(next)
    toggleFavoriteTeam(teamId)
  }

  const saveConfig = (config: ProviderConfig) => {
    const validation = validateProviderConfig(config)
    if (validation.errors.length) return validation
    saveProviderConfig(validation.config)
    setProviderConfig(validation.config)
    setSourceStates({})
    return validation
  }

  const openCandidate = async (event: SportEvent, candidate: SourceCandidate) => {
    let resolved = candidate
    if (candidate.requiresProviderResolution && candidate.channel && providerConfig.portalUrl) {
      try {
        const client = new StalkerBrowserClient(providerConfig.portalUrl, providerConfig.macAddress)
        const playbackTarget = await client.resolveStream(candidate.channel)
        resolved = { ...candidate, playbackTarget, requiresProviderResolution: false, browserStatus: 'unknown' }
        setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), candidates: (states[event.id]?.candidates ?? []).map((item) => item.id === candidate.id ? resolved : item) } }))
      } catch (error) {
        setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), issues: [...(states[event.id]?.issues ?? []), { provider: 'IPTV portal', message: classifyPlaybackError(error) }] } }))
        return
      }
    }
    navigate(`#play/${encodeURIComponent(event.id)}/${encodeURIComponent(resolved.id)}`)
  }

  const checkCandidate = async (event: SportEvent, candidate: SourceCandidate) => {
    setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), candidates: (states[event.id]?.candidates ?? []).map((item) => item.id === candidate.id ? { ...item, browserStatus: 'checking' } : item) } }))
    const checked = await checkBrowserSource(candidate)
    setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), candidates: (states[event.id]?.candidates ?? []).map((item) => item.id === candidate.id ? checked : item) } }))
  }

  const playCandidate = route.page === 'play' && selectedEvent ? (sourceStates[selectedEvent.id]?.candidates ?? []).find((candidate) => candidate.id === route.sourceId) : undefined

  return (
    <div className="app-shell">
      <Sidebar page={route.page} />
      <div className="app-main">
        <Topbar page={route.page} query={searchQuery} onQueryChange={setSearchQuery} onNavigate={navigate} />
        <main className="page-content">
          {route.page === 'home' && <HomePage events={events} snapshot={snapshot} loading={loadingSports} error={sportsError} onRetry={refreshSports} onOpen={(event) => navigate(`#event/${encodeURIComponent(event.id)}`)} onToggleFavorite={toggleTeam} favoriteTeamIds={favoriteTeamIds} onNavigate={navigate} />}
          {route.page === 'live' && <EventBrowsePage title="Live & upcoming" description="Every event Rally can currently reach from the public sports feeds." events={events} loading={loadingSports} error={sportsError} onRetry={refreshSports} onOpen={(event) => navigate(`#event/${encodeURIComponent(event.id)}`)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={toggleTeam} filter="all" />}
          {route.page === 'leagues' && <LeaguesPage events={events} loading={loadingSports} onOpen={(event) => navigate(`#event/${encodeURIComponent(event.id)}`)} />}
          {route.page === 'highlights' && <HighlightsPage />}
          {route.page === 'search' && <SearchPage query={searchQuery} onQueryChange={setSearchQuery} events={events} favoriteTeamIds={favoriteTeamIds} onOpen={(event) => navigate(`#event/${encodeURIComponent(event.id)}`)} />}
          {route.page === 'favorites' && <FavoritesPage events={events} favoriteTeamIds={favoriteTeamIds} onOpen={(event) => navigate(`#event/${encodeURIComponent(event.id)}`)} onToggleFavorite={toggleTeam} />}
          {route.page === 'sources' && <SourcesPage config={providerConfig} onSave={saveConfig} />}
          {route.page === 'event' && selectedEvent && <EventDetailPage event={selectedEvent} sourceState={sourceState} onBack={() => navigate('#home')} onRefresh={() => ensureSources(selectedEvent, true)} onPlay={(candidate) => void openCandidate(selectedEvent, candidate)} onCheck={(candidate) => void checkCandidate(selectedEvent, candidate)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={toggleTeam} />}
          {route.page === 'event' && !selectedEvent && <NotFound onHome={() => navigate('#home')} />}
          {route.page === 'play' && selectedEvent && playCandidate && <PlaybackView candidate={playCandidate} onBack={() => navigate(`#event/${encodeURIComponent(selectedEvent.id)}`)} />}
          {route.page === 'play' && (!selectedEvent || !playCandidate) && <NotFound onHome={() => navigate('#home')} />}
        </main>
      </div>
    </div>
  )
}
function Sidebar({ page }: { page: RouteState['page'] }) {
  const items: Array<{ page: RouteState['page']; label: string; icon: IconName }> = [
    { page: 'home', label: 'Home', icon: 'home' },
    { page: 'live', label: 'Live', icon: 'live' },
    { page: 'leagues', label: 'Leagues', icon: 'live' },
    { page: 'highlights', label: 'Highlights', icon: 'play' },
    { page: 'favorites', label: 'My teams', icon: 'star' },
  ]
  const activePage = page === 'event' || page === 'play' ? 'home' : page
  return <aside className="sidebar"><nav aria-label="Mobile navigation">{items.map((item) => <a key={item.page} className={`nav-item ${activePage === item.page ? 'is-active' : ''}`} href={`#${item.page}`}><Icon name={item.icon} size={17} /><span>{item.label}</span></a>)}</nav></aside>
}

function Topbar({ page, query, onQueryChange, onNavigate }: { page: RouteState['page']; query: string; onQueryChange: (value: string) => void; onNavigate: (hash: string) => void }) {
  const items: Array<{ page: RouteState['page']; label: string }> = [
    { page: 'home', label: 'HOME' },
    { page: 'live', label: 'LIVE' },
    { page: 'leagues', label: 'LEAGUES' },
    { page: 'highlights', label: 'HIGHLIGHTS' },
    { page: 'favorites', label: 'MY TEAMS' },
  ]
  const activePage = page === 'event' || page === 'play' ? 'home' : page
  return <header className="topbar"><Brand /><nav className="chrome-nav" aria-label="Primary navigation">{items.map((item) => <a key={item.page} className={`chrome-nav-item ${activePage === item.page ? 'is-active' : ''}`} href={`#${item.page}`}>{item.label}</a>)}</nav><div className="topbar-actions"><label className="topbar-search"><Icon name="search" size={17} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} onFocus={() => onNavigate('#search')} placeholder="Search" aria-label="Search games, teams, and leagues" /></label><a className="topbar-settings" href="#sources" aria-label="Open sources and settings"><Icon name="settings" size={18} /></a></div></header>
}

function HomePage({ events, snapshot, loading, error, onRetry, onOpen, onToggleFavorite, favoriteTeamIds, onNavigate }: { events: SportEvent[]; snapshot: SportsSnapshot | null; loading: boolean; error: string | null; onRetry: () => void; onOpen: (event: SportEvent) => void; onToggleFavorite: (teamId: string) => void; favoriteTeamIds: string[]; onNavigate: (hash: string) => void }) {
  const live = events.filter(isLive)
  const upcoming = events.filter(isUpcoming)
  const boardEvents = [...live, ...upcoming].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index).slice(0, 15)
  const featured = live[0] ?? upcoming[0]
  const sports = Array.from(new Map(events.map((event) => [event.league, event])).values()).map((sample) => ({
    league: sample.league,
    sport: sample.sport,
    events: events.filter((event) => event.league === sample.league),
  }))
  if (loading && !snapshot) return <LoadingState label="Building your sports desk" />
  if (error && !events.length) return <ErrorState body={`${error} No placeholder scores are shown.`} onRetry={onRetry} />
  return <div className="home-page">
    <section className={`hero ${featured ? sportBackdrop(featured.sport) : 'backdrop-football'}`}>
      <div className="hero-scrim" />
      {featured ? <div className="hero-copy">
        <div className="hero-meta"><span className={isLive(featured) ? 'live-pill' : 'meta-pill'}>{isLive(featured) ? (featured.gameStatusDetail || 'LIVE NOW') : 'FEATURED'}</span><span>{featured.eventContextTitle?.toUpperCase() || featured.league}</span></div>
        <div className="hero-score-row">
          <HeroTeam team={featured.awayTeam} />
          <div className="hero-score"><strong>{isLive(featured) || featured.status === 'FINISHED' ? `${featured.scoreAway ?? '–'}  –  ${featured.scoreHome ?? '–'}` : 'VS'}</strong><span>{isLive(featured) ? eventStatusLabel(featured) : eventStatusLabel(featured)}</span></div>
          <HeroTeam team={featured.homeTeam} home />
        </div>
        <div className="hero-footer"><span>{[featured.venue, featured.league].filter(Boolean).join('  ·  ')}</span><div className="hero-actions"><button className="button button-primary" onClick={() => onOpen(featured)}><Icon name={isLive(featured) ? 'play' : 'arrow'} size={14} />{isLive(featured) ? 'Watch live' : 'Game center'}</button><button className="button button-quiet hero-secondary" onClick={() => onOpen(featured)}>Details</button></div></div>
      </div> : <div className="hero-copy hero-empty"><div className="hero-meta"><span className="live-pill">RALLY</span><span>READY FOR YOUR SOURCES</span></div><h2>Sports kept simple.</h2><p>Connect a public sports feed to browse real events, then add your own authorized IPTV portal or Stremio addon.</p><button className="button button-primary" onClick={() => onNavigate('#sources')}><Icon name="settings" size={14} />Configure sources</button></div>}
      <img className="hero-mark" src="/rally-assets/rally-mark-color.svg" alt="" />
    </section>
    <section className="signal-strip" aria-label="Rally status"><div><span className="strip-label">SIGNAL</span><strong>{snapshot ? `Updated ${new Date(snapshot.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Connecting'}</strong></div><div><span className="strip-label">LIVE NOW</span><strong>{live.length.toString().padStart(2, '0')}</strong></div><div><span className="strip-label">UP NEXT</span><strong>{upcoming.length.toString().padStart(2, '0')}</strong></div><button className="icon-button" onClick={onRetry} aria-label="Refresh sports data"><Icon name="refresh" size={16} /></button></section>
    {snapshot?.sourceIssues.length ? <div className="notice notice-warning"><Icon name="alert" size={16} /><span>Some leagues are unavailable right now. Rally is showing the events it could reach.</span></div> : null}
    <HomeShelf title="LIVE / UPCOMING" description="Follow the games currently in motion." action={boardEvents.length ? 'See all live & upcoming' : undefined} onAction={() => onNavigate('#live')} events={boardEvents} emptyTitle="No games in progress" emptyBody="Upcoming games and league schedules remain available below." onOpen={onOpen} onToggleFavorite={onToggleFavorite} favoriteTeamIds={favoriteTeamIds} />
    <HomeSportShelf shelves={sports} onNavigate={onNavigate} />
  </div>
}

function HeroTeam({ team, home = false }: { team?: SportEvent['homeTeam']; home?: boolean }) {
  return <div className={`hero-team ${home ? 'hero-team-home' : ''}`}><div className="hero-team-mark">{team?.logoUrl ? <img src={team.logoUrl} alt="" /> : <span>{team?.abbreviation ?? 'TBD'}</span>}</div><strong>{team?.name ?? 'Team pending'}</strong></div>
}

function HomeShelf({ title, description, action, onAction, events, emptyTitle, emptyBody, onOpen, onToggleFavorite, favoriteTeamIds }: { title: string; description: string; action?: string; onAction: () => void; events: SportEvent[]; emptyTitle: string; emptyBody: string; onOpen: (event: SportEvent) => void; onToggleFavorite: (teamId: string) => void; favoriteTeamIds: string[] }) {
  return <section className="home-shelf"><div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div>{action && <button className="text-action" onClick={onAction}>{action}<Icon name="arrow" size={14} /></button>}</div>{events.length ? <div className="home-card-row">{events.map((event) => <EventCard key={event.id} event={event} compact onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={onToggleFavorite} />)}</div> : <EmptyState title={emptyTitle} body={emptyBody} />}</section>
}

function HomeSportShelf({ shelves, onNavigate }: { shelves: Array<{ league: string; sport: string; events: SportEvent[] }>; onNavigate: (hash: string) => void }) {
  return <section className="home-shelf"><div className="section-heading"><div><h2>BY SPORT</h2><p>Open a league center for the games on the board.</p></div><button className="text-action" onClick={() => onNavigate('#leagues')}>All leagues <Icon name="arrow" size={14} /></button></div>{shelves.length ? <div className="sport-card-row">{shelves.map((shelf) => { const liveCount = shelf.events.filter(isLive).length; return <button key={shelf.league} className={`sport-card ${sportBackdrop(shelf.sport)}`} onClick={() => onNavigate('#leagues')}><span className="sport-card-topline"><span>LEAGUE CENTER</span>{liveCount > 0 && <b>● {liveCount} LIVE</b>}</span><LeagueMark league={shelf.league} /><strong>{leagueName(shelf.league)}</strong><small>{shelf.events.length} GAMES</small></button> })}</div> : <EmptyState title="No leagues returned" body="Refresh the board to try the public sports feeds again." />}</section>
}

function leagueName(league: string): string {
  const names: Record<string, string> = { NFL: 'National Football League', NBA: 'National Basketball Association', MLB: 'Major League Baseball', NHL: 'National Hockey League', EPL: 'Premier League', MLS: 'Major League Soccer', NCAAF: 'College Football', NCAAB: 'College Basketball' }
  return names[league.toUpperCase()] ?? league
}

function leagueMark(league: string): string {
  const marks: Record<string, string> = { NCAAF: 'CFB', NCAAB: 'CBB', NFL: 'NFL', NBA: 'NBA', MLB: 'MLB', NHL: 'NHL', EPL: 'EPL', MLS: 'MLS' }
  return marks[league.toUpperCase()] ?? league.toUpperCase().slice(0, 5)
}

function leagueLogo(league: string): string | undefined {
  const assets: Record<string, string> = { NFL: '/rally-assets/league-nfl.png', NBA: '/rally-assets/league-nba.png', MLB: '/rally-assets/league-mlb.png', NHL: '/rally-assets/league-nhl.png', EPL: '/rally-assets/league-epl.png', MLS: '/rally-assets/league-mls.png', 'CHAMPIONS LEAGUE': '/rally-assets/league-ucl.png', 'LA LIGA': '/rally-assets/league-laliga.png', 'SERIE A': '/rally-assets/league-seriea.png' }
  return assets[league.toUpperCase()]
}

function LeagueMark({ league }: { league: string }) {
  const logo = leagueLogo(league)
  return logo ? <img className="sport-card-logo" src={logo} alt="" /> : <span className="sport-card-mark">{leagueMark(league)}</span>
}


function EventBrowsePage({ title, description, events, loading, error, onRetry, onOpen, favoriteTeamIds, onToggleFavorite }: { title: string; description: string; events: SportEvent[]; loading: boolean; error: string | null; onRetry: () => void; onOpen: (event: SportEvent) => void; favoriteTeamIds: string[]; onToggleFavorite: (teamId: string) => void; filter: 'all' }) {
  if (loading && !events.length) return <LoadingState />
  if (error && !events.length) return <ErrorState body={error} onRetry={onRetry} />
  const live = events.filter(isLive)
  const upcoming = events.filter(isUpcoming)
  return <div className="browse-page"><div className="page-intro"><div><h2>{title}</h2><p>{description}</p></div><button className="button button-quiet button-small" onClick={onRetry}><Icon name="refresh" size={14} />Refresh</button></div><div className="browse-stat-row"><span><span className="live-dot" />{live.length} live</span><span>{upcoming.length} upcoming</span><span>{events.length} total events</span></div>{live.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Live now</h2></div><div className="event-grid">{live.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={onToggleFavorite} />)}</div></section>}<section className="content-section compact-section"><div className="section-heading"><h2>Upcoming</h2></div>{upcoming.length ? <div className="event-grid">{upcoming.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={onToggleFavorite} />)}</div> : <EmptyState title="No upcoming games returned" body="Try refreshing, or check the source status on the home screen." />}</section></div>
}

function LeaguesPage({ events, loading, onOpen }: { events: SportEvent[]; loading: boolean; onOpen: (event: SportEvent) => void }) {
  if (loading && !events.length) return <LoadingState label="Loading leagues" />
  const groups = Array.from(new Map(events.map((event) => [event.league, event])).values()).map((sample) => ({ sample, events: events.filter((event) => event.league === sample.league) }))
  return <div className="directory-page"><div className="directory-intro"><span>LEAGUES</span><h2>Every sport. One starting point.</h2><p>Open a league card to jump into its current board of games.</p></div>{groups.length ? <div className="league-directory-row">{groups.map(({ sample, events: leagueEvents }) => <button key={sample.league} className={`league-directory-card ${sportBackdrop(sample.sport)}`} onClick={() => leagueEvents[0] && onOpen(leagueEvents[0])}><span className="sport-card-topline"><span>LEAGUE CENTER</span>{leagueEvents.some(isLive) && <b>● LIVE</b>}</span><LeagueMark league={sample.league} /><strong>{leagueName(sample.league)}</strong><small>{leagueEvents.length} GAMES</small></button>)}</div> : <EmptyState title="No league data yet" body="Refresh the board to populate the league directory." />}</div>
}

function HighlightsPage() {
  return <div className="directory-page"><div className="directory-intro"><span>HIGHLIGHTS</span><h2>The biggest moments, right now.</h2><p>Event-linked clips from supported leagues.</p></div><EmptyState title="No league clips have been published yet" body="This page fills automatically as supported leagues release highlights." /></div>
}

function SearchPage({ query, onQueryChange, events, favoriteTeamIds, onOpen }: { query: string; onQueryChange: (value: string) => void; events: SportEvent[]; favoriteTeamIds: string[]; onOpen: (event: SportEvent) => void }) {
  const normalized = query.trim().toLowerCase()
  const results = normalized ? events.filter((event) => `${event.name} ${event.league} ${event.sport} ${event.homeTeam?.name ?? ''} ${event.awayTeam?.name ?? ''} ${event.broadcastStations.join(' ')}`.toLowerCase().includes(normalized)) : []
  const teams = Array.from(new Map(events.flatMap((event) => [event.homeTeam, event.awayTeam]).filter(Boolean).map((team) => [team!.id, team!])).values()).filter((team) => !normalized || `${team.name} ${team.abbreviation}`.toLowerCase().includes(normalized))
  return <div className="search-page"><div className="search-large"><Icon name="search" size={22} /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search games, teams, leagues, broadcasts" aria-label="Search games, teams, leagues, and broadcasts" /></div>{!normalized ? <EmptyState title="Search the whole desk" body="Type a team, league, matchup, or broadcast network to filter the live sports data Rally has loaded." /> : <><div className="search-summary"><strong>{results.length + teams.length}</strong> results for <span>“{query}”</span></div>{results.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Games</h2></div><div className="event-grid">{results.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} />)}</div></section>}{teams.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Teams</h2></div><div className="team-results">{teams.map((team) => <div className="team-result" key={team.id}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span>{team.abbreviation}</span>}<div><strong>{team.name}</strong><small>{team.abbreviation}</small></div></div>)}</div></section>}{results.length === 0 && teams.length === 0 && <EmptyState title="Nothing matched" body="Try a shorter team name or another league." />}</>}</div>
}

function FavoritesPage({ events, favoriteTeamIds, onOpen, onToggleFavorite }: { events: SportEvent[]; favoriteTeamIds: string[]; onOpen: (event: SportEvent) => void; onToggleFavorite: (teamId: string) => void }) {
  const favoriteEvents = eventsForTeams(events, favoriteTeamIds)
  const teams = Array.from(new Map(events.flatMap((event) => [event.homeTeam, event.awayTeam]).filter((team): team is NonNullable<typeof team> => Boolean(team && favoriteTeamIds.includes(team.id))).map((team) => [team.id, team])).values())
  return <div className="favorites-page"><div className="page-intro"><div><h2>My teams</h2><p>Your saved teams surface their next game here. Favorites stay on this device.</p></div><span className="saved-count">{teams.length} saved</span></div>{teams.length ? <div className="favorite-team-list">{teams.map((team) => <div className="favorite-team" key={team.id}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span className="favorite-team-fallback">{team.abbreviation}</span>}<div><strong>{team.name}</strong><small>{team.abbreviation}</small></div><button className="icon-button is-selected" onClick={() => onToggleFavorite(team.id)} aria-label={`Remove ${team.name} from favorites`}><Icon name="star" size={16} /></button></div>)}</div> : <EmptyState title="Your teams belong here" body="Save a team from any matchup to build a personal watchlist." />}{favoriteEvents.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Next for your teams</h2></div><div className="event-grid">{favoriteEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={onToggleFavorite} />)}</div></section>}</div>
}

function EventDetailPage({ event, sourceState, onBack, onRefresh, onPlay, onCheck, favoriteTeamIds, onToggleFavorite }: { event: SportEvent; sourceState: SourceState; onBack: () => void; onRefresh: () => void; onPlay: (candidate: SourceCandidate) => void; onCheck: (candidate: SourceCandidate) => void; favoriteTeamIds: string[]; onToggleFavorite: (teamId: string) => void }) {
  const [summary, setSummary] = useState(event)
  useEffect(() => {
    let active = true
    void loadEventSummary(event).then((next) => { if (active) setSummary(next) })
    return () => { active = false }
  }, [event])
  const isLiveGame = isLive(summary)
  return <div className="detail-page"><button className="back-link" onClick={onBack}><Icon name="back" size={16} />Back to board</button><section className={`detail-hero ${sportBackdrop(summary.sport)}`}><div className="detail-hero-shade" /><div className="detail-hero-copy"><div className="hero-meta"><span className={isLiveGame ? 'live-dot-label' : 'hero-league'}>{isLiveGame && <span className="live-dot" />}{summary.league}</span><span>{eventStatusLabel(summary)}</span></div><h2>{summary.name}</h2><p>{summary.venue || 'Venue not reported'} {summary.broadcastStations.length ? `· ${summary.broadcastStations.join(', ')}` : ''}</p></div><div className="detail-scoreboard"><div><TeamBadge team={summary.awayTeam} /><strong>{summary.scoreAway ?? '—'}</strong></div><span>{isLiveGame ? 'LIVE' : 'AT'}</span><div><TeamBadge team={summary.homeTeam} /><strong>{summary.scoreHome ?? '—'}</strong></div></div></section><div className="detail-grid"><section className="detail-main"><div className="section-heading"><div><h2>Available sources</h2><p>Only configured services appear here. Rally never supplies subscriptions or streams.</p></div><button className="button button-quiet button-small" onClick={onRefresh} disabled={sourceState.loading}><Icon name="refresh" size={14} />{sourceState.loading ? 'Discovering' : 'Refresh sources'}</button></div>{sourceState.loading && <LoadingState label="Matching configured sources" />}{sourceState.issues.map((issue, index) => <div className={`notice ${issue.provider === 'Configuration' ? 'notice-warning' : 'notice-error'}`} key={`${issue.provider}-${index}`}><Icon name={issue.provider === 'Configuration' ? 'alert' : 'shield'} size={16} /><div><strong>{issue.provider}</strong><span>{issue.message}{issue.detail ? ` · ${issue.detail}` : ''}</span></div></div>)}{!sourceState.loading && sourceState.candidates.length === 0 && sourceState.issues.length === 0 && <EmptyState title="No configured source matched" body="Open Sources & settings to add your authorized IPTV portal or Stremio manifest." action={<a className="button button-primary button-small" href="#sources"><Icon name="settings" size={14} />Configure sources</a>} />}{sourceState.candidates.map((candidate) => <SourceCard key={candidate.id} candidate={candidate} onPlay={() => onPlay(candidate)} onCheck={() => onCheck(candidate)} />)}</section><aside className="detail-aside"><div className="info-panel"><span className="panel-label">GAME STATUS</span><strong>{summary.gameStatusDetail || eventStatusLabel(summary)}</strong><p>{summary.eventContextTitle || `${summary.league} matchup`}</p></div><div className="info-panel"><span className="panel-label">MATCHUP</span><div className="detail-team-row"><TeamBadge team={summary.awayTeam} /><div><strong>{summary.awayTeam?.name ?? 'Away team'}</strong><button className={`team-save ${favoriteTeamIds.includes(summary.awayTeam?.id ?? '') ? 'is-selected' : ''}`} onClick={() => summary.awayTeam && onToggleFavorite(summary.awayTeam.id)}><Icon name="star" size={14} />{favoriteTeamIds.includes(summary.awayTeam?.id ?? '') ? 'Saved' : 'Save team'}</button></div></div><div className="detail-team-row"><TeamBadge team={summary.homeTeam} /><div><strong>{summary.homeTeam?.name ?? 'Home team'}</strong><button className={`team-save ${favoriteTeamIds.includes(summary.homeTeam?.id ?? '') ? 'is-selected' : ''}`} onClick={() => summary.homeTeam && onToggleFavorite(summary.homeTeam.id)}><Icon name="star" size={14} />{favoriteTeamIds.includes(summary.homeTeam?.id ?? '') ? 'Saved' : 'Save team'}</button></div></div></div><div className="info-panel info-panel-note"><Icon name="shield" size={17} /><p>Stream availability, quality, regional restrictions, and rights are controlled by your configured providers.</p></div></aside></div></div>
}

function TeamBadge({ team }: { team?: SportEvent['homeTeam'] }) {
  return team?.logoUrl ? <img className="detail-team-logo" src={team.logoUrl} alt="" /> : <span className="detail-team-logo detail-team-logo-fallback">{team?.abbreviation ?? '—'}</span>
}

function SourcesPage({ config, onSave }: { config: ProviderConfig; onSave: (config: ProviderConfig) => { config: ProviderConfig; errors: string[]; warnings: string[] } }) {
  const [portalUrl, setPortalUrl] = useState(config.portalUrl)
  const [macAddress, setMacAddress] = useState(config.macAddress)
  const [addonUrls, setAddonUrls] = useState(config.addonUrls.join('\n'))
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'warning'; messages: string[] } | null>(null)
  const save = () => {
    const validation = onSave({ portalUrl, macAddress, addonUrls: splitAddonInputs(addonUrls) })
    if (validation.errors.length) {
      setFeedback({ kind: 'error', messages: validation.errors })
      return
    }
    setFeedback({ kind: validation.warnings.length ? 'warning' : 'success', messages: validation.warnings.length ? validation.warnings : ['Configuration saved on this device.'] })
    setPortalUrl(validation.config.portalUrl)
    setMacAddress(validation.config.macAddress)
    setAddonUrls(validation.config.addonUrls.join('\n'))
  }
  return <div className="settings-page"><div className="page-intro"><div><h2>Sources & settings</h2><p>Rally connects directly to services you configure. Credentials stay local to this browser session and are never sent to Rally.</p></div><span className="local-badge"><Icon name="shield" size={14} />LOCAL ONLY</span></div><div className="settings-grid"><section className="settings-panel"><div className="settings-panel-header"><div><span className="panel-label">IPTV / STALKER</span><h3>Your portal</h3></div><span className="settings-index">01</span></div><label className="field-label" htmlFor="portal-url">Portal URL</label><input id="portal-url" className="field" value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} placeholder="https://provider.example/c" autoComplete="off" /><p className="field-help">Rally normalizes common /c and load.php endings. HTTP portals are warned and may be blocked from this HTTPS app.</p><label className="field-label" htmlFor="mac-address">MAC address</label><input id="mac-address" className="field" value={macAddress} onChange={(event) => setMacAddress(event.target.value)} placeholder="00:1A:79:AA:BB:CC" autoComplete="off" /><p className="field-help">Used only for the authorized portal handshake. It is stored locally and never included in diagnostics.</p></section><section className="settings-panel"><div className="settings-panel-header"><div><span className="panel-label">STREMIO</span><h3>Addon manifests</h3></div><span className="settings-index">02</span></div><label className="field-label" htmlFor="addon-urls">Manifest URLs</label><textarea id="addon-urls" className="field field-textarea" value={addonUrls} onChange={(event) => setAddonUrls(event.target.value)} placeholder="https://addon.example/manifest.json" rows={6} autoComplete="off" /><p className="field-help">One manifest per line. Browser discovery requires the addon to allow cross-origin requests and return direct media URLs.</p></section></div>{feedback && <div className={`notice notice-${feedback.kind === 'success' ? 'success' : feedback.kind === 'warning' ? 'warning' : 'error'}`}><Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} /><div>{feedback.messages.map((message) => <span key={message}>{message}</span>)}</div></div>}<div className="settings-actions"><button className="button button-primary" onClick={save}><Icon name="check" size={16} />Save local configuration</button><a className="button button-quiet" href="#home">Return to board</a></div><div className="privacy-panel"><div className="privacy-icon"><Icon name="shield" size={18} /></div><div><h3>Browser boundaries</h3><p>Rally does not proxy, scrape, bypass DRM, or redistribute content. Browser playback can fail when a provider requires CORS, cookies, custom headers, HTTPS, supported codecs, or authorization that a web page cannot provide.</p></div></div></div>
}

function NotFound({ onHome }: { onHome: () => void }) {
  return <EmptyState title="That Rally route is empty" body="The event may have expired or the link is incomplete." action={<button className="button button-primary button-small" onClick={onHome}>Back to home</button>} />
}
