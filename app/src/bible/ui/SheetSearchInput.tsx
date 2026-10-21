import { Feather } from "../icons";

/**
 * Bible Strong's SheetSearchInput (common/SheetSearchInput.tsx): a 44 px field with 14 px corners
 * on a 10% black wash, the search icon at 20, 15 px text, and a 44 px ✕ once there is text.
 */
export function SheetSearchInput({ value, onChange, placeholder, onSubmit, label }: { value: string; onChange: (v: string) => void; placeholder: string; onSubmit?: () => void; label?: string }) {
  return (
    <div className="bs-sheetsearch">
      <Feather name="search" size={20} color="var(--bs-default)" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} enterKeyHint="done"
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit?.(); }} />
      {value ? <button type="button" aria-label="Clear search" title="Clear search" onClick={() => onChange("")}><Feather name="x" size={20} /></button> : null}
    </div>
  );
}
