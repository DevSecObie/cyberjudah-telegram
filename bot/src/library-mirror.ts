/** Our own copies of the public-domain library PDFs, one file per archive.org item at
 * library/<item>.pdf. library-pdf.ts reads here first and falls back to archive.org, so a book
 * that has not been copied yet (or a store that is down) still opens. */
export type Mirror = {
  /** The file's size in bytes, or null when we hold no copy. */
  head(key: string): Promise<number | null>;
  /** The file (whole, or the one byte range asked for), or null when we hold no copy. */
  get(key: string, range?: string): Promise<Response | null>;
};

/** The part of an R2 bucket binding used here (structural, so the app's type check needs no Workers types). */
type Bucket = {
  head(key: string): Promise<{ size: number } | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<{ body: ReadableStream; httpEtag?: string } | null>;
};

export const mirrorKey = (item: string) => `library/${item}.pdf`;

const pdfHeaders = (etag?: string) => {
  const headers = new Headers({ "content-type": "application/pdf", "accept-ranges": "bytes" });
  if (etag) headers.set("etag", etag);
  return headers;
};

/** "bytes=a-b", "bytes=a-" or "bytes=-n" against a file of `size` bytes; null when it cannot be met. */
export function byteRange(range: string, size: number): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (m[1] === "" && m[2] === "") || size <= 0) return null;
  if (m[1] === "") {
    const n = Math.min(Number(m[2]), size);
    return n > 0 ? { offset: size - n, length: n } : null;
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start < size && end >= start ? { offset: start, length: end - start + 1 } : null;
}

/** A Cloudflare R2 bucket bound to the Worker. */
export function r2Mirror(bucket: Bucket): Mirror {
  return {
    async head(key) {
      const object = await bucket.head(key);
      return object ? object.size : null;
    },
    async get(key, range) {
      const object = await bucket.head(key);
      if (!object) return null;
      const size = object.size;
      if (!range) {
        const body = await bucket.get(key);
        if (!body) return null;
        const headers = pdfHeaders(body.httpEtag);
        headers.set("content-length", String(size));
        return new Response(body.body, { status: 200, headers });
      }
      const part = byteRange(range, size);
      if (!part) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      const body = await bucket.get(key, { range: part });
      if (!body) return null;
      const headers = pdfHeaders(body.httpEtag);
      headers.set("content-length", String(part.length));
      headers.set("content-range", `bytes ${part.offset}-${part.offset + part.length - 1}/${size}`);
      return new Response(body.body, { status: 206, headers });
    },
  };
}

/** A plain HTTPS file host we own (one fixed origin, no redirects followed). */
export function originMirror(origin: string, fetcher: typeof fetch = fetch): Mirror {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("The library origin must be a plain HTTPS URL.");
  const at = (key: string) => new URL(key.split("/").map(encodeURIComponent).join("/"), base.href.endsWith("/") ? base.href : `${base.href}/`).href;
  return {
    async head(key) {
      const res = await fetcher(at(key), { method: "HEAD", redirect: "manual" });
      await res.body?.cancel();
      const size = Number(res.headers.get("content-length"));
      return res.ok && /^application\/pdf\b/i.test(res.headers.get("content-type") ?? "") && size > 0 ? size : null;
    },
    async get(key, range) {
      const res = await fetcher(at(key), { headers: range ? { range } : {}, redirect: "manual" });
      if (res.status === 416) return res;
      if (!res.ok || !res.body || !/^application\/pdf\b/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel(); return null; }
      return res;
    },
  };
}

/** Whichever copy this Worker is configured with: an R2 binding, a file host, or none (archive.org only). */
export function libraryMirror(env: { LIBRARY?: Bucket; LIBRARY_ORIGIN?: string }): Mirror | undefined {
  if (env.LIBRARY) return r2Mirror(env.LIBRARY);
  if (env.LIBRARY_ORIGIN) return originMirror(env.LIBRARY_ORIGIN);
  return undefined;
}
