import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { SITE_URL } from "@/api/data";
import { ApiError } from "@/tg/sdk";
import { app, haptic, isTelegramWebApp, openLink } from "@/tg/sdk";
import { OpenInTelegram } from "@/ui/open-in-telegram";
import { Icon, type IconName } from "@/ui/ui";

/**
 * What went wrong and what to do about it, when Search or Ask cannot answer. Each failure is
 * named for what it is (a launch that has gone stale, a part of the service resting, no
 * connection, a browser outside Telegram) and comes with ways on that do not depend on the
 * same call succeeding.
 */
type Health = { ok: boolean; search: { ok: boolean }; teachings: { ok: boolean }; ask: { model: string } };
type Action = { label: string; icon: IconName; onClick: () => void; primary?: boolean };

export type Diagnosis = { kind: "telegram" | "session" | "offline" | "resting" | "limit" | "unknown"; status?: number };
export function diagnose(e: unknown): Diagnosis {
  if (e instanceof ApiError) {
    // No launch data in a browser: this part runs through Telegram. Inside Telegram it can only be
    // a launch that came without (or with aged) launch data: reopening fixes it, Telegram is not reopened.
    if (e.status === 401) return { kind: isTelegramWebApp ? "session" : "telegram", status: 401 };
    if (e.status === 429) return { kind: "limit", status: 429 };
    if (e.status >= 500 || e.status === 503) return { kind: "resting", status: e.status };
    return { kind: "unknown", status: e.status };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
  if (e instanceof TypeError) return { kind: "offline" };
  return { kind: "unknown" };
}

export function Trouble({ error, what, q, onRetry }: { error: unknown; what: "search" | "ask"; q?: string; onRetry?: () => void }) {
  const navigate = useNavigate();
  const d = diagnose(error);
  const health = useQuery({ queryKey: ["health"], enabled: d.kind === "resting" || d.kind === "unknown", queryFn: () => fetch("/api/health").then((r) => r.json() as Promise<Health>), staleTime: 30_000, retry: false });
  const site = q ? `${SITE_URL}/${what === "ask" ? "teachings" : "teachings"}?q=${encodeURIComponent(q)}` : SITE_URL;
  const reopen = () => { haptic("select"); if (app) app.close(); else window.location.reload(); };
  const part = health.data ? (!health.data.teachings.ok ? "the index of what was said in the classes" : !health.data.search.ok ? "the search index" : null) : null;

  const title = d.kind === "telegram" ? (what === "ask" ? "Ask CyberJudah works inside Telegram" : "Searching the classes works inside Telegram")
    : d.kind === "session" ? "Your Telegram session has gone stale"
    : d.kind === "offline" ? "No connection"
    : d.kind === "limit" ? "Too many requests just now"
    : what === "ask" ? "CyberJudah could not answer" : "Search could not answer";
  const why = d.kind === "telegram" ? `CyberJudah is open in a browser. ${what === "ask" ? "Asking" : "Searching the classes"} runs through the Telegram app, which signs each request. The Bible, the classes, the Law, People and the Library all work here.`
    : d.kind === "session" ? "Telegram signs the app when it opens and the signature has aged out. Closing CyberJudah and opening it again renews it in a second; nothing is lost."
    : d.kind === "offline" ? "The app cannot reach the server. The Bible, your bookmarks and anything you have opened before still work offline."
    : d.kind === "limit" ? "Give it a moment, then try again."
    : part ? `The server answered, but ${part} is not responding${d.status ? ` (${d.status})` : ""}. The rest of the app is unaffected.`
    : health.data?.ok ? `The server and its indexes are up, so this was a passing fault${d.status ? ` (${d.status})` : ""}. Trying again should work.`
    : `The server did not complete the request${d.status ? ` (${d.status})` : ""}. It may be a passing fault or a part of the service resting.`;

  const actions: Action[] = [];
  if (d.kind === "telegram") { /* OpenInTelegram, below: it keeps this screen as the destination */ }
  else if (d.kind === "session") actions.push({ label: "Close and reopen CyberJudah", icon: "retry", onClick: reopen, primary: true });
  else if (onRetry) actions.push({ label: "Try again", icon: "retry", onClick: () => { haptic("select"); onRetry(); }, primary: d.kind !== "offline" });
  if (q) {
    if (what === "ask" && d.kind !== "telegram") actions.push({ label: "Search the classes for this instead", icon: "search", onClick: () => { haptic("select"); navigate(`/search?q=${encodeURIComponent(q)}`); } });
    actions.push({ label: "Search the Scriptures", icon: "book", onClick: () => { haptic("select"); navigate(`/bible?search=${encodeURIComponent(q)}`); } });
    if (d.kind !== "offline") actions.push({ label: "Open this search on cyberjudah.io", icon: "link", onClick: () => openLink(site) });
  }
  return (
    <div className="trouble" role="alert">
      <div className="trouble__head"><span className="trouble__badge"><Icon name={d.kind === "offline" ? "clock" : "spark"} size={16} /></span><b>{title}</b></div>
      <p className="trouble__why">{why}</p>
      <div className="trouble__actions">{d.kind === "telegram" ? <OpenInTelegram className="trouble__act trouble__act--primary" /> : null}{actions.map((a) => <button key={a.label} type="button" className={`trouble__act${a.primary ? " trouble__act--primary" : ""}`} onClick={a.onClick}><Icon name={a.icon} size={15} />{a.label}</button>)}</div>
    </div>
  );
}
