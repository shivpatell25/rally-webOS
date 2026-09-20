import { eventStatusLabel, sportBackdrop } from '../domain'
import type { SportEvent } from '../domain'
import { Icon } from './Icon'

interface EventCardProps {
  event: SportEvent
  onOpen: () => void
  compact?: boolean
  favoriteTeamIds?: string[]
  onToggleFavorite?: (teamId: string) => void
}

function TeamMark({ logoUrl, abbreviation }: { logoUrl?: string; abbreviation: string }) {
  if (logoUrl) return <img className="team-mark" src={logoUrl} alt="" loading="lazy" />
  return <span className="team-mark team-mark-fallback" aria-hidden="true">{abbreviation.slice(0, 3)}</span>
}

export function EventCard({ event, onOpen, compact = false, favoriteTeamIds = [], onToggleFavorite }: EventCardProps) {
  const isLive = event.status === 'LIVE' || event.status === 'HALFTIME'
  return (
    <article className={`event-card ${compact ? 'event-card-compact' : ''} ${sportBackdrop(event.sport)} ${isLive ? 'event-card-live' : ''}`}>
      <button className="event-card-main" onClick={onOpen} aria-label={`Open ${event.name}`}>
        <div className="event-card-topline">
          <span className={isLive ? 'live-dot-label' : 'event-league'}>{isLive && <span className="live-dot" />}{event.league}</span>
          <span className="event-card-time">{eventStatusLabel(event)}</span>
        </div>
        <div className="matchup">
          <div className="matchup-team"><TeamMark abbreviation={event.awayTeam?.abbreviation ?? 'AWY'} logoUrl={event.awayTeam?.logoUrl} /><span>{event.awayTeam?.abbreviation ?? event.awayTeam?.name ?? 'Away'}</span></div>
          <div className="matchup-score"><strong>{event.scoreAway ?? '—'}</strong><span>at</span><strong>{event.scoreHome ?? '—'}</strong></div>
          <div className="matchup-team matchup-team-home"><TeamMark abbreviation={event.homeTeam?.abbreviation ?? 'HME'} logoUrl={event.homeTeam?.logoUrl} /><span>{event.homeTeam?.abbreviation ?? event.homeTeam?.name ?? 'Home'}</span></div>
        </div>
        <div className="event-card-footer"><span>{event.gameStatusDetail || event.name}</span><Icon name="arrow" size={15} /></div>
      </button>
      {onToggleFavorite && event.homeTeam && event.awayTeam && (
        <div className="event-card-favorites" aria-label="Favorite teams">
          {[event.awayTeam, event.homeTeam].map((team) => (
            <button key={team.id} className={`icon-button ${favoriteTeamIds.includes(team.id) ? 'is-selected' : ''}`} onClick={() => onToggleFavorite(team.id)} aria-label={`${favoriteTeamIds.includes(team.id) ? 'Remove' : 'Add'} ${team.name} ${favoriteTeamIds.includes(team.id) ? 'from' : 'to'} favorites`}><Icon name="star" size={15} /></button>
          ))}
        </div>
      )}
    </article>
  )
}
