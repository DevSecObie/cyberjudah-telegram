import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useBookmarks, useProgress, chaptersRead } from "@/lib/marks";
import { share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { addToHomeScreen, app, downloadFile, features, homeScreenStatus, openLink } from "@/tg/sdk";
import { DATA_ORIGIN, SITE_URL } from "@/api/data";
import { List, Row, Screen, Section, type IconName } from "@/ui/ui";

const STUDY: [string, string, string, IconName][] = [
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter", "book"],
  ["/books", "Library", "Books the classes read from, with their maps and pictures", "layers"],
  ["/dictionary", "Dictionary", "Easton's: names, places and words", "type"],
  ["/encyclopedia", "Encyclopedia", "Standing subjects, book by book", "layers"],
  ["/topics", "Topics", "Classes and episodes by what they cover", "tag"],
];
const LAW: [string, string, string, IconName][] = [
  ["/law", "The Law", "The handbook, every law with its scripture", "law"],
  ["/precepts", "Precepts", "Every subject scripture speaks to, A to Z", "quote"],
  ["/cases", "Case studies", "Judgments, and those who kept the law and were blessed", "folder"],
];

export function More() {
  useBackButton(true);
  const [pin, setPin] = useState(false);
  const [marks] = useBookmarks();
  const [progress] = useProgress();
  useEffect(() => { void homeScreenStatus().then((s) => setPin(s === "missed" || s === "unknown")); }, []);
  return (
    <Screen title="More">
      <Section title="Yours">
        <List>
          <Row href="/plan" icon="check" title="Reading plan" sub="The whole library, a few chapters a day" />
          <Row href="/bookmarks" icon="bookmark" title="Bookmarks, highlights & notes" sub={marks.length ? `${marks.length} bookmarks` : "Verses and classes you keep"} />
          <Row href="/history" icon="clock" title="History" sub="The chapters you opened" />
          <Row href="/sabbath" icon="sun" title="Sabbath" sub="Sunset where you are, and the countdown" />
          <Row href="/settings" icon="gear" title="Settings" sub={`Daily verse, lock, text size${chaptersRead(progress) ? ` · ${chaptersRead(progress)} chapters read` : ""}`} />
        </List>
      </Section>
      <Section title="Ask"><List><Row href="/ask" icon="note" title="Ask CyberJudah" sub="Ask anything about what was taught; answers with their sources" /></List></Section>
      <Section title="Study"><List>{STUDY.map(([to, t, s, i]) => <Row key={to} href={to} icon={i} title={t} sub={s} />)}</List></Section>
      <Section title="Law"><List>{LAW.map(([to, t, s, i]) => <Row key={to} href={to} icon={i} title={t} sub={s} />)}</List></Section>
      <Section title="CyberJudah">
        <List>
          <Row onClick={() => void share({ kind: "app", title: "CyberJudah", text: "The KJV with the Apocrypha, and everything taught from it, in Telegram.", sitePath: "/" })} icon="share" title="Share the app" sub="Send it to a chat" />
          {pin ? <Row onClick={addToHomeScreen} icon="star" title="Add to Home Screen" sub="Open CyberJudah in one tap" /> : null}
          <Row onClick={() => downloadFile(`${DATA_ORIGIN}/downloads/vault.zip`, "cyberjudah-vault.zip")} icon="note" title="Download the vault" sub={features.download ? "The whole library as an Obsidian vault, through Telegram" : "The whole library as an Obsidian vault"} />
          <Row onClick={() => openLink(SITE_URL)} icon="link" title="Open the full website" sub="cyberjudah.io" />
          <Row onClick={() => openLink("https://github.com/DevSecObie/cyberjudah")} icon="link" title="The notes on GitHub" sub="Where the text and the notes come from" />
        </List>
      </Section>
      <p className="hint" style={{ textAlign: "center" }}>The Bible text is the public-domain King James Version (1769) with the Apocrypha.{app ? ` · Telegram ${app.version} · ${app.platform}` : ""}</p>
      <Link to="/settings" style={{ display: "none" }}>Settings</Link>
    </Screen>
  );
}
