import type { Passage } from './ai.mjs';
import type { Env } from './env';
import { publicDomain } from '../../shared/library-pdf';
import { libraryMirror, mirrorKey } from './library-mirror';
import { TELEGRAM_PDF_LIMIT } from './library-pdf';

const SITE = 'https://cyberjudah.io';
export type SourceBook = { slug?: string; source?: unknown; license?: unknown; items?: { id?: string }[] };

/** The existing Telegram action sends our held copy; never offer an unknown or unsendable PDF. */
export async function librarySourcePdf(env: Env, book: SourceBook | null, volume: number): Promise<{ slug: string; item: string } | undefined> {
  const slug = book?.slug, item = Number.isInteger(volume) && volume > 0 ? book?.items?.[volume - 1]?.id : undefined;
  const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
  if (!publicDomain(book?.license) || !slug || !item || !id.test(slug) || !id.test(item)) return;
  try {
    const size = await libraryMirror(env)?.head(mirrorKey(item));
    if (typeof size === 'number' && size > 0 && size <= TELEGRAM_PDF_LIMIT) return { slug, item };
  } catch { /* Optional availability must not prevent an answer. */ }
}

/** Keep the library's recorded address verbatim; never derive a book URL from its title. */
export function originalBookUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return value;
  } catch { /* No recorded web address. */ }
}

/** A recorded image address, not a viewer page or a URL needing an access key. */
export function bookScanUrl(value: unknown): string | undefined {
  const recorded = originalBookUrl(value);
  if (!recorded) return;
  const url = new URL(recorded);
  if ([...url.searchParams.keys()].some(key => /^(?:api[_-]?key|access_token|token|key|authorization)$/i.test(key))) return;
  const image = /\.(?:jpe?g|png|webp)$/i.test(url.pathname);
  const bookReader = /(^|\.)archive\.org$/.test(url.hostname) && /\/BookReaderImages\.php$/.test(url.pathname) && url.searchParams.has('zip') && url.searchParams.has('file');
  return image || bookReader ? recorded : undefined;
}

/** The public pinned reader lives under /app; older clients also need a complete address. */
export function withAskBookLinks<T extends Passage>(sources: T[]): T[] {
  return sources.map(source => {
    if (source.kind !== 'book') return source;
    const result = { ...source };
    if (!originalBookUrl(result.original)) delete result.original;
    if (!bookScanUrl(result.scan)) delete result.scan;
    try {
      const url = new URL(source.url, SITE);
      if (url.origin === SITE && !url.username && !url.password && /^\/(?:app\/)?resources\/[a-z0-9-]+\/[a-z0-9-]+\/?$/.test(url.pathname)) {
        result.url = `${SITE}${url.pathname.startsWith('/app/') ? '' : '/app'}${url.pathname}${url.search}${url.hash}`;
      }
    } catch { /* Preserve unrelated links. */ }
    return result;
  });
}
