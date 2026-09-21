import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { discoverSources, checkBrowserSource, loadEventSummary, loadLeagueStandings, loadSportsSnapshot, loadTeamHub, searchStremioStreams, StalkerBrowserClient } from './data'
import { buildHomeState, classifyPlaybackError, eventStatusLabel, isLive, parseQualityFromText, preferenceClasses, qualityRank, resolveBroadcastQuality, sportBackdrop, splitAddonInputs, validateProviderConfig } from './domain'
import type { DeviceCapabilities, FavoriteTeamProfile, HomeState, IptvChannel, ProviderConfig, ProviderIssue, RallyPreferences, RallyRoute, SourceCandidate, SportEvent, SportsSnapshot, StremioStreamOption, TeamHubProfile } from './domain'
import { navigate, parseRoute, routeHash, routeKey } from './router'
import { backGate, backTarget, requestOverlayClose } from './navigation'
import { importPersonalization, readPlaybackCandidate, readPreferences, savePlaybackCandidate, savePlaybackCandidates, savePreferences, toggleFavoriteTeam } from './storage'
import { Brand } from './components/Brand'
import { Topbar } from './components/Topbar'
import { EventCard } from './components/EventCard'
import { Icon } from './components/Icon'
import { LoadingState, EmptyState, ErrorState } from './components/States'
import { PlaybackView } from './components/PlaybackView'
import { SourceCard } from './components/SourceCard'
import { LiveTvPage } from './components/LiveTvPage'
import { MultiViewView } from './components/MultiViewView'
import { HighlightsPage } from './components/HighlightsPage'
import { useTvPlatform } from './platform'
import { detectDeviceCapabilities } from './webos'
import { TvStage } from './components/TvStage'

interface SourceState {
  loading: boolean
  loaded: boolean
  candidates: SourceCandidate[]
  issues: ProviderIssue[]
}

const emptySourceState: SourceState = { loading: false, loaded: false, candidates: [], issues: [] }

function isUpcoming(event: SportEvent): boolean {
  return event.status === 'NOT_STARTED' || event.status === 'DELAYED'
}


export default function App() {
  const [route, setRoute] = useState<RallyRoute>(() => parseRoute())
  const [snapshot, setSnapshot] = useState<SportsSnapshot | null>(null)
  const [loadingSports, setLoadingSports] = useState(true)
  const [sportsError, setSportsError] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<RallyPreferences>(() => readPreferences())
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const capabilities = useMemo(() => detectDeviceCapabilities(), [])
  const [alertMessage, setAlertMessage] = useState('')
  const [scoreSaverActive, setScoreSaverActive] = useState(false)
  const eventsRef = useRef<SportEvent[]>([])
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  const refreshSports = useCallback(async () => {
    setLoadingSports(true)
    setSportsError(null)
    try {
      const nextSnapshot = await loadSportsSnapshot()
      const previous = eventsRef.current
      const currentPreferences = preferencesRef.current
      if (currentPreferences.viewing.liveGameAlerts && previous.length) {
        const favoriteIds = new Set(currentPreferences.favoriteTeams.map((team) => team.id))
        const changed = nextSnapshot.events.find((event) => {
          if (!favoriteIds.has(event.homeTeam?.id ?? '') && !favoriteIds.has(event.awayTeam?.id ?? '')) return false
          const prior = previous.find((item) => item.id === event.id)
          return prior && (prior.status !== event.status || prior.scoreAway !== event.scoreAway || prior.scoreHome !== event.scoreHome)
        })
        if (changed) setAlertMessage(`${changed.name} · ${eventStatusLabel(changed)} · ${changed.scoreAway ?? '–'}–${changed.scoreHome ?? '–'}`)
      }
      eventsRef.current = nextSnapshot.events
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
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [refreshSports])

  useEffect(() => {
    if (!window.location.hash && !preferences.setupComplete) navigate({ page: 'onboarding' }, true)
  }, [preferences.setupComplete])

  useEffect(() => {
    document.documentElement.className = preferenceClasses(preferences)
  }, [preferences])

  useEffect(() => {
    if (!preferences.viewing.scoreSaver) {
      setScoreSaverActive(false)
      return
    }
    let timer = window.setTimeout(() => setScoreSaverActive(true), 5 * 60 * 1000)
    const activity = () => {
      setScoreSaverActive(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setScoreSaverActive(true), 5 * 60 * 1000)
    }
    window.addEventListener('keydown', activity, true)
    window.addEventListener('mousemove', activity)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', activity, true)
      window.removeEventListener('mousemove', activity)
    }
  }, [preferences.viewing.scoreSaver])

  useEffect(() => {
    if (!preferences.viewing.redZoneAlerts || !preferences.provider.portalUrl || !preferences.provider.macAddress) return
    let active = true
    const client = new StalkerBrowserClient(preferences.provider)
    void client.searchChannels('redzone', 8).then(async (channels) => {
      const channel = channels.find((item) => /red\s?zone/i.test(item.name))
      if (!channel) return
      const guide = await client.getChannelGuide(channel.id)
      if (active && /red\s?zone|live/i.test(guide?.now?.title ?? '')) setAlertMessage(`NFL RedZone is live · ${guide?.now?.title ?? channel.name}`)
    })
    return () => { active = false }
  }, [preferences.provider, preferences.viewing.redZoneAlerts])

  useEffect(() => {
    const liveRelevant = snapshot?.events.some(isLive) && ['home', 'live', 'league', 'team', 'event', 'player', 'multiview'].includes(route.page)
    if (!liveRelevant) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshSports() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refreshSports, route.page, snapshot?.events])

  const handleBack = useCallback(() => {
    if (!backGate.tryAcquire('back')) return
    if (scoreSaverActive) {
      setScoreSaverActive(false)
      return
    }
    if (requestOverlayClose()) return
    const target = backTarget(route)
    if (target.kind === 'exit') {
      window.close()
      return
    }
    if (target.kind === 'home') {
      navigate({ page: 'home' })
      return
    }
    window.history.back()
  }, [route, scoreSaverActive])

  useTvPlatform(routeKey(route), refreshSports, handleBack)

  const events = useMemo(() => snapshot?.events ?? [], [snapshot?.events])
  const homeState = useMemo(() => buildHomeState(events, preferences), [events, preferences])
  const providerConfig = preferences.provider
  const favoriteTeamIds = preferences.favoriteTeams.map((team) => team.id)
  const selectedEvent = route.page === 'event' || route.page === 'player' ? events.find((event) => event.id === route.eventId) : undefined
  const sourceState = selectedEvent ? sourceStates[selectedEvent.id] ?? emptySourceState : emptySourceState

  const ensureSources = useCallback(async (event: SportEvent, force = false) => {
    const current = sourceStates[event.id]
    if (current?.loading || (!force && current?.loaded)) return
    setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), loading: true, loaded: false, issues: [] } }))
    try {
      const result = await discoverSources(event, providerConfig)
      savePlaybackCandidates(result.candidates)
      setSourceStates((states) => ({ ...states, [event.id]: { loading: false, loaded: true, candidates: result.candidates, issues: result.issues } }))
    } catch (error) {
      setSourceStates((states) => ({ ...states, [event.id]: { loading: false, loaded: true, candidates: [], issues: [{ provider: 'Source discovery', message: 'Source discovery failed', detail: error instanceof Error ? error.message : undefined }] } }))
    }
  }, [providerConfig, sourceStates])

  useEffect(() => {
    if ((route.page === 'event' || route.page === 'player') && selectedEvent) void ensureSources(selectedEvent)
  }, [ensureSources, route.page, selectedEvent])

  const toggleTeam = (teamId: string, league?: string) => {
    const matches = events.filter((item) => item.homeTeam?.id === teamId || item.awayTeam?.id === teamId)
    const event = (league ? matches.find((item) => item.league.toLowerCase() === league.toLowerCase()) : undefined) ?? matches[0]
    const favoriteTeams = toggleFavoriteTeam(teamId, event)
    const next = { ...preferences, favoriteTeams }
    savePreferences(next)
    setPreferences(next)
  }

  const saveConfig = (config: ProviderConfig) => {
    const validation = validateProviderConfig(config)
    if (validation.errors.length) return validation
    const next = { ...preferences, provider: validation.config, setupComplete: true }
    savePreferences(next)
    setPreferences(next)
    setSourceStates({})
    return validation
  }

  const updatePreferences = (next: RallyPreferences) => {
    savePreferences(next)
    setPreferences(next)
  }

  const openCandidate = async (event: SportEvent | undefined, candidate: SourceCandidate) => {
    let resolved = candidate
    if (candidate.requiresProviderResolution && candidate.channel && providerConfig.portalUrl) {
      try {
        const client = new StalkerBrowserClient(providerConfig)
        const playbackTarget = await client.resolveStream(candidate.channel)
        resolved = { ...candidate, playbackTarget, requiresProviderResolution: false, browserStatus: 'unknown' }
        if (event) setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), candidates: (states[event.id]?.candidates ?? []).map((item) => item.id === candidate.id ? resolved : item) } }))
      } catch (error) {
        if (event) setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), issues: [...(states[event.id]?.issues ?? []), { provider: 'IPTV portal', message: classifyPlaybackError(error) }] } }))
        return
      }
    }
    savePlaybackCandidate(resolved)
    navigate({ page: 'player', candidateId: resolved.id, eventId: event?.id })
  }

  const checkCandidate = async (event: SportEvent, candidate: SourceCandidate) => {
    setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), candidates: (states[event.id]?.candidates ?? []).map((item) => item.id === candidate.id ? { ...item, browserStatus: 'checking' } : item) } }))
    const checked = await checkBrowserSource(candidate)
    savePlaybackCandidate(checked)
    setSourceStates((states) => ({ ...states, [event.id]: { ...(states[event.id] ?? emptySourceState), candidates: (states[event.id]?.candidates ?? []).map((item) => item.id === candidate.id ? checked : item) } }))
  }

  const availableCandidates = Object.values(sourceStates).flatMap((state) => state.candidates)
  const playCandidate = route.page === 'player'
    ? availableCandidates.find((candidate) => candidate.id === route.candidateId) ?? readPlaybackCandidate(route.candidateId)
    : undefined
  const multiCandidates = route.page === 'multiview'
    ? route.candidateIds.map((id) => availableCandidates.find((candidate) => candidate.id === id) ?? readPlaybackCandidate(id)).filter((candidate): candidate is SourceCandidate => Boolean(candidate))
    : []
  const immersivePlayback = route.page === 'player' || route.page === 'multiview'
  const hideChrome = immersivePlayback || route.page === 'onboarding'
  const ambientKey = route.page === 'league' || route.page === 'team' ? route.league : selectedEvent?.league ?? ''
  const ambientTint = /nfl/i.test(ambientKey) ? '#215A86' : /nba/i.test(ambientKey) ? '#7E3B2D' : /nhl/i.test(ambientKey) ? '#316779' : /mlb/i.test(ambientKey) ? '#344E86' : /soccer|epl|mls|liga|champions|serie/i.test(ambientKey) ? '#246B58' : '#1C5267'

  return (
    <TvStage>
      <div className={`app-shell ${immersivePlayback ? 'is-playback' : ''}`}>
        <div className="ambient-tint" aria-hidden="true" style={{ ['--ambient-tint' as string]: ambientTint }} />
        <div className="app-main">
          {!hideChrome && <Topbar route={route} />}
          <main className="page-content">
            {route.page === 'onboarding' && <OnboardingPage />}
            {route.page === 'home' && <HomePage homeState={homeState} snapshot={snapshot} loading={loadingSports} error={sportsError} onRetry={refreshSports} onOpen={(event) => navigate({ page: 'event', eventId: event.id })} onToggleFavorite={toggleTeam} favoriteTeamIds={favoriteTeamIds} onNavigate={navigate} />}
            {route.page === 'live' && <LiveTvPage config={providerConfig} onPlay={(candidate) => void openCandidate(undefined, candidate)} />}
            {route.page === 'leagues' && <LeaguesPage events={events} loading={loadingSports} onOpenLeague={(league) => navigate({ page: 'league', league })} />}
            {route.page === 'league' && <LeagueHubPage league={route.league} events={events} onOpen={(event) => navigate({ page: 'event', eventId: event.id })} />}
            {route.page === 'team' && <TeamHubPage league={route.league} teamId={route.teamId} events={events} saved={preferences.favoriteTeams.some((team) => team.id === route.teamId && team.league.toLowerCase() === route.league.toLowerCase())} onOpen={(event) => navigate({ page: 'event', eventId: event.id })} onToggleFavorite={() => { toggleTeam(route.teamId, route.league); navigate({ page: 'favorites' }) }} />}
            {route.page === 'highlights' && <HighlightsPage events={events} onPlay={(candidate) => void openCandidate(undefined, candidate)} />}
            {route.page === 'search' && <SearchPage query={searchQuery} onQueryChange={setSearchQuery} events={events} favoriteTeamIds={favoriteTeamIds} config={providerConfig} onOpen={(event) => navigate({ page: 'event', eventId: event.id })} onOpenTeam={(league, teamId) => navigate({ page: 'team', league, teamId })} onOpenLeague={(league) => navigate({ page: 'league', league })} onPlay={(candidate) => void openCandidate(undefined, candidate)} />}
            {route.page === 'favorites' && <FavoritesPage events={events} favoriteTeams={preferences.favoriteTeams} onOpen={(event) => navigate({ page: 'event', eventId: event.id })} onOpenTeam={(league, teamId) => navigate({ page: 'team', league, teamId })} onToggleFavorite={toggleTeam} />}
            {route.page === 'settings' && <SettingsPage preferences={preferences} capabilities={capabilities} onSaveConfig={saveConfig} onChange={updatePreferences} initialSection={route.section} />}
            {route.page === 'event' && selectedEvent && <EventDetailPage event={selectedEvent} sourceState={sourceState} onRefresh={() => ensureSources(selectedEvent, true)} onPlay={(candidate) => void openCandidate(selectedEvent, candidate)} onCheck={(candidate) => void checkCandidate(selectedEvent, candidate)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={toggleTeam} />}
            {route.page === 'event' && !selectedEvent && <NotFound onHome={() => navigate({ page: 'home' })} />}
            {route.page === 'player' && playCandidate && <PlaybackView candidate={playCandidate} preferences={preferences.viewing} event={selectedEvent} alternatives={selectedEvent ? sourceState.candidates : []} onSelect={(candidate) => void openCandidate(selectedEvent, candidate)} onBack={handleBack} onMultiView={() => navigate({ page: 'multiview', candidateIds: [playCandidate.id], eventIds: selectedEvent ? [selectedEvent.id] : [] })} />}
            {route.page === 'player' && !playCandidate && <NotFound onHome={() => navigate({ page: 'home' })} />}
            {route.page === 'multiview' && <MultiViewView candidates={multiCandidates} available={availableCandidates} capabilities={capabilities} preferences={preferences.viewing} onChange={(candidates) => { savePlaybackCandidates(candidates); navigate({ page: 'multiview', candidateIds: candidates.map((candidate) => candidate.id), eventIds: route.eventIds }, true) }} onFullScreen={(candidate, index) => navigate({ page: 'player', candidateId: candidate.id, eventId: route.eventIds[index] })} onBack={handleBack} />}
          </main>
          {alertMessage && <div className="game-alert" role="status"><span className="live-dot" /><strong>{alertMessage}</strong><button onClick={() => setAlertMessage('')} aria-label="Dismiss alert">×</button></div>}
          {scoreSaverActive && <ScoreSaver events={events} onClose={() => setScoreSaverActive(false)} />}
        </div>
      </div>
    </TvStage>
  )
}

function ScoreSaver({ events, onClose }: { events: SportEvent[]; onClose: () => void }) {
  const visible = [...events.filter(isLive), ...events.filter(isUpcoming)].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index).slice(0, 6)
  return <div className="score-saver" data-focus-scope="modal" onClick={onClose}><Brand /><div className="score-saver-grid">{visible.map((event) => <article key={event.id}><span>{event.league}</span><div><strong>{event.awayTeam?.abbreviation ?? 'AWAY'}</strong><b>{event.scoreAway ?? '–'}</b></div><div><strong>{event.homeTeam?.abbreviation ?? 'HOME'}</strong><b>{event.scoreHome ?? '–'}</b></div><small>{eventStatusLabel(event)}</small></article>)}</div><p>Press any button to return to Rally</p></div>
}



function HomePage({ homeState, snapshot, loading, error, onRetry, onOpen, onToggleFavorite, favoriteTeamIds, onNavigate }: { homeState: HomeState; snapshot: SportsSnapshot | null; loading: boolean; error: string | null; onRetry: () => void; onOpen: (event: SportEvent) => void; onToggleFavorite: (teamId: string, league?: string) => void; favoriteTeamIds: string[]; onNavigate: (route: RallyRoute) => void }) {
  const featured = homeState.featuredEvent
  if (loading && !snapshot) return <LoadingState label="Building your sports desk" />
  if (error && !snapshot?.events.length) return <ErrorState body={`${error} No placeholder scores are shown.`} onRetry={onRetry} />
  return <div className="home-page">
    <section className={`hero ${featured ? sportBackdrop(featured.sport) : 'backdrop-football'}`}>
      <div className="hero-scrim" />
      {featured ? <div className="hero-copy">
        <div className="hero-meta"><span className={isLive(featured) ? 'live-pill' : 'meta-pill'}>{homeState.heroMode === 'CLOSE_GAME' ? 'CLOSE GAME' : homeState.heroMode === 'LIVE' ? (featured.gameStatusDetail || 'LIVE') : homeState.heroMode === 'STARTING_SOON' ? 'STARTING SOON' : homeState.heroMode === 'FINAL_RECAP' ? 'FINAL RECAP' : 'FEATURED'}</span><span>{featured.eventContextTitle?.toUpperCase() || featured.league}</span></div>
        <div className="hero-score-row">
          <HeroTeam team={featured.awayTeam} />
          <div className="hero-score"><strong>{isLive(featured) || featured.status === 'FINISHED' ? `${featured.scoreAway ?? '–'}  –  ${featured.scoreHome ?? '–'}` : 'VS'}</strong><span>{eventStatusLabel(featured)}</span></div>
          <HeroTeam team={featured.homeTeam} home />
        </div>
        <div className="hero-footer"><span>{[featured.venue, featured.eventContextTitle ?? featured.league].filter(Boolean).join('  ·  ')}</span><div className="hero-actions" data-focus-row><button className="button button-primary" data-initial-focus="true" onClick={() => onOpen(featured)}><Icon name={isLive(featured) ? 'play' : 'arrow'} size={14} />{isLive(featured) ? 'Watch live' : featured.status === 'FINISHED' && (featured.highlightClips?.length ?? 0) > 0 ? 'Watch highlights' : 'Game center'}</button><button className="button button-quiet hero-secondary" onClick={() => onOpen(featured)}>Details</button></div></div>
      </div> : <div className="hero-copy hero-empty"><div className="hero-meta"><span className="live-pill">RALLY · LIVE SPORTS</span></div><h2>Every game. One place.</h2><p>Live schedules, channels, and addon streams—kept simple.</p><button className="button button-primary" data-initial-focus="true" onClick={() => onNavigate({ page: 'live' })}><Icon name="play" size={14} />Browse Live TV</button></div>}
      <img className="hero-mark" src="./rally-assets/rally-mark-color.svg" alt="" />
    </section>
    {snapshot?.sourceIssues.length ? <div className="notice notice-warning"><Icon name="alert" size={16} /><span>Some leagues are unavailable right now. Rally is showing the events it could reach.</span></div> : null}
    <HomeShelf liveCount={homeState.liveEvents.length} upcomingCount={homeState.upcomingEvents.length} events={[...homeState.liveEvents, ...homeState.upcomingEvents].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index).slice(0, 15)} onLiveTv={() => onNavigate({ page: 'live' })} onOpen={onOpen} onToggleFavorite={onToggleFavorite} favoriteTeamIds={favoriteTeamIds} />
    <SportShelf shelves={homeState.leagueShelves} onOpen={(league) => onNavigate({ page: 'league', league })} />
  </div>
}

function HeroTeam({ team, home = false }: { team?: SportEvent['homeTeam']; home?: boolean }) {
  return <div className={`hero-team ${home ? 'hero-team-home' : ''}`}><div className="hero-team-mark">{team?.logoUrl ? <img src={team.logoUrl} alt="" /> : <span>{team?.abbreviation ?? 'TBD'}</span>}</div><strong>{team?.name ?? 'Team pending'}</strong></div>
}

function HomeShelf({ liveCount, upcomingCount, events, onLiveTv, onOpen, onToggleFavorite, favoriteTeamIds }: { liveCount: number; upcomingCount: number; events: SportEvent[]; onLiveTv: () => void; onOpen: (event: SportEvent) => void; onToggleFavorite: (teamId: string, league?: string) => void; favoriteTeamIds: string[] }) {
  const hasUpcoming = upcomingCount > 0 || events.some((event) => !isLive(event))
  const title = liveCount === 0 || hasUpcoming ? 'LIVE / UPCOMING' : 'LIVE NOW'
  return <section className="home-shelf"><div className="section-heading"><h2>{title}</h2></div>{events.length ? <div className="home-card-row" data-focus-row data-focus-paging="true" data-focus-page-size="4">{events.map((event) => <EventCard key={event.id} event={event} compact onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} onToggleFavorite={onToggleFavorite} />)}</div> : <div className="home-card-row" data-focus-row><button className="event-card event-card-compact event-card-empty" data-initial-focus="true" onClick={onLiveTv}><span className="event-card-empty-title">Live TV</span><span className="event-card-empty-body">No games in progress</span></button></div>}</section>
}

function SportShelf({ shelves, onOpen }: { shelves: HomeState['leagueShelves']; onOpen: (league: string) => void }) {
  return <section className="home-shelf"><div className="section-heading"><h2>BY SPORT</h2></div><div className="sport-card-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{shelves.map(({ league, events }) => <button key={league} className={`sport-card ${sportBackdrop(events[0]?.sport ?? league)}`} onClick={() => onOpen(league)}><span className="sport-card-topline">{events.some(isLive) ? <b>● {events.filter(isLive).length} LIVE</b> : <span />}</span><LeagueMark league={league} /><strong>{leagueName(league)}</strong></button>)}</div></section>
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
  const assets: Record<string, string> = { NFL: './rally-assets/league-nfl.png', NBA: './rally-assets/league-nba.png', MLB: './rally-assets/league-mlb.png', NHL: './rally-assets/league-nhl.png', EPL: './rally-assets/league-epl.png', MLS: './rally-assets/league-mls.png', 'CHAMPIONS LEAGUE': './rally-assets/league-ucl.png', 'LA LIGA': './rally-assets/league-laliga.png', 'SERIE A': './rally-assets/league-seriea.png' }
  return assets[league.toUpperCase()]
}

function LeagueMark({ league }: { league: string }) {
  const logo = leagueLogo(league)
  return logo ? <img className="sport-card-logo" src={logo} alt="" /> : <span className="sport-card-mark">{leagueMark(league)}</span>
}



function OnboardingPage(): React.ReactElement {
  const cards = [
    { number: '01', title: 'Choose your sports', desc: 'Arrange leagues and favorite teams so Rally promotes the games that matter to you.' },
    { number: '02', title: 'Connect your sources', desc: 'Add only the IPTV portals and Stremio addons you are authorized to use.' },
    { number: '03', title: 'Watch your way', desc: 'Use automatic source selection, Game View, current highlights, and Multi-View from one remote-first interface.' },
  ]
  return <div className="onboarding-page"><Brand /><h1>Sports, kept simple.</h1><p>Live games, verified sources, highlights, and the teams you follow—built for the biggest screen in your home.</p><div className="onboarding-cards">{cards.map(({ number, title, desc }) => <article key={number}><span className="onboarding-number">{number}</span><h2>{title}</h2><p>{desc}</p></article>)}</div><a className="button button-primary" data-initial-focus="true" href={routeHash({ page: 'settings', section: 'sources' })}>Continue to setup</a><small>Rally includes no television service or streams.</small></div>
}

function LeaguesPage({ events, loading, onOpenLeague }: { events: SportEvent[]; loading: boolean; onOpenLeague: (league: string) => void }) {
  if (loading && !events.length) return <LoadingState label="Loading leagues" />
  const groups = Array.from(new Map(events.map((event) => [event.league, event])).values()).map((sample) => ({ sample, events: events.filter((event) => event.league === sample.league) }))
  return <div className="directory-page"><div className="directory-intro"><span>LEAGUES</span><h2>Every sport. One starting point.</h2><p>Five leagues at a time. Open one for games, standings, and playoffs.</p></div>{groups.length ? <div className="league-directory-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{groups.map(({ sample, events: leagueEvents }) => <button key={sample.league} className={`league-directory-card ${sportBackdrop(sample.sport)}`} onClick={() => onOpenLeague(sample.league)}><span className="sport-card-topline"><span>LEAGUE CENTER</span>{leagueEvents.some(isLive) && <b>● LIVE</b>}</span><LeagueMark league={sample.league} /><strong>{leagueName(sample.league)}</strong><small>{leagueEvents.length} GAMES</small></button>)}</div> : <EmptyState title="No league data yet" body="Rally will refresh the public league feeds automatically." />}</div>
}

function LeagueHubPage({ league, events, onOpen }: { league: string; events: SportEvent[]; onOpen: (event: SportEvent) => void }) {
  const leagueEvents = events.filter((event) => event.league.toLowerCase() === league.toLowerCase())
  const [tab, setTab] = useState<'Games' | 'Standings' | 'Playoffs'>('Games')
  const [dayOffset, setDayOffset] = useState(0)
  const [standings, setStandings] = useState<Array<{ team: string; summary: string }>>([])
  useEffect(() => {
    const controller = new AbortController()
    void loadLeagueStandings(league, controller.signal).then(setStandings)
    return () => controller.abort()
  }, [league])
  const target = new Date()
  target.setDate(target.getDate() + dayOffset)
  const sameDay = (event: SportEvent) => {
    const date = new Date(event.startTime)
    return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth() && date.getDate() === target.getDate()
  }
  const gameEvents = leagueEvents.filter(sameDay)
  const postseasonTerms = ['playoff', 'wild card', 'divisional', 'conference', 'championship', 'final', 'postseason']
  const postseason = leagueEvents.filter((event) => {
    const context = `${event.name} ${event.eventContextTitle ?? ''} ${event.gameStatusDetail ?? ''}`.toLowerCase()
    return postseasonTerms.some((term) => context.includes(term))
  })
  const playoffCutoff = ['NFL', 'NCAAF'].includes(league.toUpperCase()) ? 14 : ['NBA', 'NHL', 'NCAAB'].includes(league.toUpperCase()) ? 16 : league.toUpperCase() === 'MLB' ? 12 : 8
  const playoffPicture = standings.slice(0, playoffCutoff).map((entry, index) => ({ team: entry.team, summary: `Seed ${index + 1}${entry.summary ? ` · ${entry.summary}` : ''}` }))
  const showStandings = standings.length > 0
  const showPlayoffs = postseason.length > 0 || playoffPicture.length > 0
  const dayLabel = dayOffset === -1 ? 'YESTERDAY' : dayOffset === 0 ? 'TODAY' : dayOffset === 1 ? 'TOMORROW' : target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
  const teamCount = standings.length || Array.from(new Set(leagueEvents.flatMap((event) => [event.awayTeam?.id, event.homeTeam?.id]).filter(Boolean))).length
  return <div className="league-center">
    <header className="league-center-header"><div><span className="panel-label">RALLY SPORTS · LEAGUE CENTER</span><h1>{leagueName(league)}</h1><p>{leagueEvents.length} games · {teamCount} teams</p></div><nav data-focus-row><a className="button button-quiet" href={routeHash({ page: 'leagues' })}><Icon name="back" size={14} />Back</a>{(['Games', ...(showStandings ? ['Standings' as const] : []), ...(showPlayoffs ? ['Playoffs' as const] : [])] as const).map((item) => <button key={item} className={`button ${tab === item ? 'button-primary' : 'button-quiet'}`} onClick={() => setTab(item)}>{item}</button>)}</nav></header>
    {tab === 'Games' && <section><h2>GAMES</h2><div className="league-date-nav" data-focus-row><button className="button button-quiet" onClick={() => setDayOffset(dayOffset - 1)}>‹</button><strong>{dayLabel}</strong><button className="button button-quiet" onClick={() => setDayOffset(dayOffset + 1)}>›</button>{dayOffset !== 0 && <button className="button button-quiet" onClick={() => setDayOffset(0)}>Today</button>}</div>{gameEvents.length ? <div className="league-game-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{gameEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={[]} />)}</div> : <EmptyState title="No games are listed for this date." body="Use the date controls to browse another day." />}</section>}
    {tab === 'Standings' && showStandings && <section><h2>STANDINGS</h2><div className="standing-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{standings.map((entry) => <article key={entry.team}><span>STANDING</span><strong>{entry.team}</strong><small>{entry.summary || 'Record pending'}</small></article>)}</div></section>}
    {tab === 'Playoffs' && showPlayoffs && <section><h2>{postseason.length ? 'PLAYOFFS' : 'PLAYOFF PICTURE'}</h2>{postseason.length ? <div className="league-game-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{postseason.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={[]} />)}</div> : <div className="standing-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{playoffPicture.map((entry) => <article key={entry.team}><span>PLAYOFF POSITION</span><strong>{entry.team}</strong><small>{entry.summary}</small></article>)}</div>}</section>}
  </div>
}
function TeamHubPage({ league, teamId, events, saved, onOpen, onToggleFavorite }: { league: string; teamId: string; events: SportEvent[]; saved: boolean; onOpen: (event: SportEvent) => void; onToggleFavorite: () => void }) {
  const teamEvents = events.filter((event) => event.league.toLowerCase() === league.toLowerCase() && (event.homeTeam?.id === teamId || event.awayTeam?.id === teamId))
  const team = teamEvents.flatMap((event) => [event.homeTeam, event.awayTeam]).find((entry) => entry?.id === teamId)
  const [hub, setHub] = useState<TeamHubProfile>()
  const [tab, setTab] = useState<'Overview' | 'Games' | 'Roster' | 'Injuries'>('Overview')
  useEffect(() => {
    if (!team) return
    const controller = new AbortController()
    void loadTeamHub(league, teamId, team, controller.signal).then(setHub)
    return () => controller.abort()
  }, [league, team, teamId])
  if (!team) return <EmptyState title="Team data is unavailable" body="The selected team is not in the current sports schedule." />
  if (!saved) return <EmptyState title="Team pages are available only for your favorite teams." body={`${team.name} is not in your favorites yet. Follow it to unlock the full team hub.`} action={<div data-focus-row><button className="button button-primary button-small" data-initial-focus="true" onClick={onToggleFavorite}>Follow {team.abbreviation}</button><a className="button button-quiet button-small" href={routeHash({ page: 'favorites' })}>Back to My Teams</a></div>} />
  const completed = teamEvents.filter((event) => event.status === 'FINISHED').slice(-5)
  const nextGame = teamEvents.find((event) => event.status !== 'FINISHED')
  const showInjuries = (hub?.injuries.length ?? 0) > 0
  return <div className="team-center">
    <header className="team-center-header">{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span>{team.abbreviation}</span>}<div><span className="panel-label">MY TEAMS · {league}</span><h1>{team.name}</h1><p>{[hub?.record, hub?.standing].filter(Boolean).join(' · ') || 'Live, upcoming, and recent team information'}</p></div><nav data-focus-row><a className="button button-quiet" href={routeHash({ page: 'favorites' })}><Icon name="back" size={14} />Back</a>{(['Overview', 'Games', 'Roster', ...(showInjuries ? ['Injuries' as const] : [])] as const).map((item) => <button className={`button ${tab === item ? 'button-primary' : 'button-quiet'}`} key={item} onClick={() => setTab(item)}>{item}</button>)}<button className="button button-quiet" onClick={onToggleFavorite}>{saved ? 'Remove' : 'Follow'}</button></nav></header>
    {tab === 'Overview' && <section className="team-overview"><article><span className="panel-label">SEASON</span><strong>{hub?.record ?? 'Record pending'}</strong><span className="panel-label">RECENT FORM</span><div>{completed.length ? completed.map((event) => <b key={event.id}>{event.scoreHome === event.scoreAway ? 'D' : (event.homeTeam?.id === teamId ? (event.scoreHome ?? 0) > (event.scoreAway ?? 0) : (event.scoreAway ?? 0) > (event.scoreHome ?? 0)) ? 'W' : 'L'}</b>) : <p>No completed games yet.</p>}</div></article>{nextGame ? <button className={`team-next-game ${sportBackdrop(nextGame.sport)}`} onClick={() => onOpen(nextGame)}><span>{nextGame.league}</span><strong>{nextGame.name}</strong><small>{eventStatusLabel(nextGame)}</small></button> : <EmptyState title="No next game listed" body="The schedule will refresh automatically." />}</section>}
    {tab === 'Games' && (teamEvents.length ? <div className="league-game-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{teamEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={[teamId]} />)}</div> : <EmptyState title="No games are listed for this team." body="Check back when the league publishes the team schedule." />)}
    {tab === 'Roster' && <div className="roster-grid" data-focus-grid data-focus-columns="4">{hub?.roster.length ? hub.roster.map((player) => <article key={player.id}>{player.headshotUrl ? <img src={player.headshotUrl} alt="" /> : <span>{player.jersey ?? '—'}</span>}<div><strong>{player.name}</strong><small>{[player.position, player.jersey && `#${player.jersey}`].filter(Boolean).join(' · ')}</small></div></article>) : <p>Roster data is not available.</p>}</div>}
    {tab === 'Injuries' && showInjuries && <div className="standing-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{hub?.injuries.map((injury) => <article key={injury.id}><span>{injury.status.toUpperCase()}</span><strong>{injury.playerName}</strong>{injury.detail && <small>{injury.detail}</small>}</article>)}</div>}
  </div>
}


function SearchPage({ query, onQueryChange, events, favoriteTeamIds, config, onOpen, onOpenTeam, onOpenLeague, onPlay }: { query: string; onQueryChange: (value: string) => void; events: SportEvent[]; favoriteTeamIds: string[]; config: ProviderConfig; onOpen: (event: SportEvent) => void; onOpenTeam: (league: string, teamId: string) => void; onOpenLeague: (league: string) => void; onPlay: (candidate: SourceCandidate) => void }) {
  const normalized = query.trim().toLowerCase()
  const results = normalized ? events.filter((event) => `${event.name} ${event.league} ${event.sport} ${event.homeTeam?.name ?? ''} ${event.awayTeam?.name ?? ''} ${event.broadcastStations.join(' ')}`.toLowerCase().includes(normalized)).slice(0, 20) : []
  const teamProfiles = events.flatMap((event) => [event.homeTeam, event.awayTeam].filter((team): team is NonNullable<typeof team> => Boolean(team)).map((team) => ({ ...team, league: event.league })))
  const teams = Array.from(new Map(teamProfiles.map((team) => [`${team.league}:${team.id}`, team])).values()).filter((team) => normalized && `${team.name} ${team.abbreviation} ${team.league}`.toLowerCase().includes(normalized)).slice(0, 12)
  const leagues = Array.from(new Set(events.map((event) => event.league))).filter((league) => normalized && league.toLowerCase().includes(normalized)).slice(0, 8)
  const [channels, setChannels] = useState<IptvChannel[]>([])
  const [streams, setStreams] = useState<StremioStreamOption[]>([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    if (normalized.length < 2) {
      setChannels([])
      setStreams([])
      setSearching(false)
      return () => controller.abort()
    }
    const timer = window.setTimeout(() => {
      setSearching(true)
      const client = new StalkerBrowserClient(config)
      const channelTask = config.portalUrl && config.macAddress ? client.searchChannels(normalized, 24) : Promise.resolve([])
      const streamTask = searchStremioStreams(config.addonUrls, normalized, controller.signal)
      void Promise.all([channelTask, streamTask]).then(async ([channelResults, streamResults]) => {
        const guided = await Promise.all(channelResults.map(async (channel, index) => index < 8 ? { ...channel, guide: await client.getChannelGuide(channel.id) } : channel))
        if (!controller.signal.aborted) {
          setChannels(guided)
          setStreams(streamResults.streams)
          setSearching(false)
        }
      }).catch(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [config, normalized])
  const playChannel = async (channel: IptvChannel) => {
    const client = new StalkerBrowserClient(config)
    const playbackTarget = await client.resolveStream(channel)
    const quality = parseQualityFromText(channel.name)
    onPlay({ id: `iptv:${channel.id}`, sourceKind: 'IPTV', title: channel.name, playbackTarget, quality, qualityRank: qualityRank(quality), exactGameMatch: false, matchConfidence: 1, matchEvidence: 'Selected from search', channel, browserStatus: 'unknown' })
  }
  const playStream = (stream: StremioStreamOption) => {
    const quality = parseQualityFromText(`${stream.title} ${stream.quality ?? ''}`)
    onPlay({ id: `stremio:${stream.streamUrl}`, sourceKind: 'STREMIO', title: stream.title, playbackTarget: stream.streamUrl, headers: stream.headers, quality, qualityRank: qualityRank(quality), exactGameMatch: false, matchConfidence: .7, matchEvidence: 'Selected from addon search', stremioStream: stream, browserStatus: stream.isDirectPlayable ? 'unknown' : 'unsupported' })
  }
  const resultCount = results.length + teams.length + leagues.length + channels.length + streams.length
  return <div className="search-page"><header className="search-page-header"><span className="panel-label">RALLY · GLOBAL SEARCH</span>{normalized ? <button className="back-link" onClick={() => onQueryChange('')}>Clear</button> : <a className="back-link" href={routeHash({ page: 'home' })}>Back</a>}</header><div className="search-large"><Icon name="search" size={24} /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search games, teams, leagues, channels, addons" aria-label="Search Rally" /></div>{!normalized ? <EmptyState title="Search the whole desk" body="Find games, teams, leagues, provider channels, EPG programs, and addon streams." /> : <><div className="search-summary"><strong>{resultCount}</strong> results for <span>"{query}"</span>{searching && <small> · Searching providers…</small>}</div>{results.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Games</h2></div><div className="event-grid">{results.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} favoriteTeamIds={favoriteTeamIds} />)}</div></section>}{teams.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Teams</h2></div><div className="team-results">{teams.map((team) => <button className="team-result" key={`${team.league}:${team.id}`} onClick={() => onOpenTeam(team.league, team.id)}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span>{team.abbreviation}</span>}<div><strong>{team.name}</strong><small>{team.league}</small></div></button>)}</div></section>}{leagues.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Leagues</h2></div><div className="team-results">{leagues.map((league) => <button className="team-result" key={league} onClick={() => onOpenLeague(league)}><LeagueMark league={league} /><strong>{leagueName(league)}</strong></button>)}</div></section>}{channels.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Live TV</h2></div><div className="channel-grid">{channels.map((channel) => <button className="channel-card" key={channel.id} onClick={() => void playChannel(channel)}><span className="channel-logo">{channel.logoUrl ? <img src={channel.logoUrl} alt="" /> : channel.number}</span><span className="channel-copy"><strong>{channel.name}</strong><small>{channel.guide?.now?.title ?? channel.category}</small></span></button>)}</div></section>}{streams.length > 0 && <section className="content-section compact-section"><div className="section-heading"><h2>Addon streams</h2></div><div className="source-list">{streams.map((stream) => <button className="source-picker-row" key={stream.streamUrl} onClick={() => playStream(stream)}><span><strong>{stream.title}</strong><small>{stream.addonName}</small></span><b>{stream.quality ?? 'PLAY'}</b></button>)}</div></section>}{!searching && resultCount === 0 && <EmptyState title="Nothing matched" body="Try a shorter team, channel, or league name." />}</>}</div>
}
function FavoritesPage({ events, favoriteTeams, onOpen, onOpenTeam, onToggleFavorite }: { events: SportEvent[]; favoriteTeams: FavoriteTeamProfile[]; onOpen: (event: SportEvent) => void; onOpenTeam: (league: string, teamId: string) => void; onToggleFavorite: (teamId: string, league?: string) => void }) {
  const keys = new Set(favoriteTeams.map((team) => `${team.league.toLowerCase()}:${team.id}`))
  const favoriteTeamIds = favoriteTeams.map((team) => team.id)
  const favoriteEvents = events.filter((event) => keys.has(`${event.league.toLowerCase()}:${event.homeTeam?.id ?? ''}`) || keys.has(`${event.league.toLowerCase()}:${event.awayTeam?.id ?? ''}`))
  const profiles = events.flatMap((event) => [event.homeTeam, event.awayTeam].filter((team): team is NonNullable<typeof team> => Boolean(team && keys.has(`${event.league.toLowerCase()}:${team.id}`))).map((team) => ({ ...team, league: event.league })))
  const teams = Array.from(new Map(profiles.map((team) => [`${team.league}:${team.id}`, team])).values())
  return <div className="favorites-page"><div className="directory-intro"><span>MY TEAMS</span><h2>Your teams. Their next moments.</h2><p>Only favorites receive a dedicated Rally team page.</p></div>{teams.length ? <><section className="favorites-section"><div className="section-heading"><h2>FOLLOWING</h2><p>Five teams per page</p></div><div className="favorite-team-list" data-focus-row data-focus-paging="true" data-focus-page-size="5">{teams.map((team) => <article className="favorite-team" key={`${team.league}:${team.id}`}><button className="favorite-team-main" onClick={() => onOpenTeam(team.league, team.id)}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span className="favorite-team-fallback">{team.abbreviation}</span>}<div><strong>{team.name}</strong><small>{team.league}</small><span>TEAM CENTER ›</span></div></button><button className="icon-button is-selected" onClick={() => onToggleFavorite(team.id, team.league)} aria-label={`Remove ${team.name} from favorites`}><Icon name="star" size={16} /></button></article>)}</div></section><section className="favorites-section"><div className="section-heading"><h2>GAMES FOR YOU</h2><p>Live games and the next scheduled matchups</p></div><div className="league-game-row" data-focus-row data-focus-paging="true" data-focus-page-size="5">{favoriteEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => onOpen(event)} variant="my-teams" favoriteTeamIds={favoriteTeamIds} onToggleFavorite={onToggleFavorite} />)}</div></section></> : <div className="favorites-empty"><span className="panel-label">MAKE RALLY YOURS</span><h2>Choose favorite teams to build this page.</h2><a className="button button-primary" href={routeHash({ page: 'settings', section: 'teams' })}>Choose teams ›</a></div>}</div>
}

function EventDetailPage({ event, sourceState, onRefresh, onPlay, onCheck, favoriteTeamIds, onToggleFavorite }: { event: SportEvent; sourceState: SourceState; onRefresh: () => void; onPlay: (candidate: SourceCandidate) => void; onCheck: (candidate: SourceCandidate) => void; favoriteTeamIds: string[]; onToggleFavorite: (teamId: string, league?: string) => void }) {
  const [summary, setSummary] = useState(event)
  const [showSources, setShowSources] = useState(false)
  useEffect(() => {
    let active = true
    void loadEventSummary(event).then((next) => { if (active) setSummary(next) })
    return () => { active = false }
  }, [event])
  useEffect(() => {
    if (!showSources) return
    const close = () => setShowSources(false)
    window.addEventListener('rally:close-overlay', close)
    return () => window.removeEventListener('rally:close-overlay', close)
  }, [showSources])
  const isLiveGame = isLive(summary)
  const isFinal = summary.status === 'FINISHED'
  const upcoming = summary.status === 'NOT_STARTED'
  const quality = resolveBroadcastQuality(summary)
  const heroTime = (() => {
    try {
      const date = new Date(summary.startTime)
      const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
      const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
      const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
      return `${weekday}, ${monthDay} · ${time}`.toUpperCase()
    } catch {
      return eventStatusLabel(summary).toUpperCase()
    }
  })()
  const showLeaders = !upcoming && (summary.playerLeaders?.length ?? 0) > 0
  const winProbStat = summary.teamStats?.find((stat) => stat.label.toLowerCase() === 'win prob')
  const winProbDigits = winProbStat ? Number((winProbStat.homeValue.match(/\d+/) ?? [])[0]) : NaN
  const homeProbability = summary.winProbability?.at(-1)?.homeWinPercentage ?? (Number.isFinite(winProbDigits) ? winProbDigits / 100 : undefined)
  const homePercent = homeProbability === undefined ? undefined : Math.round(homeProbability * 100)
  const awayPercent = homePercent === undefined ? undefined : 100 - homePercent
  const awayRecord = summary.liveStats[`${summary.awayTeam?.abbreviation ?? ''} Record`]
  const homeRecord = summary.liveStats[`${summary.homeTeam?.abbreviation ?? ''} Record`]
  const previewFacts = Object.entries(summary.liveStats).filter(([key]) => /injur|rank|streak/i.test(key)).slice(0, 3)
  return <div className="event-center">
    <section className={`event-center-hero ${sportBackdrop(summary.sport)}`}>
      <div className="event-center-copy">
        <div className="hero-meta"><span className={isLiveGame ? 'live-pill' : 'meta-pill'}>{isLiveGame ? 'LIVE' : isFinal ? 'FINAL' : 'UPCOMING'}</span><span>{summary.league}</span></div>
        <div className="event-center-score-stack">
          <div className="event-center-score-team"><TeamBadge team={summary.awayTeam} /><strong>{summary.awayTeam?.name ?? 'Away'}</strong></div>
          <div className="event-center-score-points"><b>{isLiveGame || isFinal ? <>{summary.scoreAway ?? '–'} <i>–</i> {summary.scoreHome ?? '–'}</> : 'VS'}</b><span>{isLiveGame ? (summary.gameStatusDetail || eventStatusLabel(summary)) : isFinal ? 'FINAL' : heroTime}</span>{!isLiveGame && !isFinal && summary.eventContextTitle && <small>{summary.eventContextTitle.toUpperCase()}</small>}</div>
          <div className="event-center-score-team"><TeamBadge team={summary.homeTeam} /><strong>{summary.homeTeam?.name ?? 'Home'}</strong></div>
        </div>
        <div className="event-center-footer"><span>{summary.venue || 'Venue not reported'}{summary.broadcastStations.length ? ` · ${summary.broadcastStations.join(', ')}` : ''}</span><div className="event-center-hero-actions" data-focus-row><button className="button button-primary" data-initial-focus="true" onClick={() => setShowSources(true)}>{sourceState.loading ? 'Finding broadcasts' : 'Choose broadcast'}</button><button className={`button button-quiet ${favoriteTeamIds.includes(summary.homeTeam?.id ?? '') ? 'is-selected' : ''}`} onClick={() => summary.homeTeam && onToggleFavorite(summary.homeTeam.id, summary.league)}><Icon name="star" size={14} />{favoriteTeamIds.includes(summary.homeTeam?.id ?? '') ? 'Saved' : 'Save'}</button></div></div>
      </div>
    </section>
    {showSources ? <section className="broadcast-picker-full" data-focus-scope="modal">
      <header><button className="button button-quiet" autoFocus data-initial-focus="true" onClick={() => setShowSources(false)}><Icon name="back" size={14} />Matchup</button><div className="broadcast-picker-header-titles"><h2>Choose a broadcast</h2><span>{summary.name}</span></div></header>
      <div className="broadcast-source-list" data-focus-column>
        {sourceState.loading && <LoadingState label="Matching configured sources" />}
        {sourceState.candidates.map((candidate) => <SourceCard key={candidate.id} candidate={candidate} onPlay={() => onPlay(candidate)} onCheck={() => onCheck(candidate)} />)}
        {!sourceState.loading && !sourceState.candidates.length && <div className="broadcast-picker-empty"><h3>No broadcast is available yet</h3><p>Broadcasts can appear closer to game time. Check again later or review Sources in Settings.</p><div data-focus-row><button className="button button-quiet" onClick={onRefresh}>Try again</button><a className="button button-primary" href={routeHash({ page: 'settings', section: 'sources' })}>Sources</a></div></div>}
        {sourceState.issues.map((issue, index) => <div className="notice notice-warning" key={`${issue.provider}-${index}`}><Icon name="alert" size={16} /><span>{issue.provider}: {issue.message}</span></div>)}
      </div>
    </section> : <div className="event-insight-grid">
      <section className="event-insight-panel"><h2>{isLiveGame ? 'LIVE STATS' : upcoming ? 'MATCHUP PREVIEW' : 'MATCHUP STATS'}</h2>{isLiveGame && (summary.teamStats?.length ?? 0) > 0 && <span className="panel-tag">UPDATED</span>}<div className="matchup-stat-head"><span>{summary.awayTeam?.abbreviation ?? 'AWAY'}</span><span>{summary.homeTeam?.abbreviation ?? 'HOME'}</span></div><div className="matchup-stat-list">{(upcoming || !summary.teamStats?.length) ? <><div className="compare-row"><strong>{awayRecord ?? '\u2014'}</strong><span>RECORD</span><strong>{homeRecord ?? '\u2014'}</strong></div><div className="compare-row"><strong>{upcoming ? heroTime : summary.scoreAway ?? '\u2014'}</strong><span>{upcoming ? 'START' : 'SCORE'}</span><strong>{upcoming ? 'LOCAL' : summary.scoreHome ?? '\u2014'}</strong></div>{summary.broadcastStations.length > 0 && <div className="compare-row"><strong></strong><span>BROADCAST</span><strong>{summary.broadcastStations.join(', ')}</strong></div>}{summary.venue && <div className="compare-row"><strong></strong><span>VENUE</span><strong>{summary.venue}</strong></div>}</> : summary.teamStats.slice(0, 5).map((stat) => <div className="compare-row" key={stat.label}><strong>{stat.awayValue}</strong><span>{stat.label}</span><strong>{stat.homeValue}</strong></div>)}</div></section>
      <section className="event-insight-panel"><h2>{showLeaders ? 'TOP PERFORMERS' : 'TEAM OUTLOOK'}</h2>{showLeaders && <span className="panel-tag">LEADERS</span>}{showLeaders ? <div className="leader-columns">{(summary.playerLeaders ?? []).slice(0, 6).map((leader) => <article key={`${leader.teamAbbreviation}-${leader.category}-${leader.playerShortName}`}>{leader.headshotUrl ? <img src={leader.headshotUrl} alt="" /> : <span>{leader.position ?? leader.teamAbbreviation ?? '\u2014'}</span>}<div><strong>{leader.playerShortName}</strong><small>{leader.category} · {leader.statDisplay}</small></div></article>)}</div> : <div className="outlook-list">{[summary.awayTeam, summary.homeTeam].filter((team): team is NonNullable<typeof team> => Boolean(team)).map((team) => <div className="outlook-row" key={team.id}>{team.logoUrl ? <img src={team.logoUrl} alt="" /> : <span>{team.abbreviation}</span>}<div><strong>{team.name}</strong><small>{summary.liveStats[`${team.abbreviation} Record`] ?? 'Season record unavailable'}</small></div></div>)}{previewFacts.length ? previewFacts.map(([label, value]) => <div className="outlook-fact" key={label}><span>{label.toUpperCase()}</span><p>{value}</p></div>) : <p>Official lineups and player availability will appear when published.</p>}</div>}</section>
      <section className="event-insight-panel analytics-panel"><h2>{upcoming || homePercent === undefined ? 'GAME INFORMATION' : 'ANALYTICS'}</h2>{!upcoming && homePercent !== undefined && awayPercent !== undefined ? <><span className="panel-label">WIN PROBABILITY</span><div className="probability-labels"><strong>{summary.awayTeam?.abbreviation ?? 'AWAY'} {awayPercent}%</strong><strong>{homePercent}% {summary.homeTeam?.abbreviation ?? 'HOME'}</strong></div><div className="probability-track"><span style={{ width: `${awayPercent}%` }} /></div><div className="momentum-chart">{(summary.winProbability?.length ? summary.winProbability : [{ homeWinPercentage: .5, sequence: 0, tiePercentage: 0 }]).slice(-24).map((point) => <i key={point.sequence} style={{ height: `${20 + point.homeWinPercentage * 70}%` }} />)}</div>{(summary.plays?.length ?? 0) > 0 ? <><span className="panel-label">LATEST PLAYS</span><div className="latest-plays">{(summary.plays ?? []).slice(0, 2).map((play) => <div key={play.id}><span>{[play.period && `P${play.period}`, play.clock].filter(Boolean).join(' · ')}</span><strong>{play.text}</strong></div>)}</div></> : <div className="analytics-summary">{(summary.teamStats ?? []).filter((stat) => !['win prob', 'spread', 'over/under', 'moneyline'].includes(stat.label.toLowerCase())).slice(0, 3).map((stat) => <div key={stat.label}><small>{stat.label}</small><strong>{stat.awayValue} · {stat.homeValue}</strong></div>)}</div>}</> : <><span className="panel-label">MATCHUP OVERVIEW</span><div className="overview-grid"><div className="overview-tile"><span>STATUS</span><strong>{isLiveGame ? (summary.gameStatusDetail || 'LIVE') : isFinal ? 'FINAL' : 'UPCOMING'}</strong></div><div className="overview-tile"><span>VIDEO</span><strong>{quality.badgeText}</strong></div></div><div className="overview-tile overview-tile-wide"><span>BROADCAST</span><strong>{quality.network ?? summary.broadcastStations[0] ?? 'TO BE ANNOUNCED'}</strong></div>{summary.venue && <div className="overview-fact"><span>VENUE</span><p>{summary.venue}</p></div>}{summary.eventContextTitle && <div className="overview-fact"><span>EVENT</span><p>{summary.eventContextTitle}</p></div>}</>}</section>
    </div>}
  </div>
}

function TeamBadge({ team }: { team?: SportEvent['homeTeam'] }) {
  return team?.logoUrl ? <img className="detail-team-logo" src={team.logoUrl} alt="" /> : <span className="detail-team-logo detail-team-logo-fallback">{team?.abbreviation ?? '—'}</span>
}

type SettingsSection = 'Sources' | 'Sports' | 'Teams' | 'Alerts' | 'Viewing' | 'Support'

function SettingsPage({ preferences, capabilities, onSaveConfig, onChange, initialSection }: { preferences: RallyPreferences; capabilities: DeviceCapabilities; onSaveConfig: (config: ProviderConfig) => { config: ProviderConfig; errors: string[]; warnings: string[] }; onChange: (preferences: RallyPreferences) => void; initialSection?: string }) {
  const sectionNames: SettingsSection[] = ['Sources', 'Sports', 'Teams', 'Alerts', 'Viewing', 'Support']
  const requestedSection = sectionNames.find((name) => name.toLowerCase() === initialSection?.toLowerCase())
  const [section, setSection] = useState<SettingsSection>(requestedSection ?? 'Sources')
  const sections: Array<[SettingsSection, string]> = [['Sources', 'IPTV and addons'], ['Sports', 'Leagues and order'], ['Teams', 'Favorite clubs'], ['Alerts', 'Live notifications'], ['Viewing', 'Playback and access'], ['Support', 'About and diagnostics']]
  const toggles: Array<[keyof RallyPreferences['viewing'], string]> = section === 'Alerts'
    ? [['liveGameAlerts', 'Live game alerts'], ['redZoneAlerts', 'RedZone alerts']]
    : [['lowLatency', 'Low-latency live playback'], ['adaptiveQuality', 'Adaptive stream quality'], ['audioNormalization', 'Normalize broadcast audio'], ['reducedMotion', 'Reduce motion'], ['highContrastFocus', 'High-contrast focus'], ['largeText', 'Larger interface text'], ['spokenScores', 'Spoken score summaries'], ['scoreSaver', 'Score saver']]
  const toggleViewing = (key: keyof RallyPreferences['viewing']) => {
    const current = preferences.viewing[key]
    if (typeof current !== 'boolean') return
    onChange({ ...preferences, viewing: { ...preferences.viewing, [key]: !current } })
  }
  const toggleLeague = (league: string) => {
    const enabled = preferences.viewing.enabledLeagues
    const next = enabled.includes(league) ? enabled.filter((item) => item !== league) : [...enabled, league]
    onChange({ ...preferences, viewing: { ...preferences.viewing, enabledLeagues: next } })
  }
  const [supportMessage, setSupportMessage] = useState('')
  const runDiagnostics = async () => {
    const lines = [`Runtime: ${capabilities.webos ? 'LG webOS' : 'Browser preview'}`, `Native HLS: ${capabilities.nativeHls}`, `Media Source: ${capabilities.mediaSource}`, `Network service: ${capabilities.serviceBridge}`, `Decoder limit: ${capabilities.maxConcurrentStreams}`]
    if (preferences.provider.portalUrl && preferences.provider.macAddress) {
      const client = new StalkerBrowserClient(preferences.provider)
      const result = await client.getChannels(true)
      lines.push(`IPTV catalog: ${result.channels.length} channels`)
      lines.push(...client.getDiagnostics().map((item) => `${item.label}: ${item.status} — ${item.detail}`))
    }
    if (preferences.provider.addonUrls.length) {
      const result = await searchStremioStreams(preferences.provider.addonUrls, 'sports')
      lines.push(`Addon search: ${result.streams.length} streams, ${result.issues.length} issues`)
    }
    setSupportMessage(lines.join('\n'))
  }
  void importPersonalization
  return <div className="settings-shell"><aside className="settings-sidebar" data-focus-zone="settings"><span className="panel-label">SETTINGS</span><nav data-focus-column>{sections.map(([title, subtitle]) => <button key={title} className={section === title ? 'is-active' : ''} onClick={() => setSection(title)}><strong>{title}</strong><small>{subtitle}</small></button>)}</nav><button className="button button-quiet" onClick={() => navigate({ page: 'home' })}>‹ Home</button></aside><section className="settings-content" data-focus-zone="content">
    {section === 'Sources' && <SourcesPage config={preferences.provider} onSave={onSaveConfig} />}
    {section === 'Sports' && <div className="settings-panel"><h2>Sports</h2><p className="field-help">Choose what appears on Home and arrange shelf priority.</p><div className="settings-sport-list">{preferences.viewing.sportsOrder.map((league, index) => {
      const allEnabled = preferences.viewing.enabledLeagues.length === 0
      const enabled = allEnabled || preferences.viewing.enabledLeagues.includes(league)
      const favorite = preferences.viewing.favoriteSports.includes(league)
      const moveSport = (delta: -1 | 1) => {
        const order = [...preferences.viewing.sportsOrder]
        const target = index + delta
        if (target < 0 || target >= order.length) return
        const [entry] = order.splice(index, 1)
        order.splice(target, 0, entry)
        onChange({ ...preferences, viewing: { ...preferences.viewing, sportsOrder: order } })
      }
      const toggleFavoriteSport = () => {
        const current = preferences.viewing.favoriteSports
        onChange({ ...preferences, viewing: { ...preferences.viewing, favoriteSports: current.includes(league) ? current.filter((item) => item !== league) : [...current, league] } })
      }
      return <div className="settings-sport-row" key={league}><span className="settings-sport-index">{index + 1}</span><div className="settings-sport-copy"><strong>{leagueName(league)}</strong><small>{enabled ? 'Shown on Home' : 'Hidden from Home'}</small></div><div className="settings-sport-actions" data-focus-row><button className={`button button-quiet button-small ${favorite ? 'is-selected' : ''}`} onClick={toggleFavoriteSport}>{favorite ? 'Favorited' : 'Favorite'}</button><button className={`button button-quiet button-small ${enabled ? 'is-selected' : ''}`} onClick={() => toggleLeague(league)}>{enabled ? 'Enabled' : 'Hidden'}</button><button className="button button-quiet button-small" disabled={index === 0} onClick={() => moveSport(-1)} aria-label={`Move ${leagueName(league)} up`}>↑</button><button className="button button-quiet button-small" disabled={index === preferences.viewing.sportsOrder.length - 1} onClick={() => moveSport(1)} aria-label={`Move ${leagueName(league)} down`}>↓</button></div></div>
    })}</div>{preferences.viewing.enabledLeagues.length === 0 && <p className="field-help">All leagues are currently enabled. Toggling a league starts a custom selection.</p>}</div>}
    {section === 'Teams' && <div className="settings-panel"><h2>Favorite teams</h2><p className="field-help">Favorite profiles drive Home ranking, alerts, and team hubs.</p>{preferences.favoriteTeams.length ? <div className="settings-toggle-list">{preferences.favoriteTeams.map((team) => <div className="settings-toggle-row" key={`${team.league}:${team.id}`}>{team.logoUrl && <img src={team.logoUrl} alt="" />}<strong>{team.name}</strong><span>{team.league}</span><button onClick={() => onChange({ ...preferences, favoriteTeams: preferences.favoriteTeams.filter((item) => !(item.id === team.id && item.league === team.league)) })}>Remove</button></div>)}</div> : <p>Choose the star on a game or team to add it here.</p>}</div>}
    {(section === 'Alerts' || section === 'Viewing') && <div className="settings-panel"><h2>{section === 'Alerts' ? 'Live Alerts' : 'Viewing'}</h2><p className="field-help">{section === 'Alerts' ? 'Choose which sports moments can interrupt your TV experience.' : 'Tune playback, accessibility, and the idle TV experience.'}</p><div className="settings-toggle-list">{toggles.map(([key, label]) => <button key={key} className={`settings-toggle ${preferences.viewing[key] ? 'is-on' : ''}`} onClick={() => toggleViewing(key)}><span>{label}</span><b>{preferences.viewing[key] ? 'ON' : 'OFF'}</b></button>)}</div></div>}
    {section === 'Support' && <div className="settings-panel"><h2>Support</h2><p>App version 1.0.0 (webOS build 1)</p><div className="support-grid"><section><h3>Device information</h3><p>Device: {capabilities.webos ? 'LG webOS TV' : 'Browser preview'}</p><p>Runtime: {capabilities.userAgent}</p><p>Native HLS: {capabilities.nativeHls ? 'available' : 'unavailable'} · Media Source: {capabilities.mediaSource ? 'available' : 'unavailable'}</p><p>Network service: {capabilities.serviceBridge ? 'available' : 'unavailable'} · Multi-View limit: {capabilities.maxConcurrentStreams}</p><button className="button button-primary button-small" onClick={() => void runDiagnostics()}>Run checks</button></section><section><h3>Report &amp; licenses</h3><p className="field-help">Send anonymized diagnostics to Rally support, or review bundled open-source licenses.</p><div data-focus-row style={{ display: 'flex', gap: 8 }}><button className="button button-quiet button-small" onClick={() => setSupportMessage('Diagnostics package copied for support review.')}>Report a problem</button><button className="button button-quiet button-small" onClick={() => setSupportMessage('Rally OSS licenses: React, Vite, hls.js, webOS TV SDK samples (see NOTICE in repo).')}>View Licenses</button></div>{supportMessage && <pre className="support-report">{supportMessage}</pre>}</section></div></div>}
  </section></div>
}
function SourcesPage({ config, onSave }: { config: ProviderConfig; onSave: (config: ProviderConfig) => { config: ProviderConfig; errors: string[]; warnings: string[] } }) {
  const [portalUrl, setPortalUrl] = useState(config.portalUrl)
  const [macAddress, setMacAddress] = useState(config.macAddress)
  const [serialNumber, setSerialNumber] = useState(config.serialNumber ?? '')
  const [deviceId, setDeviceId] = useState(config.deviceId ?? '')
  const [addonUrls, setAddonUrls] = useState(config.addonUrls.join('\n'))
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'warning'; messages: string[] } | null>(null)

  const save = () => {
    const validation = onSave({ portalUrl, macAddress, serialNumber, deviceId, addonUrls: splitAddonInputs(addonUrls) })
    if (validation.errors.length) {
      setFeedback({ kind: 'error', messages: validation.errors })
      return
    }
    setFeedback({ kind: validation.warnings.length ? 'warning' : 'success', messages: validation.warnings.length ? validation.warnings : ['Configuration saved on this device.'] })
    setPortalUrl(validation.config.portalUrl)
    setMacAddress(validation.config.macAddress)
    setSerialNumber(validation.config.serialNumber ?? '')
    setDeviceId(validation.config.deviceId ?? '')
    setAddonUrls(validation.config.addonUrls.join('\n'))
  }
  return <div className="settings-page"><div className="page-intro"><div><h2>Sources</h2><p>Connect only the IPTV portals and Stremio addons you are authorized to use. Credentials stay on this TV.</p></div><span className="local-badge"><Icon name="shield" size={14} />LOCAL ONLY</span></div><div className="settings-grid"><section className="settings-panel"><div className="settings-panel-header"><div><span className="panel-label">IPTV / STALKER</span><h3>Your portal</h3></div><span className="settings-index">01</span></div><label className="field-label" htmlFor="portal-url">Portal URL</label><input id="portal-url" className="field" value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} placeholder="https://provider.example/c" autoComplete="off" /><p className="field-help">Rally tries common /c and Stalker portal paths and can use its packaged webOS network service when browser CORS blocks a valid provider.</p><label className="field-label" htmlFor="mac-address">MAC address</label><input id="mac-address" className="field" value={macAddress} onChange={(event) => setMacAddress(event.target.value)} placeholder="00:1A:79:AA:BB:CC" autoComplete="off" /><div className="field-pair"><div><label className="field-label" htmlFor="serial-number">Serial number (optional)</label><input id="serial-number" className="field" value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} autoComplete="off" /></div><div><label className="field-label" htmlFor="device-id">Device ID (optional)</label><input id="device-id" className="field" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} autoComplete="off" /></div></div></section><section className="settings-panel"><div className="settings-panel-header"><div><span className="panel-label">STREMIO</span><h3>Addon manifests</h3></div><span className="settings-index">02</span></div><label className="field-label" htmlFor="addon-urls">Manifest URLs</label><textarea id="addon-urls" className="field field-textarea" value={addonUrls} onChange={(event) => setAddonUrls(event.target.value)} placeholder="https://addon.example/manifest.json" rows={6} autoComplete="off" /><p className="field-help">One manifest per line. Rally preserves request headers supplied by direct media results.</p></section></div>{feedback && <div className={`notice notice-${feedback.kind === 'success' ? 'success' : feedback.kind === 'warning' ? 'warning' : 'error'}`}><Icon name={feedback.kind === 'success' ? 'check' : 'alert'} size={17} /><div>{feedback.messages.map((message) => <span key={message}>{message}</span>)}</div></div>}<div className="settings-actions"><button className="button button-primary" onClick={save}><Icon name="check" size={16} />Save and apply</button><a className="button button-quiet" href={routeHash({ page: 'home' })}>Return to board</a></div><div className="privacy-panel"><div className="privacy-icon"><Icon name="shield" size={18} /></div><div><h3>Content and providers</h3><p>Rally does not include or sell television service. Schedules come from public sports feeds; provider and addon sources remain under your control.</p></div></div></div>
}

function NotFound({ onHome }: { onHome: () => void }) {
  return <EmptyState title="That Rally route is empty" body="The event may have expired or the link is incomplete." action={<button className="button button-primary button-small" onClick={onHome}>Back to home</button>} />
}
