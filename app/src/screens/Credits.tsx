import { AMBIENT_TRACKS } from "@/lib/ambient";
import { CREDIT_GROUPS } from "@/lib/credits";
import { useQuery } from "@tanstack/react-query";
import { recordingJson, type RecordingCredit } from "@/lib/recordings";
import { Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";
import { openLink } from "@/tg/sdk";

const Out = ({ href, children }: { href: string; children: string }) => <a href={href} onClick={(e) => { e.preventDefault(); openLink(href); }}>{children}</a>;

export function Credits() {
  useBackButton();
  const catalog = useQuery({ queryKey: ["recording-credits"], queryFn: () => recordingJson<{ chapters: RecordingCredit[] }>("/api/recordings/catalog"), staleTime: 300_000 });
  const credits = [...new Map((catalog.data?.chapters ?? []).map((r) => [`${r.readerId}:${r.source}`, r])).values()];
  return <Screen title="Credits">
    {CREDIT_GROUPS.map((g) => <Section key={g.title} title={g.title}>
      {g.note ? <p className="hint">{g.note}</p> : null}
      {g.items.map((c) => <p key={c.name}><b>{c.name}</b>{c.by ? <><br />{c.by}</> : null}<br />
        {c.licenseUrl ? <Out href={c.licenseUrl}>{c.license}</Out> : c.license}
        {c.source ? <> · <Out href={c.source}>Source</Out></> : null}
        {c.changes ? <><br /><small>Changed: {c.changes}</small></> : null}
      </p>)}
    </Section>)}
    <Section title="Human Narrators">
    <p className="hint">KJV recordings from LibriVox. LibriVox dedicates its recordings to the public domain in the USA. Chapters are trimmed and encoded for the reader.</p>
    {catalog.isError ? <p role="status" className="hint">Credits are unavailable. Please try again when connected.</p> : null}
    {credits.map((r) => <p key={`${r.readerId}:${r.source}`}><b>{r.reader}</b><br /><Out href={r.source}>Recording source</Out> · <Out href={r.license}>Public-domain dedication</Out></p>)}
    {!catalog.isPending && !catalog.isError && !credits.length ? <p className="hint">No human recordings have been published yet.</p> : null}
  </Section><Section title="Ambient Music and Nature"><p className="hint">Original CC0 recordings, looped and level adjusted for reading.</p>{AMBIENT_TRACKS.map((t) => <p key={t.id}><b>{t.name}</b><br />{t.original} — {t.artist}<br /><Out href={t.source}>Recording source</Out> · <Out href={t.licenseUrl}>{t.license}</Out><br /><small>{t.changes}</small></p>)}</Section></Screen>;
}
