export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? 'brand-compact' : ''}`} href="#home" aria-label="Rally home">
      <img src={compact ? '/rally-assets/rally-mark-color.svg' : '/rally-assets/rally-wordmark-color.svg'} alt="Rally" />
    </a>
  )
}
