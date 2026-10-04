import { useBackButton } from "@/tg/hooks";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { APPROVED_RESOURCE_IDS, ReleaseId } from '@shared/resources';
import { resourceRecord, ResourceReadError } from '@/resources/client';
import { ReferenceText, type ScriptureLink } from '@/resources/ReferenceText';
import { Empty, Screen, SearchField } from '@/ui/ui';
import './ResourceInstaller.css';

type PageRow = { key: string; volume: number; page: number; image: number; title: string };
type SourcePage = PageRow & { text: string; scan: string; links: ScriptureLink[] };
export function ResourceReader() {
  useBackButton(false);
  const { id = '', release = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(''), [search, setSearch] = useState('');
  const [volume, setVolume] = useState(1), [printed, setPrinted] = useState('');
  const valid = (APPROVED_RESOURCE_IDS as readonly string[]).includes(id) && ReleaseId.safeParse(release).success;
  const strongs = id === 'strongs';
  const validKey = !params.has('key') || /^(?:page\/\d+\/\d+|entry\/[HG][1-9]\d*)$/.test(params.get('key')!);
  const pages = useQuery({ queryKey: ['resource-pages', id, release], enabled: valid && !strongs, queryFn: () => resourceRecord<PageRow[]>(id, 'pages', release), staleTime: Infinity });
  const key = params.get('key') ?? pages.data?.[0]?.key;
  const page = useQuery({ queryKey: ['resource-page', id, release, key], enabled: valid && validKey && !strongs && !!key, queryFn: () => resourceRecord<SourcePage>(id, key!, release), staleTime: Infinity });
  const results = useQuery({ queryKey: ['resource-search', id, release, search], enabled: valid && !strongs && !!search, queryFn: async () => {
    try { return await resourceRecord<{ keys: string[]; total: number }>(id, `search/${search}`, release); }
    catch (e) { if (e instanceof ResourceReadError && e.status === 404) return { keys: [], total: 0 }; throw e; }
  }, staleTime: Infinity });
  if (!valid || !validKey) return <Screen title="Study resource"><Empty title="This resource link is invalid" /></Screen>;
  if (strongs) return <Navigate replace to={`/lexicon/${/^entry\/[HG][1-9]\d*$/.test(key ?? '') ? key!.split('/')[1] : 'H430'}?release=${release}`} />;
  const at = pages.data?.findIndex((p) => p.key === key) ?? -1;
  const open = (k: string) => { setParams({ key: k }); setSearch(''); };
  const found = new Set(results.data?.keys ?? []);
  return <Screen title={page.data?.title ?? 'Study resource'} kicker="Original edition · OCR transcription">
    <Link to="/resources" className="bs-link">Manage offline resources</Link>
    <SearchField id="resource-search" value={term} onChange={setTerm} placeholder="Find a word in this edition" onSubmit={() => setSearch(term.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{3,40}/)?.[0] ?? '')} />
    {search ? <section aria-label="Search results"><p>{results.isPending ? 'Searching…' : results.isError ? 'Search could not be loaded.' : `${results.data?.total ?? 0} pages contain “${search}”${(results.data?.total ?? 0) > 40 ? ' · showing the first 40' : ''}`}</p>{pages.data?.filter((p) => found.has(p.key)).map((p) => <button type="button" className="bs-resrow" key={p.key} onClick={() => open(p.key)}>{p.title}</button>)}</section> : null}
    {pages.data ? <>
      <form className="resource-reader__controls" onSubmit={(e) => { e.preventDefault(); const target = pages.data.find((p) => p.volume === volume && p.page === Number(printed)); if (target) open(target.key); }}>
        <label>Volume <select aria-label="Volume" value={volume} onChange={(e) => setVolume(Number(e.target.value))}>{[...new Set(pages.data.map((p) => p.volume))].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Page <input aria-label="Printed page" inputMode="numeric" value={printed} onChange={(e) => setPrinted(e.target.value)} /></label><button type="submit" className="bs-link">Go</button>
      </form>
      <nav className="resource-actions" aria-label="Resource pages"><button type="button" disabled={at <= 0} onClick={() => open(pages.data[at - 1].key)}>Previous page</button><button type="button" disabled={at < 0 || at >= pages.data.length - 1} onClick={() => open(pages.data[at + 1].key)}>Next page</button></nav>
    </> : null}
    {pages.isError ? <Empty title="This edition could not be loaded"><button type="button" onClick={() => void pages.refetch()}>Retry</button></Empty> : page.isPending ? <p className="bs-loading">Loading page…</p> : page.isError || !page.data ? <Empty title="This page could not be loaded">Install this edition for offline reading, or reconnect and try again. <button type="button" onClick={() => void page.refetch()}>Retry</button></Empty> : <>
      <p className="hint">OCR can misread names, dates and verse numbers. <a href={page.data.scan} target="_blank" rel="noopener noreferrer">Compare with the original scan</a>.</p>
      <article className="resource-reader__text"><ReferenceText text={page.data.text} links={page.data.links} /></article>
    </>}
  </Screen>;
}
