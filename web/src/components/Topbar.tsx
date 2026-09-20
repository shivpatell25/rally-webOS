import { Brand } from './Brand'
import { Icon } from './Icon'
import type { RallyRoute } from '../domain'
import { routeHash, topLevelPage } from '../router'
import { topLevelGate } from '../navigation'

const ITEMS: Array<{ page: 'home' | 'live' | 'leagues' | 'highlights' | 'favorites'; label: string; live?: boolean }> = [
  { page: 'home', label: 'HOME' },
  { page: 'live', label: 'LIVE', live: true },
  { page: 'leagues', label: 'LEAGUES' },
  { page: 'highlights', label: 'HIGHLIGHTS' },
  { page: 'favorites', label: 'MY TEAMS' },
]

/** Android RallyTopBar parity: pill cluster + search/settings, content keeps initial focus. */
export function Topbar({ route }: { route: RallyRoute }) {
  const activePage = topLevelPage(route)
  return (
    <header className="topbar" data-focus-zone="chrome" data-focus-row>
      <Brand />
      <nav className="chrome-nav" aria-label="Primary navigation">
        {ITEMS.map((item) => (
          <a
            key={item.page}
            className={`chrome-nav-item ${activePage === item.page ? 'is-active' : ''}`}
            href={routeHash({ page: item.page })}
            aria-current={activePage === item.page ? 'page' : undefined}
            onClick={(event) => {
              if (!topLevelGate.tryAcquire(`top-level:${item.page}`)) event.preventDefault()
            }}
          >
            {item.live && <span className="chrome-live-dot" aria-hidden="true" />}
            {item.label}
          </a>
        ))}
      </nav>
      <div className="topbar-actions">
        <a
          className="topbar-settings"
          href={routeHash({ page: 'search' })}
          aria-label="Search"
          onClick={(event) => {
            if (!topLevelGate.tryAcquire('top-level:search')) event.preventDefault()
          }}
        >
          <Icon name="search" size={20} />
        </a>
        <a
          className="topbar-settings"
          href={routeHash({ page: 'settings' })}
          aria-label="Settings"
          onClick={(event) => {
            if (!topLevelGate.tryAcquire('top-level:settings')) event.preventDefault()
          }}
        >
          <Icon name="settings" size={20} />
        </a>
      </div>
    </header>
  )
}
