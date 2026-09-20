export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="Rally">
      <img src={compact ? './rally-assets/rally-mark-color.svg' : './rally-assets/rally-wordmark-color.svg'} alt="Rally" />
    </div>
  )
}
