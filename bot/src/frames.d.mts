export type StoryboardLevel = { level: number; w: number; h: number; frames: number; rows: number; cols: number; sheets: number; interval: number; url: (n: number) => string };
export type PublicLevel = Omit<StoryboardLevel, "url">;
export function extractStoryboard(html: string): { spec: string; duration: number } | null;
export function parseStoryboard(spec: string, duration?: number): StoryboardLevel[];
export function publicLevel(l: StoryboardLevel | PublicLevel): PublicLevel;
export function locate(level: PublicLevel, t: number): { sheet: number; row: number; col: number; frame: number };
export function pickLevel<T extends PublicLevel>(levels: T[], width: number): T | null;
