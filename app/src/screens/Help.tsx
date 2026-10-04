import { Link } from "react-router";

import { Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";

/**
 * The in-app Help: how to use CyberJudah, written for readers, not developers.
 * What it says about Ask billing must match the Ask code (ASK_FREE_DAILY,
 * ASK_BASIC_DAILY, Stars top-ups at cost, no top-ups on the Sabbath).
 */
export function Help() {
  useBackButton(true);
  return (
    <Screen title="Help" kicker="How CyberJudah works" className="help">
      <Section title="Reading">
        <p>Everything is in More: the daily reading plan (4 chapters a day), the Library, the Lexicon and Dictionary, the People index, the Law, and the Bible timeline.</p>
        <ul>
          <li><b>Search</b> finds by meaning or by keyword. Typing a Bible book's number jumps to it (for example, 19 for Psalms).</li>
          <li><b>Bookmarks, highlights, notes and tags</b> are kept on your device and in Telegram's cloud storage for this app. They are not on CyberJudah's servers.</li>
        </ul>
      </Section>

      <Section title="Ask CyberJudah">
        <p>Ask a question in your own words and get an answer from the library — the King James Bible with the Apocrypha and everything taught from it.</p>
        <ul>
          <li><b>Choose the model</b> at the top, under the title. Tap it to change.</li>
          <li><b>Every reader gets about 2 in-depth answers a day free</b> (the daily allowance resets at midnight UTC).</li>
          <li>After that, up to <b>25 basic answers a day</b> from the free model, also free.</li>
          <li>Past that, answers are paid with <b>Telegram Stars, at cost</b> — CyberJudah adds nothing on top. There are <b>no top-ups on the Sabbath</b>.</li>
          <li>An answer keeps arriving even if you leave mid-answer; coming back (a refresh, the app reopened, the connection back) waits for it instead of calling it lost.</li>
        </ul>
      </Section>

      <Section title="Reminders">
        <p>Set them in Settings → Reading reminders:</p>
        <ul>
          <li><b>Reading reminder:</b> a nudge at your chosen time and time zone.</li>
          <li><b>Daily verse:</b> a verse sent to your chat each morning.</li>
          <li><b>Top-up reminder:</b> a note when your Ask balance runs low.</li>
        </ul>
      </Section>

      <Section title="The Timeline">
        <p>The Bible timeline walks the periods and events by year, with portraits, case studies and the class notes on them. On the Final Captivity, admins can set the cover photo from the photo editor.</p>
      </Section>

      <Section title="Your Data">
        <p>What CyberJudah keeps about you, for how long, and your choices — a copy of it, deleting it, withdrawing your AI agreement — are in <Link to="/privacy">Privacy</Link>. In the bot you can also send /mydata or /deletemydata.</p>
      </Section>

      <Section title="Need a Hand?">
        <p>Send /support to the bot and it will reach the owner. For questions about your data: privacy@cyberjudah.io.</p>
      </Section>
    </Screen>
  );
}
