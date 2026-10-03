type Keys = { PRIVACY_KEY?: string; BOT_TOKEN?: string };
export function pid(env: Keys, uid: number | string): Promise<string>;
export function seal(env: Keys, owner: string, value: unknown): Promise<string>;
export function open<T>(env: Keys, owner: string, stored: string | null): Promise<T | null>;
