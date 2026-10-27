import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";

import { APP_URL, share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { addToHomeScreen, app, downloadFile, homeScreenStatus, openLink, user } from "@/tg/sdk";
import { DATA_ORIGIN, SITE_URL } from "@/api/data";
import { Icon, NotificationDot, Screen, type IconName } from "@/ui/ui";
import { useAvailableUpdatesIndicator } from "@/resources/updates";
import { haptic } from "@/tg/sdk";
import { useAppTheme } from "@/ui/theme";
import { cssVars, PALETTES } from "@/bible/theme";

const STUDY: [string, string, string, IconName][] = [
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter", "book"],
  ["/books", "Library", "Books the classes read from, with their maps and pictures", "layers"],
  ["/lexicon", "Lexicon", "Strong's Hebrew and Greek behind every word", "spark"],
  ["/dictionary", "Dictionary", "Easton's: names, places and words", "type"],
  ["/nave", "Nave Thematic Bible", "Nave Thematic Bible", "tag"],
  ["/people", "People", "Everyone named in the Bible, with their family and their verses", "star"],
  ["/relations", "Your precepts", "The verses, notes and entries you joined, precept upon precept", "precepts"],
  ["/encyclopedia", "Encyclopedia", "Standing subjects, book by book", "layers"],
  ["/glossary", "Glossary", "The words the classes use, defined", "type"],
  ["/topics", "Topics", "Classes and episodes by what they cover", "tag"],
  ["/concordance", "Concordance", "Book by book, everything in the library that cites each chapter", "list"],
];
const LAW: [string, string, string, IconName][] = [
  ["/law", "The Law", "The handbook, every law with its scripture", "law"],
  ["/precepts", "Precepts", "Every subject scripture speaks to, A to Z", "quote"],
  ["/doctrine", "False Doctrines", "False doctrines answered from scripture and the classes", "quote"],
  ["/cases", "Case studies", "Judgments, and those who kept the law and were blessed", "folder"],
  ["/timeline", "Bible timeline", "The periods and events by year, with the case studies on them", "clock"],
];

export function More() {
  useBackButton();
  return <Screen title="More"><MoreBody /></Screen>;
}

type Item = { icon: IconName; label: string; description?: string; color: string; colored?: boolean; href?: string; onClick?: () => void; dot?: boolean; a11y?: string };
/** Bible Strong's SectionCard: a rounded card with a small grey heading row and its links. */
function Card({ icon, title, items, headingWeight }: { icon: IconName; title: string; items: (Item | null)[]; headingWeight?: 400 | 700 }) {
  return (
    <section className="mcard">
      <h2 className="mcard__head" style={{ fontWeight: headingWeight }}><Icon name={icon} size={16} />{title}</h2>
      {items.filter((i): i is Item => !!i).map((i) => {
        const inner = <><span className="mcard__icon" style={{ color: i.color, background: `color-mix(in srgb, ${i.color} 12%, transparent)` }}><Icon name={i.icon} size={20} />{i.dot ? <NotificationDot size={12} style={{ top: -3, right: -3 }} /> : null}</span><span className="mcard__label" style={i.colored ? { color: i.color } : undefined}>{i.label}{i.description ? <small className="mcard__description">{i.description}</small> : null}</span><span className="mcard__chev"><Icon name="chevron" size={20} /></span></>;
        return i.href
          ? <Link key={i.label} className="mcard__row" to={i.href} aria-label={i.a11y} onClick={() => haptic("select")}>{inner}</Link>
          : <button key={i.label} type="button" className="mcard__row" onClick={() => { haptic("select"); i.onClick?.(); }}>{inner}</button>;
      })}
    </section>
  );
}

const C = { blue: "var(--accent)", teal: "var(--accent)", violet: "var(--danger)", amber: "var(--gold)", rose: "var(--danger)", green: "var(--accent)", red: "var(--danger)", slate: "var(--text-3)" };

/** The menu's content (Bible Strong's MoreScreen), on its own page or in the menu drawer. */
export function MoreBody() {
  const { name } = useAppTheme();
  const [pin, setPin] = useState(false);
  const { hasUpdates } = useAvailableUpdatesIndicator();
  useEffect(() => { void homeScreenStatus().then((s) => setPin(s === "missed" || s === "unknown")); }, []);
  return (
    <div className="more" style={cssVars(PALETTES[name]) as CSSProperties}>
      {/* Bible Strong's account card at the top of the menu: who is signed in (here, the Telegram user). */}
      <Link className="more__account" to="/settings/account" onClick={() => haptic("select")}>
        <span className="more__avatar" aria-hidden="true">{user?.photo_url ? <img src={user.photo_url} alt="" /> : (user?.first_name?.[0] ?? "?")}</span>
        <span><b>{user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "Your account"}</b><small>{user?.username ? `@${user.username}` : "Synced with your Telegram account"}</small></span>
        <Icon name="chevron" size={20} />
      </Link>
      <Card icon="bookmark" title="Yours" items={[
        { icon: "book", label: "My studies", color: C.blue, href: "/studies" },
        { icon: "check", label: "Reading plans", color: C.green, href: "/plans" },
        { icon: "highlight", label: "Highlights", color: C.blue, href: "/highlights" },
        { icon: "bookmark", label: "Bookmarks", color: C.amber, href: "/bookmarks" },
        { icon: "note", label: "Notes", color: C.violet, href: "/notes" },
        { icon: "tag", label: "Tags", color: C.rose, href: "/tags" },
        { icon: "clock", label: "History", color: C.blue, href: "/history" },
        { icon: "sun", label: "Sabbath", color: C.amber, href: "/sabbath" },
      ]} />
      <Card icon="book" title="Resources" headingWeight={400} items={[
        { icon: "chat", label: "Ask CyberJudah", color: C.teal, colored: true, href: "/ask" },
        { icon: "play", label: "Classes", color: C.red, colored: true, href: "/classes" },
        ...STUDY.map(([href, label, , icon], k) => ({ href, label, icon, colored: true, color: href === "/lexicon" ? C.blue : href === "/dictionary" ? C.amber : [C.blue, C.violet, C.amber, C.green, C.rose, C.teal, C.violet, C.slate][k % 8] })),
      ]} />
      <Card icon="law" title="The Law" items={LAW.map(([href, label, description, icon], k) => ({ href, label, icon, description: href === "/doctrine" ? description : undefined, color: [C.amber, C.teal, C.teal, C.slate, C.amber][k] }))} />
      <Card icon="gear" title="Settings" items={[
        { icon: "gear", label: "Settings", color: C.slate, href: "/settings" },
        { icon: "download", label: "Downloads", color: C.green, href: "/resources", dot: hasUpdates, a11y: hasUpdates ? "Downloads, updates available" : undefined },
        pin ? { icon: "star", label: "Add to Home Screen", color: C.amber, onClick: addToHomeScreen } : null,
        { icon: "download", label: "Download the vault", color: C.green, onClick: () => downloadFile(`${DATA_ORIGIN}/downloads/vault.zip`, "cyberjudah-vault.zip") },
      ]} />
      <Card icon="star" title="CyberJudah" items={[
        { icon: "book", label: "Help & reading guide", color: C.teal, href: "/settings/help" },
        // Bible Strong's "Contact the developer": here, a chat with the bot (the Mini App's own bot).
        { icon: "chat", label: "Contact us", color: C.blue, onClick: () => openLink(APP_URL.replace(/\/[^/]+$/, "")) },
        { icon: "star", label: "Support CyberJudah", color: C.amber, href: "/settings/donate" },
        { icon: "share", label: "Share the app", color: C.teal, onClick: () => void share({ kind: "app", title: "CyberJudah", text: "The KJV with the Apocrypha, and everything taught from it, in Telegram.", sitePath: "/" }) },
        { icon: "link", label: "Open the full website", color: C.blue, onClick: () => openLink(SITE_URL) },
        { icon: "link", label: "The notes on GitHub", color: C.slate, onClick: () => openLink("https://github.com/DevSecObie/cyberjudah") },
      ]} />
      <nav className="more__legal" aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav>
      <p className="more__foot">The Bible text is the public-domain King James Version (1769) with the Apocrypha.{app ? ` · Telegram ${app.version} · ${app.platform}` : ""}</p>
    </div>
  );
}
