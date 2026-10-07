import { useEffect, useState } from "react";
import { Link } from "react-router";

import { share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { addToHomeScreen, app, downloadFile, homeScreenStatus, openLink } from "@/tg/sdk";
import { DATA_ORIGIN, SITE_URL } from "@/api/data";
import { Icon, Screen, type IconName } from "@/ui/ui";
import { haptic } from "@/tg/sdk";

const STUDY: [string, string, string, IconName][] = [
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter", "book"],
  ["/books", "Library", "Books the classes read from, with their maps and pictures", "layers"],
  ["/lexicon", "Lexicon", "Strong's Hebrew and Greek behind every word", "spark"],
  ["/dictionary", "Dictionary", "Easton's: names, places and words", "type"],
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
  ["/cases", "Case studies", "Judgments, and those who kept the law and were blessed", "folder"],
  ["/timeline", "Bible timeline", "The periods and events by year, with the case studies on them", "clock"],
];

export function More() {
  useBackButton(true);
  return <Screen title="More"><MoreBody /></Screen>;
}

type Item = { icon: IconName; label: string; color: string; colored?: boolean; href?: string; onClick?: () => void };
/** Bible Strong's SectionCard: a rounded card with a small grey heading row and its links. */
function Card({ icon, title, items }: { icon: IconName; title: string; items: (Item | null)[] }) {
  return (
    <section className="mcard">
      <h2 className="mcard__head"><Icon name={icon} size={16} />{title}</h2>
      {items.filter((i): i is Item => !!i).map((i) => {
        const inner = <><span className="mcard__icon" style={{ color: i.color, background: `color-mix(in srgb, ${i.color} 12%, transparent)` }}><Icon name={i.icon} size={20} /></span><span className="mcard__label" style={i.colored ? { color: i.color } : undefined}>{i.label}</span><span className="mcard__chev"><Icon name="chevron" size={20} /></span></>;
        return i.href
          ? <Link key={i.label} className="mcard__row" to={i.href} onClick={() => haptic("select")}>{inner}</Link>
          : <button key={i.label} type="button" className="mcard__row" onClick={() => { haptic("select"); i.onClick?.(); }}>{inner}</button>;
      })}
    </section>
  );
}

const C = { blue: "var(--accent)", teal: "var(--accent)", violet: "var(--danger)", amber: "var(--gold)", rose: "var(--danger)", green: "var(--accent)", red: "var(--danger)", slate: "var(--text-3)" };

/** The menu's content (Bible Strong's MoreScreen), on its own page or in the menu drawer. */
export function MoreBody() {
  const [pin, setPin] = useState(false);
  useEffect(() => { void homeScreenStatus().then((s) => setPin(s === "missed" || s === "unknown")); }, []);
  return (
    <div className="more">
      <Card icon="bookmark" title="Yours" items={[
        { icon: "check", label: "Reading plan", color: C.green, href: "/plan" },
        { icon: "bookmark", label: "Bookmarks, highlights & notes", color: C.amber, href: "/bookmarks" },
        { icon: "tag", label: "Tags", color: C.rose, href: "/tags" },
        { icon: "clock", label: "History", color: C.blue, href: "/history" },
        { icon: "sun", label: "Sabbath", color: C.amber, href: "/sabbath" },
      ]} />
      <Card icon="book" title="Resources" items={[
        { icon: "chat", label: "Ask CyberJudah", color: C.teal, href: "/ask" },
        { icon: "play", label: "Classes", color: C.red, href: "/classes" },
        ...STUDY.map(([href, label, , icon], k) => ({ href, label, icon, colored: ["/lexicon", "/dictionary"].includes(href), color: href === "/lexicon" ? C.blue : href === "/dictionary" ? C.amber : [C.blue, C.violet, C.amber, C.green, C.rose, C.teal, C.violet, C.slate][k % 8] })),
      ]} />
      <Card icon="law" title="The Law" items={LAW.map(([href, label, , icon], k) => ({ href, label, icon, color: [C.amber, C.teal, C.slate][k % 3] }))} />
      <Card icon="gear" title="Settings" items={[
        { icon: "gear", label: "Settings", color: C.slate, href: "/settings" },
        { icon: "list", label: "Bottom bar", color: C.blue, href: "/settings/bar" },
        pin ? { icon: "star", label: "Add to Home Screen", color: C.amber, onClick: addToHomeScreen } : null,
        { icon: "download", label: "Download the vault", color: C.green, onClick: () => downloadFile(`${DATA_ORIGIN}/downloads/vault.zip`, "cyberjudah-vault.zip") },
      ]} />
      <Card icon="star" title="CyberJudah" items={[
        { icon: "share", label: "Share the app", color: C.teal, onClick: () => void share({ kind: "app", title: "CyberJudah", text: "The KJV with the Apocrypha, and everything taught from it, in Telegram.", sitePath: "/" }) },
        { icon: "link", label: "Open the full website", color: C.blue, onClick: () => openLink(SITE_URL) },
        { icon: "link", label: "The notes on GitHub", color: C.slate, onClick: () => openLink("https://github.com/DevSecObie/cyberjudah") },
      ]} />
      <p className="more__foot">The Bible text is the public-domain King James Version (1769) with the Apocrypha.{app ? ` · Telegram ${app.version} · ${app.platform}` : ""}</p>
    </div>
  );
}
