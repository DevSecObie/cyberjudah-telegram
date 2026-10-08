import { useRef, type ReactNode } from "react";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/icons";

/** Keep the native picker while presenting the same control used elsewhere in the app. */
export function StudyFilePicker({ label, onFile }: { label: string; onFile: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  return <><Button appearance="bordered" onClick={() => input.current?.click()}><Icon name="download" size={18} />{label}</Button><input ref={input} type="file" hidden aria-label={label} accept=".json,application/json" onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void onFile(file); }} /></>;
}
export function StudyNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className="study-notice" data-error={error || undefined} role={error ? "alert" : "status"}><Icon name={error ? "alert" : "info"} size={18} /><span>{children}</span></p>;
}
