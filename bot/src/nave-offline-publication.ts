// The live website remains the publisher of every other mobile download.
const catalogPath = '/offline/catalog.json';
const source = 'https://cyberjudah-telegram.oisrae1.workers.dev';
const files = new Set(['/offline/databases/en/nave.sqlite.zip', '/offline/databases/nave-fr.sqlite.zip']);
type Catalog = { format: string; schemaVersion: number; generatedAt: string; resourceCount: number; resources: Record<string, unknown> };

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (files.has(url.pathname)) return env.ASSETS.fetch(request);
    if (url.pathname !== catalogPath) {
      // Cloudflare uses trailing wildcards to match query strings. Preserve the origin's
      // behavior for other suffixes without forwarding a visitor's credentials.
      return fetch(source + url.pathname + url.search, { method: request.method, redirect: 'manual' });
    }
    try {
      const [origin, release] = await Promise.all([
        fetch(source + catalogPath, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }),
        env.ASSETS.fetch(new Request('https://assets.internal' + catalogPath)),
      ]);
      if (!origin.ok || !release.ok) throw new Error('Offline catalog unavailable');
      const base = await origin.json<Catalog>();
      const nave = await release.json<Catalog>();
      if (base.format !== nave.format || base.schemaVersion !== nave.schemaVersion ||
          !base.resources || base.resourceCount !== Object.keys(base.resources).length ||
          Object.keys(nave.resources).sort().join(',') !== 'database:NAVE:en,database:NAVE:fr') {
        throw new Error('Offline catalog format mismatch');
      }
      const resources = { ...base.resources, ...nave.resources };
      const generatedAt = new Date(Math.max(Date.parse(base.generatedAt), Date.parse(nave.generatedAt))).toISOString();
      const body = { ...base, resources, generatedAt, resourceCount: Object.keys(resources).length };
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=0, must-revalidate', 'access-control-allow-origin': '*' },
      });
    } catch {
      return new Response(null, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
    }
  },
};
