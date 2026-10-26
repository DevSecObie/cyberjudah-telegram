export const publicDomain = (license: unknown): boolean => typeof license === "string" && /^public domain(?:[.!]|$)/i.test(license.trim());

export const libraryPdfHref = (slug: string, vol = 1, printed?: number, page?: number): string => {
  const params = new URLSearchParams({ vol: String(vol) });
  if (page !== undefined) params.set("page", String(page));
  else if (printed !== undefined) params.set("printed", String(printed));
  return `/books/${encodeURIComponent(slug)}/pdf?${params}`;
};
