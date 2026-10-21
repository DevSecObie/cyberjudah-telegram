import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { Feather } from "@/bible/icons";
import { historyHref } from "@/lib/history";
import { getHistoryItemKey, normalizeHistory, useHistory, type HistoryRow } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { Screen } from "@/ui/ui";
import { EmptyState } from "./new-tab-search";
import { timeAgo } from "./tab-groups";

/**
 * Bible Strong's HistoryScreen: the trash button (Clear history, after asking), then a row per
 * item viewed, newest first: its title in bold, and at the right its chip over how long ago. The
 * rows keep their time current, a minute at a time.
 */
export function History() {
  useBackButton();
  const [stored, setRows] = useHistory();
  const rows = useMemo(() => normalizeHistory(stored), [stored]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const clear = async () => {
    if (await confirm(`Clear history?\n\nRecently viewed items will be removed from this device (${rows.length}).`)) setRows([]);
  };
  const trash = rows.length ? (
    <button type="button" className="histscreen__clear" aria-label="Clear history" onClick={() => { haptic("select"); void clear(); }}>
      <Feather name="trash-2" size={20} />
    </button>
  ) : undefined;
  return (
    <Screen title="Recently viewed" className="histscreen" action={trash}>
      {rows.length ? (
        <div className="histscreen__list">
          {rows.map((r) => <HistoryItem key={getHistoryItemKey(r)} row={r} now={now} />)}
        </div>
      ) : <EmptyState icon="history" message="No recently viewed content." />}
    </Screen>
  );
}

/**
 * Bible Strong's HistoryItem, by type: a verse ("Genesis 1:3 KJV", ":1" left off) with its Verse
 * chip; a Strong's word over its original, Strong; a dictionary word over its dictionary, Word;
 * a topic, Nave.
 */
const CHIP: Record<NonNullable<HistoryRow["type"]>, string> = { bible: "Verse", strong: "Strong", dictionary: "Word", topic: "Nave" };
function HistoryItem({ row, now }: { row: HistoryRow; now: number }) {
  const type = row.type ?? "bible";
  const title = row.type === undefined || row.type === "bible" ? `${(row.verse ?? 1) > 1 ? `${row.name}:${row.verse}` : row.name} KJV` : row.name;
  const sub = row.type === "strong" ? row.original : row.type === "dictionary" ? row.dictionaryTitle : undefined;
  return (
    <Link to={historyHref(row)} className="histitem" onClick={() => haptic("select")}>
      <span className="histitem__main"><b className="histitem__title">{title}</b>{sub ? <span className="histitem__sub">{sub}</span> : null}</span>
      <span className="histitem__side">
        <span className="histitem__chip" data-type={type}>{CHIP[type]}</span>
        <span className="histitem__ago">{timeAgo(row.at, now)}</span>
      </span>
    </Link>
  );
}
