import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
export type ScriptureLink = { start: number; end: number; slug: string; chapter: number; verse: number; verseEnd?: number; label: string };
/** Render the original substring, never generated markup or rewritten source text. */
export function ReferenceText({ text, links = [], onRead }: { text: string; links?: ScriptureLink[]; onRead?: () => void }) {
  const pieces: ReactNode[] = []; let offset = 0;
  for (const link of links) {
    if (link.start < offset || link.end > text.length || link.end <= link.start || !/^[a-z0-9-]+$/.test(link.slug)) continue;
    pieces.push(text.slice(offset, link.start));
    pieces.push(<Link key={link.start} to={`/read/${link.slug}/${link.chapter}?v=${link.verse}${link.verseEnd ? `-${link.verseEnd}` : ''}`} onClick={onRead}>{text.slice(link.start, link.end)}</Link>);
    offset = link.end;
  }
  pieces.push(text.slice(offset));
  return <>{pieces.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}
