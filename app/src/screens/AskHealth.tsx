import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useBackButton } from "@/tg/hooks";
import { api } from "@/tg/sdk";
import { Empty, List, Loading, Row, Screen, Section, Segmented } from "@/ui/ui";

type ModelHealth = { model: string; answers: number; complete: number; fallback: number; failed: number; cutOff: number; medianMs: number | null; avgSources: number | null };
type Problem = { at: number; surface: string; model: string | null; outcome: string; detail: string | null; elapsedMs: number | null };
type Health = {
  models: ModelHealth[];
  problems: Problem[];
  free: { spentUsd: number; heldUsd: number; capUsd: number | null; model: string | null; deepModel: string | null };
  claude: { configured: boolean; billing: "cloudflare" | "console"; outOfFundsSince: string | null };
};

const short = (model: string | null) => (model ?? "unknown").replace(/^@cf\/[^/]+\//, "");
const secs = (ms: number | null) => (ms == null ? "–" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "–");
const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const OUTCOME: Record<string, string> = { "cut-off": "Cut off", fallback: "Fell back", "no-evidence": "No teaching found", empty: "Empty answer", unavailable: "Unavailable", failed: "Failed", timeout: "Timed out" };

/**
 * For admins: how Ask CyberJudah's answers are turning out, model by model, from the server's
 * records (no questions or answers are kept). The latest problems carry their reason, so a
 * failure can be fixed without a reader having to report it.
 */
export function AskHealth() {
  useBackButton();
  const [hours, setHours] = useState<"24" | "168">("24");
  const q = useQuery({ queryKey: ["ask-health", hours], queryFn: () => api<Health>(`/api/admin/ask-health?hours=${hours}`), refetchInterval: 60_000 });
  const h = q.data;
  return (
    <Screen title="Ask Health" kicker="Admin">
      <Segmented label="Period" value={hours} onChange={setHours} options={[["24", "24 hours"], ["168", "7 days"]]} />
      {q.isPending ? <Loading /> : q.isError || !h ? <Empty title="Ask health did not load" action={{ label: "Retry", onClick: () => void q.refetch() }} /> : (
        <>
          <Section title="Models">
            {!h.models.length ? <p className="hint">No answers recorded in this period.</p> : (
              <List aria-label="Answers by model">
                {h.models.map((m) => (
                  <Row key={m.model} title={short(m.model)}
                    sub={`${pct(m.complete, m.answers)} complete · ${m.fallback} fell back · ${m.failed + m.cutOff} failed${m.cutOff ? ` (${m.cutOff} cut off)` : ""} · ${m.avgSources ?? "–"} sources`}
                    trailing={<span className="row__value">{secs(m.medianMs)}</span>} />
                ))}
              </List>
            )}
            <p className="hint">Times are the median for a whole answer. "Fell back" means the reader got the sources without a written answer.</p>
          </Section>
          <Section title="Latest problems">
            {!h.problems.length ? <p className="hint">No problems in this period.</p> : (
              <List aria-label="Latest problems">
                {h.problems.map((p, i) => (
                  <Row key={`${p.at}-${i}`} title={`${OUTCOME[p.outcome] ?? p.outcome} · ${short(p.model)}`}
                    sub={`${when(p.at)} · ${p.surface}${p.elapsedMs != null ? ` · ${secs(p.elapsedMs)}` : ""}${p.detail ? ` · ${p.detail}` : ""}`} trailing={<span />} />
                ))}
              </List>
            )}
          </Section>
          <Section title="Budget and providers">
            <List>
              <Row title="Free answers today" sub={`${short(h.free.model)} by default; deep questions ${short(h.free.deepModel)}`}
                trailing={<span className="row__value">${(h.free.spentUsd + h.free.heldUsd).toFixed(3)}{h.free.capUsd != null ? ` of $${h.free.capUsd.toFixed(2)}` : ""}</span>} />
              <Row title="Claude" sub={!h.claude.configured ? "Not set up; paid answers use the backup model" : h.claude.outOfFundsSince ? `Out of money since ${when(Date.parse(h.claude.outOfFundsSince))}; readers get the backup model` : `Ready, paid through ${h.claude.billing === "console" ? "the Claude console" : "Cloudflare"}`} trailing={<span />} />
            </List>
          </Section>
        </>
      )}
    </Screen>
  );
}
