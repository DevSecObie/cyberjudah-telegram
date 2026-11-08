import { Link, useNavigate } from "react-router";
import { Screen, Section } from "@/ui/ui";
import { useBackButton } from "@/tg/hooks";
import { PRIVACY_CONTACT } from "./Privacy";

/**
 * Where to get help with CyberJudah, reachable without the app or a sign-in
 * (https://cyberjudah.io/app/support). It is the Support URL in App Store Connect, which App Review
 * opens (App Store Review Guideline 1.5), so it names a working contact and the steps to delete an
 * account. Each statement matches what the app does; Delete Your Account has the full detail.
 */
export function Support() {
  useBackButton();
  const navigate = useNavigate();
  const go = (path: string) => (e: { preventDefault(): void }) => { e.preventDefault(); navigate(path); };
  const subject = encodeURIComponent("CyberJudah support");
  return (
    <Screen title="Support" kicker="CyberJudah" className="privacy">
      <Section title="Contact Us">
        <p>Email <a href={`mailto:${PRIVACY_CONTACT}?subject=${subject}`}>{PRIVACY_CONTACT}</a> with a question, a problem or a request about your data. Tell us which phone or browser you use and what you were doing when it happened; a screenshot helps. We answer within 30 days, usually much sooner.</p>
        <p>Testing the beta through TestFlight? You can also take a screenshot in the app and choose Share Beta Feedback.</p>
      </Section>

      <Section title="Delete Your Account">
        <ol>
          <li>Open CyberJudah on your iPhone and sign in.</li>
          <li>Open More, or your profile, and choose Delete account.</li>
          <li>Type DELETE to confirm, then tap Delete.</li>
          <li>If you signed in with Apple, confirm with Apple when asked. CyberJudah then stops your Apple ID from signing in to it.</li>
        </ol>
        <p>This deletes your sign-in and the highlights, notes, bookmarks, tags, links and personal studies synced to it. If you last signed in a while ago, you are asked to sign in again first. Without the app, email <a href={`mailto:${PRIVACY_CONTACT}?subject=${encodeURIComponent("Delete my CyberJudah account")}`}>{PRIVACY_CONTACT}</a> from the address you signed in with. <a href="/delete-account" onClick={go("/delete-account")}>Delete your account</a> explains every way to delete and what is kept.</p>
      </Section>

      <Section title="Your Privacy">
        <p>The <Link to="/privacy">privacy policy</Link> lists everything CyberJudah keeps and for how long.</p>
      </Section>
    </Screen>
  );
}
