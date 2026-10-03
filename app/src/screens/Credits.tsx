import { AMBIENT_TRACKS } from "@/lib/ambient";
import { useQuery } from "@tanstack/react-query";
import { recordingJson, type RecordingCredit } from "@/lib/recordings";
import { Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";
import { openLink } from "@/tg/sdk";

export function Credits() {
  useBackButton(true);
  const catalog = useQuery({ queryKey: ["recording-credits"], queryFn: () => recordingJson<{ chapters: RecordingCredit[] }>("/api/recordings/catalog"), staleTime: 300_000 });
  const credits = [...new Map((catalog.data?.chapters ?? []).map((r) => [`${r.readerId}:${r.source}`, r])).values()];
  return <Screen title="Credits"><Section title="Human Narrators">
    <p className="hint">KJV recordings from LibriVox. LibriVox dedicates its recordings to the public domain in the USA. Chapters are trimmed and encoded for the reader.</p>
    {catalog.isError ? <p role="status" className="hint">Credits are unavailable. Please try again when connected.</p> : null}
    {credits.map((r) => <p key={`${r.readerId}:${r.source}`}><b>{r.reader}</b><br /><a href={r.source} onClick={(e) => { e.preventDefault(); openLink(r.source); }}>Recording source</a> · <a href={r.license} onClick={(e) => { e.preventDefault(); openLink(r.license); }}>Public-domain dedication</a></p>)}
    {!catalog.isPending && !catalog.isError && !credits.length ? <p className="hint">No human recordings have been published yet.</p> : null}
  </Section><Section title="Ambient Music and Nature"><p className="hint">Original CC0 recordings, looped and level adjusted for reading.</p>{AMBIENT_TRACKS.map((t) => <p key={t.id}><b>{t.name}</b><br />{t.original} — {t.artist}<br /><a href={t.source} onClick={(e) => { e.preventDefault(); openLink(t.source); }}>Recording source</a> · <a href={t.licenseUrl} onClick={(e) => { e.preventDefault(); openLink(t.licenseUrl); }}>{t.license}</a><br /><small>{t.changes}</small></p>)}</Section></Screen>;
}
