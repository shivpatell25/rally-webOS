import { memo, useEffect, useRef, useState } from 'react'
import { eventStatusLabel, sportBackdrop } from '../domain'
import type { SportEvent } from '../domain'
import { Icon } from './Icon'
interface EventCardProps {
  event: SportEvent
  onOpen: () => void
  compact?: boolean
  variant?: 'league' | 'my-teams'
  favoriteTeamIds?: string[]
  onToggleFavorite?: (teamId: string) => void
}

function TeamMark({ logoUrl, abbreviation }: { logoUrl?: string; abbreviation: string }) {
  if (logoUrl) return <img className="team-mark" src={logoUrl} alt="" loading="lazy" />
  return <span className="team-mark team-mark-fallback" aria-hidden="true">{abbreviation.slice(0, 3)}</span>
}

export const EventCard = memo(function EventCard({ event, onOpen, compact = false, variant = 'league', favoriteTeamIds = [], onToggleFavorite }: EventCardProps) {
  const isLive = event.status === 'LIVE' || event.status === 'HALFTIME'
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '1200px', threshold: 0 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <article ref={ref} className={`event-card ${compact ? 'event-card-compact' : ''} ${sportBackdrop(event.sport)} ${isLive ? 'event-card-live' : ''}`}>
      <button className="event-card-main" onClick={onOpen} aria-label={`Open ${event.name}`}>
        {visible && compact && (
          <>
            <div className="event-card-topline">
              <span className={isLive ? 'live-dot-label' : 'event-league'}>{isLive && <span className="live-dot" />}{isLive ? 'LIVE' : event.league}</span>
              <span className="event-card-time">{eventStatusLabel(event)}</span>
            </div>
            <div className="matchup">
              <div className="matchup-team"><TeamMark abbreviation={event.awayTeam?.abbreviation ?? 'AWY'} logoUrl={event.awayTeam?.logoUrl} /></div>
              <div className="matchup-score"><strong>{event.scoreAway ?? '—'}</strong><i>–</i><strong>{event.scoreHome ?? '—'}</strong></div>
              <div className="matchup-team match-team-home"><TeamMark abbreviation={event.homeTeam?.abbreviation ?? 'HME'} logoUrl={event.homeTeam?.logoUrl} /></div>
            </div>
            <div className="event-card-footer"><span>{event.awayTeam?.abbreviation ?? 'AWY'} <i>·</i> {event.homeTeam?.abbreviation ?? 'HME'}</span></div>
          </>
        )}
        {visible && !compact && (
          <div className={`event-card-vertical ${variant === 'my-teams' ? 'event-card-vertical-myteams' : ''}`}>
            <div className="event-card-vertical-top">
              <span className="event-league">{event.league}</span>
              <span className="event-date">{eventStatusLabel(event)}</span>
            </div>
            <div className="event-card-vertical-bottom">
              {variant === 'my-teams' ? (
                <div className="vertical-myteams-content">
                  <strong>{event.awayTeam?.name ?? 'Away'} <small>at</small> {event.homeTeam?.name ?? 'Home'}</strong>
                  <span className="event-league-name">{event.league}</span>
                </div>
              ) : (
                <>
                  <div className="vertical-matchup-logos">
                    <TeamMark abbreviation={event.awayTeam?.abbreviation ?? 'AWY'} logoUrl={event.awayTeam?.logoUrl} />
                    <span>{event.scoreAway && event.scoreHome ? `${event.scoreAway} - ${event.scoreHome}` : 'AT'}</span>
                    <TeamMark abbreviation={event.homeTeam?.abbreviation ?? 'HME'} logoUrl={event.homeTeam?.logoUrl} />
                  </div>
                  <div className="vertical-matchup-names">
                    <strong>{event.awayTeam?.name ?? 'Away'}</strong>
                    <small>at {event.homeTeam?.name ?? 'Home'}</small>
                    <span className="event-venue">{event.venue || 'Venue TBD'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </button>
      {visible && onToggleFavorite && event.homeTeam && event.awayTeam && (
        <div className="event-card-favorites" aria-label="Favorite teams">
          {[event.awayTeam, event.homeTeam].map((team) => (
            <button key={team.id} className={`icon-button ${favoriteTeamIds.includes(team.id) ? 'is-selected' : ''}`} onClick={() => onToggleFavorite(team.id)} aria-label={`${favoriteTeamIds.includes(team.id) ? 'Remove' : 'Add'} ${team.name} ${favoriteTeamIds.includes(team.id) ? 'from' : 'to'} favorites`}><Icon name="star" size={15} /></button>
          ))}
        </div>
      )}
    </article>
  )
})
