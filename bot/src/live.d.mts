export type LiveNow = { live: boolean; upcoming: boolean; video: string | null; title: string | null; starts: string | null; checked: string };
export function parseLive(html: string, checked: string): LiveNow;
export type RecentVideo = { video: string; title: string; published: string; views: number | null };
export function cleanTitle(raw: string): string;
export function parseFeed(xml: string): RecentVideo[];
export function parseChannelVideos(html: string, now?: number): RecentVideo[];
