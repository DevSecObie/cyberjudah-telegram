import { useNavigate } from "react-router";

import { closeAll, closeTab, newTab, selectTab, tabKind, tabPlace, useTabs } from "@/lib/tabs";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Icon, Screen, type IconName } from "@/ui/ui";

/** Bible Strong's New Tab page (TabScreen/NewTab/NewTabContent): every resource, by section, each opening in this tab. */
type Item = [to: string, title: string, description: string, icon: IconName];
const READ: Item[] = [
  ["/plan", "Reading plan", "Follow a reading plan", "check"],
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter", "book"],
  ["/history", "Our Hidden History", "Explore our history, episode by episode", "history"],
];
const PERSONAL: Item[] = [
  ["/classes", "Classes", "Every Sabbath class, with its notes", "play"],
  ["/bookmarks", "Kept", "Your highlights, notes and bookmarks", "bookmark"],
  ["/ask", "Ask CyberJudah", "Answers from the teachings, with their sources", "chat"],
];
const LIBRARY: Item[] = [
  ["/lexicon", "Strong", "Explore Greek and Hebrew words", "spark"],
  ["/topics", "Topics", "Explore what the classes taught, by theme", "tag"],
  ["/dictionary", "Dictionary", "Look up definitions", "type"],
  ["/precepts", "Precepts", "Every subject scripture speaks to", "quote"],
  ["/people", "People", "Everyone named in the Bible", "star"],
  ["/books", "Library", "The books the classes read from", "layers"],
  ["/encyclopedia", "Encyclopedia", "Standing subjects, book by book", "book"],
  ["/law", "The Law", "Every law with its scripture", "law"],
  ["/cases", "Case studies", "Judgments, and those who were blessed", "folder"],
];

export function NewTab() {
  useBackButton(true);
  const navigate = useNavigate();
  const open = (to: string) => { haptic("select"); navigate(to, { replace: true }); };
  const Row = ({ item: [to, title, description, icon] }: { item: Item }) => (
    <button type="button" className="nt-item" onClick={() => open(to)}>
      <span className="nt-item__icon"><Icon name={icon} size={22} /></span>
      <span className="nt-item__body"><b>{title}</b><small>{description}</small></span>
      <Icon name="chevron" size={18} />
    </button>
  );
  return (
    <Screen className="newtab">
      <h1 className="nt-heading">What would you like to explore?</h1>
      <h2 className="shelf">Read and explore</h2>
      <button type="button" className="nt-hero" onClick={() => open("/bible")}>
        <span className="nt-hero__icon"><Icon name="book" size={40} /></span>
        <span className="nt-hero__body"><b>Bible</b><small>Open the Bible and start reading</small></span>
        <Icon name="chevron" size={22} />
      </button>
      <div className="nt-list">{READ.map((i) => <Row key={i[0]} item={i} />)}</div>
      <h2 className="shelf">Classes and notes</h2>
      <div className="nt-list">{PERSONAL.map((i) => <Row key={i[0]} item={i} />)}</div>
      <h2 className="shelf">Library</h2>
      <div className="nt-list">{LIBRARY.map((i) => <Row key={i[0]} item={i} />)}</div>
    </Screen>
  );
}

/** Bible Strong's tab switcher: every open tab as a card; tap to go, ✕ to close, + for a new tab. */
export function Tabs() {
  useBackButton(true);
  const navigate = useNavigate();
  const { tabs, current } = useTabs();
  const go = (path: string) => { haptic("select"); navigate(path, { replace: true }); };
  return (
    <Screen title="Tabs" kicker={`${tabs.length} open`} action={<button type="button" className="icon-btn" aria-label="Close all tabs" onClick={() => { closeAll(); haptic("select"); }}><Icon name="trash" size={18} /></button>}>
      <div className="tabs-grid">
        {tabs.map((t) => {
          const { kind, icon } = tabKind(t.path);
          const place = tabPlace(t.path);
          return (
            <div key={t.id} className="tabcard" data-current={t.id === current ? "" : undefined}>
              <button type="button" className="tabcard__open" onClick={() => go(selectTab(t.id))} aria-label={`Open ${kind}${place ? ` ${place}` : ""}`}>
                <span className="tabcard__icon"><Icon name={icon as IconName} size={26} /></span>
                <b>{kind}</b>
                {place ? <small>{place}</small> : null}
              </button>
              <button type="button" className="tabcard__close" aria-label={`Close ${kind}`} onClick={() => { haptic("select"); closeTab(t.id); }}>✕</button>
            </div>
          );
        })}
        <button type="button" className="tabcard tabcard--new" onClick={() => go(newTab())}><span className="tabcard__icon"><Icon name="compose" size={26} /></span><b>New tab</b></button>
      </div>
    </Screen>
  );
}
