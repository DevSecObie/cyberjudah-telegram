import { useHistory } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { confirm } from "@/tg/sdk";
import { Empty, List, Row, Screen } from "@/ui/ui";

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 2) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}

export function History() {
  useBackButton(false);
  const [rows, setRows] = useHistory();
  return (
    <Screen title="History" kicker="The last thirty chapters you opened" action={rows.length ? <button type="button" className="link" onClick={async () => { if (await confirm("Clear your history?")) setRows([]); }}>Clear</button> : undefined}>
      {!rows.length ? <Empty title="Nothing yet">Chapters you read appear here, newest first.</Empty> : <List>{rows.map((r) => <Row key={`${r.slug}${r.chapter}${r.at}`} href={`/bible/${r.slug}/${r.chapter}`} title={r.name} meta={ago(r.at)} />)}</List>}
    </Screen>
  );
}
