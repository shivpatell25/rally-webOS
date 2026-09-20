import { Icon } from './Icon'

export function LoadingState({ label = 'Loading live sports data' }: { label?: string }) {
  return <div className="state-panel state-loading" role="status"><span className="loading-mark" /><div><strong>{label}</strong><p>Rally is reaching the configured public feeds.</p></div></div>
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="state-panel state-empty"><div className="state-icon"><Icon name="live" size={24} /></div><div><h2>{title}</h2><p>{body}</p>{action}</div></div>
}

export function ErrorState({ title = 'This feed is unavailable', body, onRetry }: { title?: string; body: string; onRetry?: () => void }) {
  return <div className="state-panel state-error"><div className="state-icon"><Icon name="alert" size={24} /></div><div><h2>{title}</h2><p>{body}</p>{onRetry && <button className="button button-primary button-small" onClick={onRetry}><Icon name="refresh" size={14} />Try again</button>}</div></div>
}
