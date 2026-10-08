import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { parseDonationAmount } from "@/lib/donate";
import { timeZone } from "@/lib/reminders";
import { useBackButton } from "@/tg/hooks";
import { api, ApiError, app, haptic, openInvoice, openLink } from "@/tg/sdk";
import { Icon, Screen, FormSection as Section } from "@/ui/ui";

type Pause = { kind: string; until: number; message: string };
type Donations = { open: boolean; presets: number[]; minStars: number; maxStars: number | null; donationUrl: string | null; pause: Pause | null };

/**
 * "Support CyberJudah" (CYB-82's GET /api/donations and POST /api/invoice): Stars presets, any
 * amount within the owner's bounds, the owner's own donation link, and the same holy-days pause
 * giving already gets on the server, shown here as a calm message in place of the buttons. Nothing
 * to read is ever behind this: it is reachable only from Settings and More.
 */
export function Donate() {
  useBackButton(true);
  const q = useQuery({ queryKey: ["donations"], queryFn: () => api<Donations>(`/api/donations?tz=${encodeURIComponent(timeZone())}`), staleTime: 30_000 });
  const d = q.data;
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [thanks, setThanks] = useState(false);

  const give = async (stars: number) => {
    haptic("select"); setWhy(""); setBusy(true);
    try {
      const r = await api<{ link: string }>("/api/invoice", { method: "POST", json: { stars, tz: timeZone() } });
      const status = await openInvoice(r.link);
      if (status === "paid") { haptic("success"); setThanks(true); setCustom(""); }
    } catch (e) {
      // Paused meanwhile (it has just got dark where the giver is): the catalog says until when.
      if (e instanceof ApiError && e.status === 423) void q.refetch();
      else if (e instanceof ApiError && e.status === 400) setWhy("Choose an amount of Stars within the limits shown below.");
      else if (e instanceof ApiError && e.status === 409) setWhy("Donations are not open right now.");
      else setWhy("The invoice could not be made. Try again.");
    } finally { setBusy(false); }
  };

  const customStars = d ? parseDonationAmount(custom, d) : null;

  return (
    <Screen title="Support CyberJudah">
      <Section>
        <p className="hint">Telegram Stars go toward hosting the library. CyberJudah takes no profit from your gift, and nothing you read is ever behind a payment.</p>
        {thanks ? (
          <div className="donate__thanks surface" role="status">
            <Icon name="check" size={20} />
            <p><b>Thank you.</b> Your gift keeps the library free for everyone who reads it.</p>
          </div>
        ) : null}
        {!d && !q.isError ? <p className="hint" aria-busy="true">Loading…</p> : null}
        {q.isError ? <p className="hint" role="status">Donations can't be reached right now. Try again when connected.</p> : null}
        {d?.pause ? (
          <p className="credits__pause" role="status"><Icon name="clock" size={16} />{d.pause.message}</p>
        ) : d && !d.open ? (
          <p className="credits__closed" role="status">Donations are not open right now.</p>
        ) : d ? (
          <>
            <div className="credits__topups">
              {d.presets.map((n) => (
                <button key={n} type="button" className="topup" disabled={!app || busy} onClick={() => void give(n)} aria-label={`Give ${n} Stars`}>
                  <b>⭐ {n.toLocaleString("en-US")}</b>
                </button>
              ))}
            </div>
            <div className="donate__custom">
              <label htmlFor="donate-custom">Another amount</label>
              <div className="donate__custom-row">
                <input
                  id="donate-custom" type="number" inputMode="numeric" min={d.minStars} max={d.maxStars ?? undefined}
                  placeholder={d.maxStars ? `${d.minStars}–${d.maxStars}` : `${d.minStars} or more`}
                  value={custom} disabled={!app || busy}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button type="button" className="btn" disabled={!app || busy || customStars === null} onClick={() => void give(customStars!)}>⭐ Give</button>
              </div>
              <p className="hint">{d.maxStars ? `Between ${d.minStars} and ${d.maxStars} Stars.` : `${d.minStars} Star${d.minStars === 1 ? "" : "s"} or more.`}</p>
            </div>
            {why ? <p className="credits__closed" role="alert">{why}</p> : null}
            {d.donationUrl ? <button type="button" className="btn btn--quiet" onClick={() => openLink(d.donationUrl!)}>Give another way</button> : null}
          </>
        ) : null}
        {!app ? <p className="hint">Stars are given inside Telegram. Open CyberJudah in Telegram to give with Stars, or use the link above.</p> : null}
      </Section>
    </Screen>
  );
}
