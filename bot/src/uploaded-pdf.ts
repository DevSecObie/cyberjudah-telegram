const UPLOAD_LIMIT = 10 * 1024 * 1024;
const REQUEST_LIMIT = Math.ceil(UPLOAD_LIMIT / 3) * 4 + 16_384;
type Send = (document: ReadableStream<Uint8Array>, file: string, caption: string) => Promise<unknown>;

export class UploadError extends Error {
  constructor(public status: number, public reason: string, message: string) { super(message); }
}
const invalid = () => new UploadError(400, "invalid-pdf", "This is not a supported note or answer PDF.");
const tooBig = () => new UploadError(413, "too-big", "This PDF is too big to send. The limit is 10 MB.");

/** Bound the JSON body even without Content-Length, before parsing its base64 payload. */
export async function pdfRequestBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > REQUEST_LIMIT) throw tooBig();
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > REQUEST_LIMIT) { await reader.cancel(); throw tooBig(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data)); }
  catch { return null; }
}

/** The authenticated route supplies only its own chat and a per-person limiter. No PDF is kept. */
export async function sendUploadedPdf(body: Record<string, unknown>, send: Send | undefined, mayUpload?: () => Promise<boolean>): Promise<Response> {
  if (body.send !== true || Object.keys(body).some(key => !["send", "upload"].includes(key))) throw invalid();
  const upload = body.upload as Record<string, unknown> | null;
  if (!upload || typeof upload !== "object" || Array.isArray(upload)
      || Object.keys(upload).some(key => !["kind", "name", "data"].includes(key))
      || !["note", "answer"].includes(upload.kind as string)
      || typeof upload.name !== "string" || upload.name.length > 512 || typeof upload.data !== "string") throw invalid();
  const encoded = upload.data;
  if (!encoded.length || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw invalid();
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const end = encoded.length - padding;
  if (encoded.slice(0, end).includes("=")) throw invalid();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if ((padding === 2 && alphabet.indexOf(encoded[end - 1]) % 16) || (padding === 1 && alphabet.indexOf(encoded[end - 1]) % 4)) throw invalid();
  const length = encoded.length / 4 * 3 - padding;
  if (length > UPLOAD_LIMIT) throw tooBig();
  if (length < 5) throw invalid();
  if (!mayUpload) throw new UploadError(503, "unavailable", "PDF delivery is not available just now. Try again in a moment.");
  let allowed: boolean;
  try { allowed = await mayUpload(); }
  catch { throw new UploadError(503, "unavailable", "PDF delivery is not available just now. Try again in a moment."); }
  if (!allowed) throw new UploadError(429, "rate-limited", "Please wait a minute before sending another PDF.");
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
  catch { throw invalid(); }
  if (![37, 80, 68, 70, 45].every((value, index) => bytes[index] === value)) throw invalid();
  const clean = upload.name.replace(/[\x00-\x1f\x7f]/g, "").replace(/[^\p{L}\p{N} ._-]/gu, "_").replace(/\.{2,}/g, "_").replace(/^\.+/, "").replace(/\.pdf$/i, "").trim();
  const stem = [...clean].slice(0, 120).join("") || `CyberJudah-${upload.kind}`;
  const filename = `${stem}.pdf`;
  try {
    if (!send) throw new Error("No chat");
    await send(new Response(bytes).body!, filename, stem);
  } catch { throw new UploadError(400, "chat-unavailable", "The bot could not send you the PDF. Open a chat with the bot, press Start, and try again."); }
  return Response.json({ ok: true, sent: true });
}
