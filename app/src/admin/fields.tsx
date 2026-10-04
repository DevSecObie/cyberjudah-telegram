import type { ReactNode } from 'react';
export function Field({ label, value, onChange, multiline = false, type = 'text', readOnly = false }: { label: string; value?: string | number; onChange: (value: string) => void; multiline?: boolean; type?: string; readOnly?: boolean }) {
  return <label className="cms-field"><span>{label}</span>{multiline ? <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} readOnly={readOnly} rows={4} /> : <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} readOnly={readOnly} />}</label>;
}
export function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (value: string) => void; options: { id: string; title: string }[] }) {
  return <label className="cms-field"><span>{label}</span><select value={value ?? ''} onChange={e => onChange(e.target.value)}><option value="">Choose…</option>{options.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>;
}
export function Strings({ label, values = [], onChange, multiline = false }: { label: string; values?: string[]; onChange: (values: string[]) => void; multiline?: boolean }) {
  return <fieldset className="cms-group"><legend>{label}</legend>{values.map((v, i) => <div key={i}><Field label={`${label} ${i + 1}`} value={v} multiline={multiline} onChange={v => onChange(values.map((x, n) => n === i ? v : x))} /><button type="button" className="link" onClick={() => onChange(values.filter((_, n) => n !== i))}>Remove {label.toLowerCase()} {i + 1}</button></div>)}<button type="button" className="link" onClick={() => onChange([...values, ''])}>Add {label.toLowerCase()}</button></fieldset>;
}
export function Multi({ label, values = [], options, onChange }: { label: string; values?: string[]; options: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="cms-group"><legend>{label}</legend><div className="cms-options">{options.map(v => <label key={v}><input type="checkbox" checked={values.includes(v)} onChange={e => onChange(e.target.checked ? [...values, v] : values.filter(x => x !== v))} />{v}</label>)}</div></fieldset>;
}
export function Group({ title, children }: { title: string; children: ReactNode }) { return <details className="cms-disclosure"><summary>{title}</summary>{children}</details>; }
