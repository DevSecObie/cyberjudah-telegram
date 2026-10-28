import { useNavigate } from "react-router";
import { Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";
import { PRIVACY_CONTACT } from "./Privacy";

/**
 * How to delete a CyberJudah account and its data, reachable without the app or a sign-in
 * (https://cyberjudah.io/app/delete-account). Google Play requires this web page for apps that
 * let people create accounts, and it is the link given in the Play Data safety form. Each
 * statement is what the app, the bot and the Privacy screen do; a change to one is a change to
 * the other (docs/PRIVACY.md).
 */
export function DeleteAccount() {
  useBackButton();
  const navigate = useNavigate();
  const go = (path: string) => (e: { preventDefault(): void }) => { e.preventDefault(); navigate(path); };
  const subject = encodeURIComponent("Delete my CyberJudah account");
  return (
    <Screen title="Delete Your Account" kicker="CyberJudah" className="privacy">
      <Section title="In the App">
        <ul>
          <li><b>CyberJudah for iPhone and Android:</b> open More, or your profile, and choose Delete account. You are asked to type a confirmation first, and to sign in again if you last signed in more than a few minutes ago. This deletes your sign-in and the study data synced to it. If you linked Telegram, your Ask balance and chats are deleted with Delete my data in Telegram.</li>
          <li><b>CyberJudah in Telegram:</b> open Settings → Privacy and choose Delete my data, or send /deletemydata to the bot.</li>
          <li><b>CyberJudah in a browser, signed in:</b> open <a href="/privacy" onClick={go("/privacy")}>Privacy</a> and choose Delete my data.</li>
        </ul>
      </Section>

      <Section title="Without the App">
        <p>If you no longer have the app or cannot sign in, email <a href={`mailto:${PRIVACY_CONTACT}?subject=${subject}`}>{PRIVACY_CONTACT}</a> from the email address you signed in with, or give your Telegram @username if you used Telegram. Ask for your account to be deleted. You may be asked to confirm the request from that address or account. Requests are completed within 30 days, and you are told when it is done.</p>
      </Section>

      <Section title="What Is Deleted">
        <ul>
          <li><b>Delete account in the phone app:</b> your Google, Apple or email sign-in, and your synced highlights, notes, bookmarks, tags, links and personal studies, with their earlier versions.</li>
          <li><b>Delete my data in Telegram or the browser:</b> your saved Ask chats, Ask balance and its history (any balance left is lost), reading reminder, daily verse, top-up reminder, class-note requests, cloud study backup, browser sign-ins, and the link between your Telegram and Google, Apple or email sign-ins.</li>
          <li><b>A request by email:</b> all of the above.</li>
        </ul>
      </Section>

      <Section title="What Is Kept">
        <ul>
          <li>The record of each Telegram Stars payment or gift (Telegram's charge reference, the amount and the date) is kept for refunds and the accounts, no longer linked to you.</li>
          <li>Counts and network limits that never name you expire on their own within seven days.</li>
          <li>What is stored only on your device, and files you exported, stay with you until you remove them or the app.</li>
        </ul>
        <p>The <a href="/privacy" onClick={go("/privacy")}>privacy policy</a> lists every record and how long it is kept.</p>
      </Section>
    </Screen>
  );
}
