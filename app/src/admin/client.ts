import { app } from '@/tg/sdk';
/** Admin failures carry actionable validation and version-conflict messages. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `tma ${app?.initData ?? ''}`);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? 'Your Telegram session expired. Reopen the app before saving.' : result?.error || result?.reason || 'The request could not finish. Check Recent changes before trying again.');
  return result as T;
}
