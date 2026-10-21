import { useEffect, useMemo, useState } from "react";
import { useHistory, normalizeHistory, getHistoryItemKey } from "@/lib/marks";
import { historyHref } from "@/lib/history";
import { useBackButton } from "@/tg/hooks";
import { Feather } from "@/bible/icons";
import { useSheet } from "@/ui/sheet";
import { Empty, List, Row, Screen, Skeleton } from "@/ui/ui";
import { timeAgo } from "./tab-groups";
import "./history.css";

/** 27.2.0: a single newest-first list, type chips, relative time, and confirmed clearing. */
export function History() {
  useBackButton();
  const sheet = useSheet();
  const [stored, setRows, ready] = useHistory();
  const rows = useMemo(() => normalizeHistory(stored), [stored]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const clear = async () => {
    const answer = await sheet.open({ title: `Clear history?\nRecently viewed items will be removed from this device (${rows.length}).`, items: [{ id: "cancel", text: "Cancel" }, { id: "clear", text: "Clear history", destructive: true }] });
    if (answer?.id === "clear") setRows([]);
  };
  return <Screen title="Recently viewed" className="history-screen" action={ready && rows.length ? <button type="button" className="icon-btn history-screen__clear" aria-label="Clear history" onClick={() => void clear()}><Feather name="trash-2" size={20} color="var(--danger)" /></button> : undefined}>
    {!ready ? <Skeleton rows={4} /> : !rows.length ? <Empty title="No recently viewed content." /> : <List>{rows.map(row => {
      const type = row.type ?? "bible";
      const title = !row.type || row.type === "bible" ? `${row.name}${(row.verse ?? 1) > 1 ? `:${row.verse}` : ""} KJV` : row.name;
      const sub = row.type === "strong" ? row.original : row.type === "dictionary" ? row.dictionaryTitle : undefined;
      return <Row key={getHistoryItemKey(row)} href={historyHref(row)} title={title} sub={sub} trailing={<span className="history-screen__meta"><span className="history-screen__chip" data-type={type}>{({ bible: "Verse", strong: "Strong", dictionary: "Dictionary", topic: "Topic" })[type]}</span><span>{timeAgo(row.at, now)}</span></span>} />;
    })}</List>}
  </Screen>;
}
