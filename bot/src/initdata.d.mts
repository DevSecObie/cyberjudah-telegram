export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
};
export type InitData = {
  auth_date: number;
  hash: string;
  user?: TelegramUser;
  receiver?: TelegramUser;
  chat?: { id: number; type: string; title?: string; username?: string };
  query_id?: string;
  start_param?: string;
  chat_type?: string;
  chat_instance?: string;
  can_send_after?: string;
  signature?: string;
  [key: string]: unknown;
};
export function validateInitData(initData: unknown, botToken: string, maxAgeSec?: number, now?: number): Promise<InitData | null>;
export function signInitData(fields: Record<string, string | object | number>, botToken: string): Promise<string>;
