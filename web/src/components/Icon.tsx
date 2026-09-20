import type { SVGProps } from 'react'

export type IconName = 'home' | 'live' | 'search' | 'star' | 'settings' | 'arrow' | 'play' | 'back' | 'refresh' | 'external' | 'close' | 'check' | 'shield' | 'alert' | 'chevron'

const paths: Record<IconName, string> = {
  home: 'M3 10.8 12 3l9 7.8V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-10.2Z',
  live: 'M4 9.5a11 11 0 0 0 0 5M7.5 7a7.2 7.2 0 0 0 0 10M20 9.5a11 11 0 0 1 0 5M16.5 7a7.2 7.2 0 0 1 0 10M12 12v.01',
  search: 'm20 20-4.5-4.5M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9L12 3Z',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8-3.2 2-1.2-2-3.4-2.2 1a8.4 8.4 0 0 0-1.8-1L16 5h-4l-.3 2.4a8.4 8.4 0 0 0-1.8 1l-2.2-1-2 3.4 2 1.2a7.2 7.2 0 0 0 0 2.1l-2 1.2 2 3.4 2.2-1a8.4 8.4 0 0 0 1.8 1L12 21h4l.3-2.4a8.4 8.4 0 0 0 1.8-1l2.2 1 2-3.4-2-1.2a7.2 7.2 0 0 0 0-2Z',
  arrow: 'M5 12h13m-5-5 5 5-5 5',
  play: 'm9 6 9 6-9 6V6Z',
  back: 'm15 5-7 7 7 7M8 12h12',
  refresh: 'M20 11a8 8 0 1 0 1 4M20 5v6h-6',
  external: 'M14 4h6v6m0-6-8 8M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  shield: 'M12 3 20 6v5c0 5.2-3.4 8.8-8 10-4.6-1.2-8-4.8-8-10V6l8-3Z',
  alert: 'M12 4 21 20H3L12 4Zm0 5v5m0 3v.01',
  chevron: 'm7 9 5 5 5-5',
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d={paths[name]} />
    </svg>
  )
}
