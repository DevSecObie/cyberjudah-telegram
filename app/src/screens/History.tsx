import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Feather } from "@/bible/icons";
import { useHistory, type HistoryRow } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { Screen } from "@/ui/ui";
import { EmptyState } from "./new-tab-search";
import { timeAgo } from "./tab-groups";

/**
 * Bible Strong's HistoryScreen: the trash button (Clear history, after asking), then a row per
 * passage read, newest first: the reference in bold, and at the right its "Verse" chip over how long
 * ago. The rows keep their time current, a minute at a time.
 */
export function History() {
  useBackButton();
  const [rows, setRows] = useHistory();
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
          {rows.map((r) => <HistoryItem key={`${r.slug}${r.chapter}${r.verse ?? 1}${r.at}`} row={r} now={now} />)}
        </div>
      ) : <EmptyState icon="history" message="No recently viewed content." />}
    </Screen>
  );
}

/** Bible Strong's verse HistoryItem: the reference (":1" left off) and, at the right, the chip over "… ago". */
function HistoryItem({ row, now }: { row: HistoryRow; now: number }) {
  const verse = row.verse ?? 1;
  return (
    <Link to={`/read/${row.slug}/${row.chapter}${verse > 1 ? `?at=${verse}` : ""}`} className="histitem" onClick={() => haptic("select")}>
      <b className="histitem__title">{verse > 1 ? `${row.name}:${verse}` : row.name}</b>
      <span className="histitem__side">
        <span className="histitem__chip">Verse</span>
        <span className="histitem__ago">{timeAgo(row.at, now)}</span>
      </span>
    </Link>
  );
}
