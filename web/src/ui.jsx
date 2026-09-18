export function Card({ className = '', children, ...rest }) {
  return <div className={`panel ${className}`} {...rest}>{children}</div>
}

export function Label({ children, hint }) {
  return (
    <div className="mb-1.5">
      <span className="text-sm font-semibold text-ink">{children}</span>
      {hint && <p className="text-xs text-muted mt-0.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

export function Alert({ kind = 'info', children, onClose }) {
  const styles = {
    info: 'border-line bg-panel-2 text-ink',
    warn: 'border-orange/40 bg-orange/10 text-orange',
    error: 'border-pink/40 bg-pink/10 text-pink',
    ok: 'border-cyan/40 bg-cyan/10 text-cyan',
  }[kind]
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1">{children}</div>
        {onClose && <button onClick={onClose} className="text-xs opacity-60 hover:opacity-100">zamknij</button>}
      </div>
    </div>
  )
}

export function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Badge({ children, tone = 'default' }) {
  const tones = {
    default: 'border-line text-muted',
    cyan: 'border-cyan/40 text-cyan',
    pink: 'border-pink/40 text-pink',
  }[tone]
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tones}`}>{children}</span>
}

export const credits = (n) => (n == null ? '—' : new Intl.NumberFormat('pl-PL').format(n))
