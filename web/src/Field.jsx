import { Label } from './ui.jsx'

/** Formularz powstaje z manifestu modelu — nowy model to nowy plik JSON, zero kodu. */
export default function Field({ field, value, onChange, disabled }) {
  const common = 'w-full rounded-xl bg-panel-2 border border-line px-4 py-2.5 text-sm'

  if (field.type === 'textarea') {
    return (
      <div>
        <Label hint={field.help}>{field.label}{field.required && <span className="text-pink"> *</span>}</Label>
        <textarea
          id={field.name}
          name={field.name}
          rows={4}
          disabled={disabled}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${common} resize-y leading-relaxed`}
        />
      </div>
    )
  }

  if (field.type === 'select') {
    const chosen = field.options.find((o) => o.value === value)
    return (
      <div>
        <Label hint={chosen?.hint || field.help}>{field.label}</Label>
        <select id={field.name} name={field.name} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={common}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div>
        <Label hint={field.help}>{field.label}</Label>
        <input
          id={field.name}
          name={field.name}
          type="number"
          disabled={disabled}
          min={field.min}
          max={field.max}
          value={value ?? field.default ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${common} font-mono`}
        />
      </div>
    )
  }

  if (field.type === 'images') {
    // Pełna obsługa referencji wchodzi z Tablicami (Faza 2). Tu tylko uczciwy komunikat.
    return (
      <div>
        <Label hint={field.help}>{field.label}</Label>
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          Wysyłanie własnych obrazów pojawi się razem z Tablicami.
          Na razie wybierz model „z tekstu”.
        </div>
      </div>
    )
  }

  return (
    <div>
      <Label hint={field.help}>{field.label}</Label>
      <input id={field.name} name={field.name} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={common} />
    </div>
  )
}
