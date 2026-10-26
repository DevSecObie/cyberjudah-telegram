import { publicDomain } from "../../shared/library-pdf";
import { pdfLinkOk, pdfSig } from "./pdf-link";

export const TELEGRAM_PDF_LIMIT = 50 * 1024 * 1024;
const TOO_LARGE = "This PDF is over Telegram’s 50 MB limit. Use Download the PDF instead.";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
type Book = { title: string; license: string; items: { id: string; label?: string }[]; chapters?: { k: number; vol: number; page: number; end: number }[] };
type ArchiveFile = { name: string; format?: string; size?: string; private?: string | boolean };
type ReadJson = <T>(path: string) => Promise<T | null>;
type Send = (stream: ReadableStream<Uint8Array>, file: string, caption: string) => Promise<unknown>;

class PdfError extends Error {
  constructor(public status: number, message: string, public reason?: string) { super(message); }
}
const unavailable = () => new PdfError(404, "This book does not have a public-domain PDF.");
const tooLarge = () => new PdfError(413, TOO_LARGE, "too-large");
const safeFile = (name: string) => name.length < 250 && !/[\\/\x00-\x1f]/.test(name) && !name.includes("..");

/** Follow only Archive-owned HTTPS redirects, never an arbitrary URL from a caller or metadata. */
async function archive(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  for (let n = 0; n < 5; n++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !/(^|\.)archive\.org$/.test(u.hostname)) throw unavailable();
    const res = await fetcher(u.href, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    const next = res.headers.get("location");
    await res.body?.cancel();
    if (!next) throw unavailable();
    url = new URL(next, u).href;
  }
  throw unavailable();
}

async function resolve(read: ReadJson, slug: unknown, item: unknown, fetcher: typeof fetch) {
  if (typeof slug !== "string" || typeof item !== "string" || !ID.test(slug) || !ID.test(item)) throw new PdfError(400, "Not a library book.");
  const index = await read<{ slug: string }[]>("/api/library/index.json");
  if (!index?.some(b => b.slug === slug)) throw unavailable();
  const book = await read<Book>(`/api/library/${slug}/book.json`);
  if (!book || !publicDomain(book.license) || !book.items?.some(i => i.id === item)) throw unavailable();
  const meta = await archive(`https://archive.org/metadata/${item}`, {}, fetcher);
  if (!meta.ok) throw unavailable();
  const info = await meta.json() as { is_dark?: boolean; metadata?: { "access-restricted-item"?: string }; files?: ArchiveFile[] };
  if (info.is_dark || info.metadata?.["access-restricted-item"] === "true") throw unavailable();
  const files = (info.files ?? []).filter(f => !f.private && safeFile(f.name));
  const pdfs = files.filter(f => /\.pdf$/i.test(f.name) && /^(Text PDF|Image Container PDF|PDF)$/i.test(f.format ?? ""));
  const pdf = pdfs.find(f => f.name === `${item}.pdf`) ?? pdfs.find(f => f.format === "Text PDF") ?? pdfs[0];
  if (!pdf) throw unavailable();
  return { book, item, pdf, files, url: `https://archive.org/download/${item}/${encodeURIComponent(pdf.name)}` };
}

/** The viewer streams from the same allow-list as chat delivery; no PDF is stored here. */
export async function libraryPdf(request: Request, token: string, read: ReadJson, send?: Send, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const m = /^\/api\/library\/pdf\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      const exp = Number(url.searchParams.get("exp"));
      if (!m || !(await pdfLinkOk(token, url.pathname, exp, url.searchParams.get("sig") ?? ""))) return new Response("This link has expired. Ask for the PDF again from the app.", { status: 403 });
      const doc = await resolve(read, m[1], m[2], fetcher);
      const range = request.headers.get("range");
      if (range && !/^bytes=\d*-\d*$/.test(range)) throw new PdfError(416, "Not a PDF page range.");
      const upstream = await archive(doc.url, { headers: range ? { range } : {} }, fetcher);
      if (upstream.status === 416) return new Response(null, { status: 416, headers: { "content-range": upstream.headers.get("content-range") ?? `bytes */${doc.pdf.size}` } });
      if (!upstream.ok || !upstream.body || !/^application\/pdf\b/i.test(upstream.headers.get("content-type") ?? "")) { await upstream.body?.cancel(); throw unavailable(); }
      const headers = new Headers({ "content-type": "application/pdf", "content-disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="${doc.item}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range" });
      for (const key of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) { const value = upstream.headers.get(key); if (value) headers.set(key, value); }
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    const body = await request.json().catch(() => null) as { slug?: unknown; item?: unknown; send?: boolean; printed?: number } | null;
    if (!body || typeof body !== "object" || Object.keys(body).some(k => !["slug", "item", "send", "printed"].includes(k))) throw new PdfError(400, "Not a library PDF request.");
    if (body.send !== undefined && typeof body.send !== "boolean") throw new PdfError(400, "Not a library PDF request.");
    if (body.printed !== undefined && (!Number.isSafeInteger(body.printed) || body.printed < 1)) throw new PdfError(400, "Not a library PDF page.");
    const doc = await resolve(read, body.slug, body.item, fetcher);
    if (body.send) {
      if (Number(doc.pdf.size) > TELEGRAM_PDF_LIMIT) throw tooLarge();
      const res = await archive(doc.url, {}, fetcher);
      if (!res.ok || !res.body || !/^application\/pdf\b/i.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel(); throw unavailable(); }
      if (Number(res.headers.get("content-length")) > TELEGRAM_PDF_LIMIT) { await res.body.cancel(); throw tooLarge(); }
      const reader = res.body.getReader();
      let size = 0, exceeded = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { reader.releaseLock(); controller.close(); return; }
            size += chunk.value.byteLength;
            if (size > TELEGRAM_PDF_LIMIT) { exceeded = true; await reader.cancel(); controller.error(tooLarge()); return; }
            controller.enqueue(chunk.value);
          } catch (e) { await reader.cancel().catch(() => undefined); controller.error(e); }
        },
        cancel: reason => reader.cancel(reason),
      });
      try {
        if (!send) throw new Error("No chat");
        await send(stream, `${doc.item}.pdf`, doc.book.title.slice(0, 1000));
      } catch {
        await reader.cancel().catch(() => undefined);
        if (exceeded) throw tooLarge();
        throw new PdfError(400, "The bot could not send you the file. Open a chat with the bot, press Start, and try again.");
      }
      return Response.json({ ok: true, sent: true });
    }
    let page: number | undefined;
    if (body.printed !== undefined) {
      const vol = doc.book.items.findIndex(i => i.id === doc.item) + 1;
      const chapters = doc.book.chapters?.filter(c => c.vol === vol && c.page <= body.printed! && c.end >= body.printed!) ?? [];
      for (const c of chapters) {
        const chapter = await read<{ item?: string; pages: { page: number; img: number }[] }>(`/api/library/${body.slug}/chapter/${c.k}.json`);
        if (chapter?.item && chapter.item !== doc.item) continue;
        const at = chapter?.pages.find(p => p.page === body.printed);
        // Library img is the zero-based access-page index; Archive's OCR page labels can be absent or wrong.
        if (at && Number.isSafeInteger(at.img) && at.img >= 0) { page = at.img + 1; break; }
      }
      if (page === undefined) throw new PdfError(404, "This printed page could not be located in the PDF. Open PDF from the book instead.");
    }
    const path = `/api/library/pdf/${body.slug}/${doc.item}`;
    const exp = Math.floor(Date.now() / 1000) + 900;
    const signed = `${url.origin}${path}?exp=${exp}&sig=${await pdfSig(token, path, exp)}`;
    return Response.json({ ok: true, url: signed, file: `${doc.item}.pdf`, size: Number(doc.pdf.size) || null, page });
  } catch (error) {
    if (error instanceof PdfError) return Response.json({ ok: false, error: error.message, reason: error.reason }, { status: error.status });
    return Response.json({ ok: false, error: "The PDF could not be loaded just now. Try again in a moment." }, { status: 502 });
  }
}
