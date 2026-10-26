import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { data } from "@/api/data";
import { pdfLink, useLibraryPdfs } from "@/lib/library-pdf";
import { useBackButton } from "@/tg/hooks";
import { alert, api, ApiError, downloadFile, features, haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Empty, Icon, Loading, Screen } from "@/ui/ui";
import { publicDomain } from "@shared/library-pdf";
import "@/styles/screens/book-pdf.css";

GlobalWorkerOptions.workerSrc = workerUrl;
const positive = (value: string | null, fallback = 1) => /^\d+$/.test(value ?? "") && Number(value) > 0 && Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
const clampZoom = (value: number) => Math.min(4, Math.max(1, value));

export function BookPdfScreen() {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const sheet = useSheet();
  useBackButton();
  const book = useQuery({ queryKey: ["library", slug], queryFn: () => data.libraryBook(slug), staleTime: Infinity });
  const pdfs = useLibraryPdfs(book.data);
  const vol = positive(params.get("vol"));
  const requestedPage = positive(params.get("page"));
  const item = book.data?.items[vol - 1];
  const printed = params.has("printed") ? positive(params.get("printed")) : undefined;
  const file = useQuery({
    queryKey: ["library-pdf", slug, item?.id, printed],
    queryFn: () => pdfLink(slug, item!.id, { printed }),
    enabled: !!item && publicDomain(book.data?.license), staleTime: 5 * 60_000, retry: false,
    refetchInterval: 12 * 60_000, refetchOnWindowFocus: true,
  });
  const page = file.data?.page ?? requestedPage;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [jump, setJump] = useState(String(page));
  const [exporting, setExporting] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const go = (next: number) => {
    const n = Math.min(doc?.numPages ?? next, Math.max(1, next));
    setParams(p => { const q = new URLSearchParams(p); q.set("page", String(n)); q.delete("printed"); return q; }, { replace: true });
  };
  useEffect(() => { setJump(String(page)); }, [page]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [book.data]);
  useEffect(() => {
    setDoc(null); setError("");
    if (!file.data?.url) return;
    let disposed = false;
    setBusy(true);
    const task = getDocument({ url: file.data.url, isEvalSupported: false, disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024 });
    task.promise.then(pdf => { if (!disposed) { setDoc(pdf); setBusy(false); } }).catch(() => { if (!disposed) { setBusy(false); setError("This PDF did not load. Try again in a moment."); } });
    return () => { disposed = true; void task.destroy(); };
  }, [file.data?.url]);
  useEffect(() => {
    if (!doc || !width || !canvas.current) return;
    let disposed = false;
    let rendering: RenderTask | undefined;
    const target = canvas.current;
    setBusy(true); setError("");
    const n = Math.min(doc.numPages, page);
    if (n !== page) go(n);
    void doc.getPage(n).then(async pdfPage => {
      if (disposed) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.max(1, width - 16) / base.width * zoom;
      const view = pdfPage.getViewport({ scale });
      // Bound canvas memory on high-DPR phones and at large zoom levels.
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (view.width * view.height)));
      target.width = Math.ceil(view.width * dpr); target.height = Math.ceil(view.height * dpr);
      target.style.width = `${view.width}px`; target.style.height = `${view.height}px`;
      rendering = pdfPage.render({ canvas: target, viewport: view, transform: [dpr, 0, 0, dpr, 0, 0] });
      await rendering.promise;
      if (!disposed) { target.dataset.page = String(n); setBusy(false); }
    }).catch(e => { if (!disposed && e?.name !== "RenderingCancelledException") { setBusy(false); setError("This page did not load. Try another page or reopen the PDF."); } });
    return () => { disposed = true; rendering?.cancel(); };
  }, [doc, page, width, zoom]);
  useEffect(() => { if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } }, [page, item?.id]);

  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };
  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoom(clampZoom(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance)));
    } else { e.currentTarget.scrollLeft += prev.x - e.clientX; e.currentTarget.scrollTop += prev.y - e.clientY; }
  };
  const pointerUp = (e: PointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId); pinch.current = null; };
  const exportPdf = async () => {
    haptic("select");
    const action = await sheet.open({ title: "Export as PDF", items: [
      ...(features.download ? [{ id: "download", text: "Download the PDF", hint: "Saved to this device" }] : []),
      { id: "send", text: "Send it to my Telegram chat", hint: "The CyberJudah bot sends you the file" },
    ] });
    if (!action || !item || exporting) return;
    setExporting(true);
    try {
      if (action.id === "send") {
        await api("/api/library/pdf", { method: "POST", json: { slug, item: item.id, send: true } });
        haptic("success"); void alert("Sent. The PDF is in your chat with the CyberJudah bot.");
      } else {
        const link = await pdfLink(slug, item.id);
        downloadFile(`${link.url}&download=1`, link.file);
      }
    } catch (e) {
      void alert(e instanceof ApiError && e.reason === "too-large" ? "This PDF is over Telegram’s 50 MB limit. Use Download the PDF instead." : action.id === "send" ? "The bot could not send the file. Open a chat with the CyberJudah bot, press Start, and try again." : "The PDF could not be loaded just now. Try again in a moment.");
    } finally { setExporting(false); }
  };

  if (book.isPending) return <Screen title="Library"><Loading /></Screen>;
  if (!book.data || !publicDomain(book.data.license) || !item) return <Screen title="Library"><Empty title="This book does not have a public-domain PDF" /><Link to={`/books/${slug}`}>Back to the book</Link></Screen>;
  return <Screen title={book.data.title} kicker="PDF · Original printing" className="bookpdf" action={<button type="button" className="icon-btn" aria-label="Export as PDF" title="Export as PDF" disabled={exporting || !doc} onClick={() => void exportPdf()}><Icon name="download" size={18} /></button>}>
    {book.data.items.length > 1 ? <label className="bookpdf__volume">Volume <select aria-label="PDF volume" value={vol} onChange={e => { setZoom(1); setParams({ vol: e.target.value, page: "1" }, { replace: true }); }}>
      {(pdfs.data ?? book.data.items.map((i, n) => ({ ...i, vol: n + 1 }))).map(i => <option key={i.id} value={i.vol}>{i.label || `Volume ${i.vol}`}</option>)}
    </select></label> : null}
    <div className="bookpdf__controls" role="group" aria-label="PDF page controls">
      <button type="button" className="icon-btn" aria-label="Previous page" disabled={!doc || page <= 1} onClick={() => go(page - 1)}><Icon name="back" size={20} /></button>
      <form onSubmit={e => { e.preventDefault(); go(positive(jump)); }}><label>Page <input aria-label="PDF page" type="number" inputMode="numeric" min="1" max={doc?.numPages ?? 1} value={jump} onChange={e => setJump(e.target.value)} disabled={!doc} /></label><span> / {doc?.numPages ?? "…"}</span><button type="submit" className="btn btn--bordered btn--sm" disabled={!doc}>Go</button></form>
      <button type="button" className="icon-btn" aria-label="Next page" disabled={!doc || page >= doc.numPages} onClick={() => go(page + 1)}><Icon name="chevron" size={20} /></button>
    </div>
    <div className="bookpdf__zoom" role="group" aria-label="PDF zoom controls">
      <button className="btn btn--bordered btn--sm" type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => clampZoom(z - .25))}>−</button>
      <button className="btn btn--bordered btn--sm" type="button" onClick={() => setZoom(1)}>Fit width</button>
      <output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
      <button className="btn btn--bordered btn--sm" type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(z => clampZoom(z + .25))}>+</button>
    </div>
    {(busy || file.isPending) && !file.isError ? <p role="status" className="hint">Loading PDF…</p> : null}
    {file.isError || error ? <Empty title={error || "This PDF did not load"}>The original may be unavailable, or this printed page could not be located. <button type="button" className="bs-link" onClick={() => { setError(""); if (printed !== undefined) go(1); else void file.refetch(); }}>Try again from the first page</button></Empty> : null}
    <div className="bookpdf__viewport" ref={viewport} tabIndex={0} aria-label="PDF page viewer" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <canvas ref={canvas} aria-label={`PDF page ${page}`} role="img" />
    </div>
    <Link className="bs-link" to={`/books/${slug}`}>Back to the book</Link>
  </Screen>;
}
