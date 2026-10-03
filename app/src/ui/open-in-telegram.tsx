import { useLocation } from "react-router";

import { telegramLinkFor } from "@/lib/share";
import { haptic, isTelegramWebApp, openLink } from "@/tg/sdk";
import { Icon } from "@/ui/ui";

/**
 * The one "Open in Telegram" control. It reads the environment from tg/sdk and renders nothing
 * inside Telegram, so the app can never offer to relaunch the container it is already running
 * in. Outside, it opens the Mini App at the screen the reader is on (or `to`), so the
 * destination survives the hop.
 */
export function OpenInTelegram({ to, label = "Open in Telegram", className = "btn" }: { to?: string; label?: string; className?: string }) {
  const { pathname, search } = useLocation();
  if (isTelegramWebApp) return null;
  const [path, query = ""] = (to ?? `${pathname}${search}`).split("?");
  return <button type="button" className={className} onClick={() => { haptic("select"); openLink(telegramLinkFor(path, query ? `?${query}` : "")); }}><Icon name="link" size={16} />{label}</button>;
}
