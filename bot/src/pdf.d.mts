export function notePdf(note: { kind?: string; title?: string; date?: string; teacher?: string; url?: string; body?: string }, opts?: { site?: string }): Promise<Uint8Array>;
export function pdfName(note: { title?: string; date?: string }): string;
export function longDate(iso: string): string;
