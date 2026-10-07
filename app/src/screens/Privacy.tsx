import { useState } from "react";
import { List, Row, Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";
import { api, ApiError, app, confirm, haptic } from "@/tg/sdk";
import { consented, withdraw } from "@/lib/ai-consent";

/**
 * The privacy policy, as readers see it, and their choices over what is kept: a copy of it all,
 * deleting it all, and withdrawing their agreement to AI providers. What it says is what the code
 * does (docs/PRIVACY.md lists where each statement is enforced); a change to one is a change to
 * the other. Required by Telegram's Bot Developer Terms (section 4) and Standard Bot Privacy
 * Policy (7.3), and by Apple's App Review Guidelines 5.1.1(i) and 5.1.2(i).
 */
export const PRIVACY_UPDATED = "2026-10-07";
/** Where privacy questions and requests go (the owner's address). */
export const PRIVACY_CONTACT = "privacy@cyberjudah.io";

type Deleted = { savedChats: number; readingReminder: boolean; dailyVerse: boolean; classNoteRequests: number; askBalanceUsd: number; topupReminder: boolean };

export function Privacy() {
  useBackButton(true);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState<"" | "export" | "delete">("");
  const [agreed, setAgreed] = useState(consented);
  const inTelegram = !!app?.initData;

  const sendCopy = async () => {
    setBusy("export"); setStatus("");
    try { await api("/api/privacy/export/send", { method: "POST" }); haptic("success"); setStatus("A copy of everything kept about you has been sent to your chat with the bot."); }
    catch (e) { setStatus(e instanceof ApiError && e.status === 400 ? "The bot could not send you the file. Open a chat with the bot, press Start, and try again." : "That did not work. Please try again."); }
    finally { setBusy(""); }
  };
  const deleteAll = async () => {
    if (!(await confirm("Delete everything CyberJudah keeps about you? Your saved Ask chats, reading reminder, daily verse, Ask balance (any balance left is lost), top-up reminder and class-note requests. This cannot be undone."))) return;
    setBusy("delete"); setStatus("");
    try {
      const r = await api<{ ok: boolean; summary: string; deleted: Deleted }>("/api/privacy/delete", { method: "POST", json: { confirm: "delete" } });
      // The Ask conversation kept on this device for the reader goes too.
      try { for (const k of Object.keys(localStorage)) if (k.startsWith("cj:ask")) localStorage.removeItem(k); } catch { /* nothing kept */ }
      haptic("success"); setStatus(r.summary);
    } catch { setStatus("Deletion could not finish. Some data may already have been removed. Please try again."); }
    finally { setBusy(""); }
  };

  return (
    <Screen title="Privacy" kicker={`Last updated ${PRIVACY_UPDATED}`} className="privacy">
      <Section title="Your Choices">
        {inTelegram ? (
          <List>
            <Row icon="download" title={busy === "export" ? "Sending…" : "Download my data"} sub="A copy of everything kept about you, sent to your chat with the bot" onClick={busy ? undefined : () => void sendCopy()} />
            <Row icon="trash" title={busy === "delete" ? "Deleting…" : "Delete my data"} sub="Everything kept about you, removed at once" onClick={busy ? undefined : () => void deleteAll()} />
            <Row icon="close" title="Withdraw AI agreement" sub={agreed.length ? `You agreed to: ${agreed.join(", ")}. Ask will ask again before sending a question.` : "You have not agreed to any AI provider."} onClick={agreed.length ? () => { withdraw(); setAgreed([]); haptic("select"); setStatus("Done. Ask will ask before sending your next question to any AI provider."); } : undefined} />
          </List>
        ) : <p className="hint">Open CyberJudah in Telegram to download or delete what is kept about you. In the bot you can also send /mydata or /deletemydata. A reminder set up in this browser is removed in Settings → Reading reminders.</p>}
        {status ? <p className="hint" role="status">{status}</p> : null}
      </Section>

      <Section title="What Stays with You">
        <p>Your highlights, notes, bookmarks, tags, reading history, reading plan and settings are kept on your device and in Telegram's own cloud storage for this app. They are not on CyberJudah's servers. A backup from Settings goes to your own chat with the bot.</p>
      </Section>

      <Section title="What CyberJudah Keeps, and for How Long">
        <p>Only what a feature you use needs. Each record is filed under a coded ID, not your Telegram ID, and what it holds is encrypted, with the key kept apart from the data.</p>
        <ul>
          <li><b>Saved Ask chats:</b> your questions and the answers, so you can reopen them. Removed 180 days after you last use a chat, or when you delete it.</li>
          <li><b>Reading reminder:</b> its time, time zone, where to send it and the chat or browser to send it to. Kept until you turn it off. A browser not linked to Telegram is forgotten after 180 days unused.</li>
          <li><b>Daily verse:</b> the hour and the chat to send it to. Kept until you send /daily again.</li>
          <li><b>Ask balance:</b> what is left, each top-up and each answer you paid for (the model and what it cost, never the question). Kept until you delete your data.</li>
          <li><b>Top-up reminder:</b> if you turned it on, your time zone and the chat to send it to. Kept until you turn it off.</li>
          <li><b>Stars payments and gifts:</b> Telegram's charge reference, what was bought or given, the amount and the date, for refunds and the accounts. Downloading your data includes both; deleting your data unlinks them from you.</li>
          <li><b>Class-note requests:</b> so each person counts once. Kept until the notes are written.</li>
          <li><b>Counts:</b> how many questions you asked today (cleared daily) and whether you asked on a given day (30 days), for limits and costs.</li>
        </ul>
      </Section>

      <Section title="Who Else Handles It">
        <ul>
          <li><b>Telegram</b> runs the platform: sign-in, messages and Stars payments, under Telegram's own privacy policy.</li>
          <li><b>Cloudflare</b> hosts CyberJudah and runs the Cloudflare-hosted AI models. Its request logs are kept for up to 7 days. Calls to AI models are logged without your words, or not logged at all.</li>
          <li><b>The AI provider of the model you choose</b> (for example Anthropic, OpenAI, Google or xAI) receives your question, the earlier questions in that chat, and passages from the library, so that it can write the answer. Only after you agree, in Ask, to that provider. Your name and Telegram ID are not sent. Each provider handles what it receives under its own terms.</li>
          <li><b>Your browser's push service</b> (from Apple, Google or Mozilla), only if you turn on push reminders.</li>
        </ul>
        <p>CyberJudah does not sell your data or use it for advertising.</p>
      </Section>

      <Section title="Your Rights">
        <p>You can get a copy of what is kept, have it deleted, withdraw your agreement, and stop any feature at any time, in this screen or with /mydata and /deletemydata in the bot. What the app does for you here happens at once. You can also complain to the data protection authority where you live. Payments: send /paysupport to the bot.</p>
      </Section>

      <Section title="Contact">
        <p>For any question about your data, or a request you would rather send by email: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. Requests are answered within 30 days.</p>
      </Section>
    </Screen>
  );
}
