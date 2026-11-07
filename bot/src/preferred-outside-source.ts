import { isApproved } from './source-policy';

type Page = { title: string; url: string; host: string; html: string };
const SITE = 'https://israelunite.org';

/** The reviewed source list still decides whether IUIC may be read. */
function allowed(address: unknown, hosts: string[]): URL | undefined {
  if (typeof address !== 'string') return;
  try {
    const url = new URL(address);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'israelunite.org' || url.hostname.endsWith('.israelunite.org'))
      && isApproved(url.hostname, hosts)) return url;
  } catch { /* No arbitrary search-result address is fetched. */ }
}

/** IUIC's published page/post text, before other outside search providers. No generated content. */
export async function preferredOutsidePages(query: string, hosts: string[], fetcher: typeof fetch = fetch): Promise<Page[]> {
  if (!isApproved('israelunite.org', hosts)) return [];
  const signal = AbortSignal.timeout(8000);
  const read = async (address: string): Promise<any> => {
    const url = allowed(address, hosts);
    if (!url) return null;
    try {
      const response = await fetcher(url.href, { headers: { 'user-agent': 'CyberJudah/1.0 (+https://cyberjudah.io)', accept: 'application/json' }, redirect: 'error', signal });
      if (!response.ok) return null;
      return JSON.parse((await response.text()).slice(0, 1_500_000));
    } catch { return null; }
  };
  const search = new URL('/wp-json/wp/v2/search', SITE);
  search.search = new URLSearchParams({ search: query, subtype: 'page,post', per_page: '2' }).toString();
  const found = await read(search.href);
  if (!Array.isArray(found)) return [];
  const pages = await Promise.all(found.slice(0, 2).map(async row => {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || !['page', 'post'].includes(row.subtype)) return;
    const endpoint = allowed(row._links?.self?.[0]?.href, hosts);
    const expected = `/wp-json/wp/v2/${row.subtype === 'page' ? 'pages' : 'posts'}/${row.id}`;
    if (!endpoint || endpoint.pathname !== expected) return;
    endpoint.search = '_fields=title,content,link';
    const page = await read(endpoint.href);
    const address = allowed(page?.link, hosts);
    if (!address || page?.content?.protected || typeof page?.content?.rendered !== 'string' || !page.content.rendered.trim()) return;
    const title = typeof page?.title?.rendered === 'string' ? page.title.rendered : typeof row.title === 'string' ? row.title : address.hostname;
    return { title: title.slice(0, 300), url: address.href, host: address.hostname, html: page.content.rendered };
  }));
  return pages.filter((page): page is Page => !!page);
}
