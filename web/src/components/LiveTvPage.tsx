import { useCallback, useEffect, useMemo, useState } from 'react'
import { StalkerBrowserClient } from '../data'
import { parseQualityFromText, qualityRank } from '../domain'
import type { IptvChannel, ProviderConfig, SourceCandidate } from '../domain'
import { routeHash } from '../router'
import { Icon } from './Icon'
import { EmptyState, ErrorState, LoadingState } from './States'

interface LiveTvPageProps {
  config: ProviderConfig
  onPlay: (candidate: SourceCandidate) => void
}

export function LiveTvPage({ config, onPlay }: LiveTvPageProps) {
  const [channels, setChannels] = useState<IptvChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState('All channels')
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const client = useMemo(() => new StalkerBrowserClient(config), [config])

  const load = useCallback(async () => {
    if (!config.portalUrl || !config.macAddress) return
    setLoading(true)
    setError(null)
    const result = await client.getChannels()
    setChannels(result.channels)
    const sportsCategory = result.channels.map((channel) => channel.category).find((item) => /sport/i.test(item))
    if (sportsCategory) setCategory(sportsCategory)
    setError(result.issue ? [result.issue.message, result.issue.detail].filter(Boolean).join(' · ') : null)
    setLoading(false)
    const guides = await Promise.all(result.channels.slice(0, 8).map(async (channel) => [channel.id, await client.getChannelGuide(channel.id)] as const))
    setChannels((current) => current.map((channel) => {
      const guide = guides.find(([id]) => id === channel.id)?.[1]
      return guide ? { ...channel, guide } : channel
    }))
  }, [client, config])

  useEffect(() => { void load() }, [load])

  const categories = useMemo(() => ['All channels', ...Array.from(new Set(channels.map((channel) => channel.category).filter(Boolean))).sort()], [channels])
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return channels.filter((channel) => (category === 'All channels' || channel.category === category) && (!normalized || `${channel.number} ${channel.name} ${channel.category}`.toLowerCase().includes(normalized)))
  }, [category, channels, query])

  const loadGuide = async (channel: IptvChannel) => {
    if (channel.guide) return
    const guide = await client.getChannelGuide(channel.id)
    if (guide) setChannels((current) => current.map((item) => item.id === channel.id ? { ...item, guide } : item))
  }
  const open = async (channel: IptvChannel) => {
    setOpening(channel.id)
    setError(null)
    try {
      const playbackTarget = await client.resolveStream(channel)
      const quality = parseQualityFromText(channel.name)
      onPlay({ id: `iptv:${channel.id}`, sourceKind: 'IPTV', title: channel.name, playbackTarget, quality, qualityRank: qualityRank(quality), exactGameMatch: false, matchConfidence: 1, matchEvidence: 'Selected from Live TV', channel, browserStatus: 'unknown' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The channel could not be opened.')
    } finally {
      setOpening(null)
    }
  }

  if (!config.portalUrl || !config.macAddress) return <EmptyState title="Live TV needs your provider" body="Add the portal URL and MAC address supplied by your authorized IPTV provider." action={<a className="button button-primary" href={routeHash({ page: 'settings', section: 'sources' })}><Icon name="settings" size={16} />Open settings</a>} />
  if (loading && !channels.length) return <LoadingState label="Loading your channels" />
  if (error && !channels.length) return <ErrorState body={error} onRetry={() => void load()} />

  return <div className="iptv-page"><aside className="iptv-sidebar" data-focus-zone="categories"><span className="panel-label">LIVE TV</span><nav data-focus-column>{categories.map((item) => <button className={item === category ? 'is-active' : ''} key={item} onClick={() => setCategory(item)}>{item}</button>)}</nav><a className="button button-quiet" href={routeHash({ page: 'home' })}>‹ Sports</a></aside><section className="iptv-content" data-focus-zone="content"><header><div><h2>{category}</h2><p>{visible.length} channels · {channels.length} total</p></div><label className="iptv-search"><Icon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search channels" aria-label="Search channels" /></label></header>{error && <div className="notice notice-error"><Icon name="alert" size={16} /><span>{error}</span></div>}{visible.length ? <div className="channel-grid" data-focus-grid data-focus-columns="3">{visible.map((channel) => { const quality = parseQualityFromText(channel.name); return <button className="channel-card" key={channel.id} onFocus={() => void loadGuide(channel)} onClick={() => void open(channel)} disabled={opening === channel.id}><span className="channel-logo">{channel.logoUrl ? <img src={channel.logoUrl} alt="" /> : channel.number || channel.name.slice(0, 2)}</span><span className="channel-copy"><strong>{channel.name}</strong><small>{channel.guide?.now?.title ? `Now · ${channel.guide.now.title}` : channel.category || 'Live TV'}</small>{channel.guide?.next?.title && <small>Next · {channel.guide.next.title}</small>}</span>{quality.resolution && <b>{quality.resolution}</b>}</button>})}</div> : <EmptyState title={query ? `No results for “${query}”` : 'No channels in this category'} body="Try another category or search term." />}</section></div>
}
