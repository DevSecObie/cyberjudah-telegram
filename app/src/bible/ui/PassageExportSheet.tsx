import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { data, type Book } from "@/api/data";
import { json } from "@/tg/store";
import type { Relation } from "@/lib/relations";
import { verseAnnotations } from "@/studies/storage";
import { saveFile } from "@/studies/files";
import { passageExport, type ExportChapter, type ExportOptions } from "../passage-export";
import type { Highlight, Link, Note, Tag } from "../store";
import { Button, Sheet, Switch } from "./Sheet";

const OPTIONS: [keyof ExportOptions, string][] = [["text", "Bible text"], ["notes", "Notes"], ["links", "Links"], ["relations", "Your precepts"], ["tags", "Tags"], ["phrases", "Phrase marks"]];
export function PassageExportSheet({ book, chapter, selected, reference, onClose }: { book: Book; chapter: number; selected: number[]; reference: string; onClose: () => void }) {
  const client = useQueryClient();
  const [scope, setScope] = useState(selected.length ? "selection" : "chapter");
  const [options, setOptions] = useState<ExportOptions>({ text: true, notes: true, links: true, relations: true, tags: true, phrases: true });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  const title = scope === "selection" ? reference : scope === "book" ? book.book : `${book.book} ${chapter}`;
  useEffect(() => {
    let canceled = false;
    setBody(""); setError(""); setStatus("");
    void (async () => {
      const ids = scope === "book" ? book.chapterIds : [chapter];
      const chapters: ExportChapter[] = [];
      // Keep requests bounded even for Psalms; unavailable chapters prevent a partial export.
      for (let offset = 0; offset < ids.length; offset += 4) {
        if (canceled) return;
        chapters.push(...await Promise.all(ids.slice(offset, offset + 4).map(async ch => {
          const text = await client.fetchQuery({ queryKey: ["chapter", book.slug, ch], queryFn: () => data.chapter(book.slug, ch), staleTime: Infinity });
          const verses = scope === "selection" ? text.verses.filter(v => selected.includes(v.verse)) : text.verses;
          if (!verses.length || (scope === "selection" && verses.length !== selected.length)) throw new Error("Some scripture could not be loaded. Retry before exporting.");
          const [notes, links, highlights, relations, annotations] = await Promise.all([
            options.notes ? json.get<Record<string, Note>>(`bs_n_${book.slug}_${ch}`, {}) : {},
            options.links ? json.get<Record<string, Link>>(`bs_l_${book.slug}_${ch}`, {}) : {},
            options.tags ? json.get<Record<string, Highlight>>(`bs_h_${book.slug}_${ch}`, {}) : {},
            options.relations ? json.get<Relation[]>(`rel_${book.slug}_${ch}`, []) : [],
            options.phrases ? Promise.all(verses.map(v => verseAnnotations(`${book.slug}-${ch}-${v.verse}`))).then(rows => rows.flat()) : [],
          ]);
          return { slug: book.slug, book: book.book, chapter: ch, verses, notes, links, highlights, relations, annotations };
        })));
      }
      const tags = options.tags ? await json.get<Record<string, Tag>>("bs_tags", {}) : {};
      if (!canceled) setBody(passageExport(title, chapters, options, tags));
    })().catch(() => { if (!canceled) setError("The passage or your study data could not be loaded. Retry before exporting."); });
    return () => { canceled = true; };
  }, [scope, options, retry, book.slug, chapter, selected.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const output = async (copy: boolean) => {
    setBusy(true); setError(""); setStatus("");
    try {
      if (copy) await navigator.clipboard.writeText(body);
      else await saveFile(`${title.replace(/[^a-z0-9]+/gi, "-")}.txt`, body, "text/plain;charset=utf-8");
      setStatus(copy ? "Copied to the clipboard." : "Passage file prepared.");
    } catch { setError(copy ? "Copy is unavailable here. Save the text file instead." : "The file could not be saved. Try copying the passage instead."); }
    finally { setBusy(false); }
  };
  return <Sheet open onClose={onClose} title="Export passage" subTitle={title} height="full">
    <div className="bs-export">
      <label>Passage<select aria-label="Export scope" value={scope} onChange={e => setScope(e.target.value)}>{selected.length > 0 && <option value="selection">Selected verses</option>}<option value="chapter">Whole chapter</option><option value="book">Whole book</option></select></label>
      <fieldset><legend>Include</legend>{OPTIONS.map(([key, label]) => <Switch key={key} label={label} on={options[key]} onChange={on => setOptions({ ...options, [key]: on })} />)}</fieldset>
      {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
      {!body && !error && <p role="status">Preparing passage…</p>}
      {body && <><h3>Preview</h3><pre className="bs-export__preview">{body.slice(0, 2400)}{body.length > 2400 ? "\n… Full passage included in the file." : ""}</pre></>}
      {status && <p role="status">{status}</p>}
      <div className="bs-export__actions"><Button disabled={!body || busy || !Object.values(options).some(Boolean)} onClick={() => void output(false)}>Save text file</Button><Button reverse disabled={!body || busy || !Object.values(options).some(Boolean)} onClick={() => void output(true)}>Copy</Button></div>
    </div>
  </Sheet>;
}
