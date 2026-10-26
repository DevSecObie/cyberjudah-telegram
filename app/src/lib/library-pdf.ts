import { useQuery } from "@tanstack/react-query";
import type { LibraryBook } from "@/api/data";
import { api } from "@/tg/sdk";
import { publicDomain } from "@shared/library-pdf";

export type LibraryPdfLink = { ok: true; url: string; file: string; size: number | null; page?: number };
export const pdfLink = (slug: string, item: string, at?: { printed?: number }) => api<LibraryPdfLink>("/api/library/pdf", { method: "POST", json: { slug, item, ...at } });

export function useLibraryPdfs(book?: LibraryBook) {
  return useQuery({
    queryKey: ["library-pdfs", book?.slug], enabled: !!book && publicDomain(book.license), staleTime: 5 * 60_000,
    queryFn: async () => (await Promise.all(book!.items.map(async (item, i) => {
      try { await pdfLink(book!.slug, item.id); return { ...item, vol: i + 1 }; } catch { return null; }
    }))).filter(item => item !== null),
  });
}
