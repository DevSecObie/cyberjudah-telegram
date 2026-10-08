import { useNavigate } from "react-router";
import { Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";

/**
 * The terms for Ask CyberJudah's balance, bought with Telegram Stars. Each statement is what the
 * code does (bot/src/billing.ts, bot/src/credits.ts, shared/credits.mjs); a change to one is a
 * change to the other. Reached from Settings, Privacy, the balance sheet and /terms in the bot.
 */
export const TERMS_UPDATED = "2026-10-07";

export function Terms() {
  useBackButton(true);
  const navigate = useNavigate();
  const go = (path: string) => (e: { preventDefault(): void }) => { e.preventDefault(); navigate(path); };
  return (
    <Screen title="Terms" kicker={`Last updated ${TERMS_UPDATED}`} className="privacy">
      <Section title="What Your Balance Buys">
        <p>Your Ask CyberJudah balance pays for answers from the paid AI models. Each answer is charged what it cost to write, at the chosen model's own price: longer answers and deeper research cost more. CyberJudah makes no profit: you pay only what your answers cost. The free model, your chats, search, reading and PDFs stay free.</p>
      </Section>

      <Section title="Top-Ups">
        <ul>
          <li>Top-ups are bought with Telegram Stars, and Telegram handles the payment. Each adds to your balance what CyberJudah receives for those Stars after Telegram's share.</li>
          <li>Credit you buy never expires.</li>
          <li>Top-ups are not sold from full dark before a Sabbath, feast day or New Moon until full dark at its end, where you are. A balance you already have can be used on those days.</li>
          <li>Gifts sent with /support are gifts: they do not add to your balance.</li>
        </ul>
      </Section>

      <Section title="Refunds and Problems">
        <p>If something you paid for did not arrive, or you want a refund, send /paysupport to the bot with what you bought and when. A refund is paid back in Stars through Telegram. When a top-up is refunded, whatever of it is still unspent leaves your balance; what was already spent is not taken from the rest.</p>
      </Section>

      <Section title="Deleting Your Data">
        <p>Delete my data removes your balance and its history with everything else, and any balance left is lost. The record of each Stars payment is kept, no longer linked to you, for refunds and the accounts. See the <a href="/privacy" onClick={go("/privacy")}>privacy policy</a>.</p>
      </Section>
    </Screen>
  );
}
