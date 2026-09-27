export type LiveNow = { live: boolean; upcoming: boolean; video: string | null; title: string | null; starts: string | null; checked: string };
export function parseLive(html: string, checked: string): LiveNow;
