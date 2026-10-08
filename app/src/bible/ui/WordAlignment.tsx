import { useQuery } from "@tanstack/react-query";
import { data } from "@/api/data";
import { useResourceRelease } from "@/resources/hooks";

/** Uses the published KJV alignment and lexicon; never guesses inflections or grammar. */
export function WordAlignment({ words, onWord }: { words: [string, string[]][]; onWord: (number: string) => void }) {
  const release = useResourceRelease("strongs");
  const index = useQuery({ queryKey: ["strongs-index", release], enabled: release !== undefined, queryFn: () => data.strongsIndex(release), staleTime: Infinity });
  const entries = new Map((index.data ?? []).map(e => [e.n, e]));
  return <section className="word-alignment" aria-label="KJV word alignment">
    <p>King James words with the dictionary forms and meanings linked by the published Strong’s data. Inflected forms and grammatical analysis are not supplied by this source.</p>
    {index.isPending && <p role="status">Loading word details…</p>}
    {index.isError && <p role="alert">Word details could not be loaded. <button type="button" onClick={() => void index.refetch()}>Retry</button></p>}
    <div className="word-alignment__rows">{words.map(([word, numbers], i) => <div key={i} className="word-alignment__row"><strong>{word}</strong><div>{numbers.length ? [...new Set(numbers)].map(n => { const e = entries.get(n); return <button type="button" key={n} onClick={() => onWord(n)}><span lang={n[0] === "H" ? "he" : "el"} dir={n[0] === "H" ? "rtl" : "ltr"}>{e?.lemma ?? ""}</span><span>{e?.xlit ?? ""}</span><b>{n}</b><span>{e?.def ?? "Open word study"}</span></button>; }) : <span>No keyed word in this alignment</span>}</div></div>)}</div>
  </section>;
}
