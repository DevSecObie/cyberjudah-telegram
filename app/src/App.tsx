import { historyIdx, isOver, markOver } from "@/lib/over-page";
import { NativeLifecycle } from "@/native/NativeLifecycle";
import { WorkspaceCommands } from "@/ui/WorkspaceCommands";
import { AudioPlayerProvider, AudioPlayerBar } from "@/lib/AudioPlayer";
import { useResourceSync } from "@/resources/hooks";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Route, Routes, useHref, useLocation, useNavigate, useNavigationType } from "react-router";

import { RouteSheet, sheetKind, useSheetEntry } from "@/ui/routeSheet";
import { UnderSheetContext } from "@/ui/sheetRoute";
import { initialLaunchPath } from "@/tg/launch.mjs";
import { isTabPath, keptPath, onLeaveTab, recordPath, settleTabFloor, tabChanging } from "@/lib/tabs";
import { assetUrl } from "@/lib/asset";
import { app, features, startParam } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { useSettingsButton } from "@/tg/hooks";
import { Button, PageActions, Screen, Skeleton, TabBar } from "@/ui/ui";
import { Drawers } from "@/ui/drawers";
import { ScreenBoundary } from "@/ui/boundary";
import { ThemeApplier } from "@/ui/theme";
import { Home } from "@/screens/Home";
import { Tabs as TabsScreen, NewTab } from "@/screens/Tabs";
const NoteRequests = lazy(() => import("@/screens/NoteRequests").then((m) => ({ default: m.NoteRequests })));
// Every other screen loads on first visit, so the first paint stays small: one chunk per
// screen module, shared by the routes that use it, cached by the browser afterwards.
const Search = lazy(() => import("@/screens/Search").then((m) => ({ default: m.Search })));
const Classes = lazy(() => import("@/screens/Classes").then((m) => ({ default: m.Classes })));
const NoteScreen = lazy(() => import("@/screens/Note").then((m) => ({ default: m.NoteScreen })));
const Watch = lazy(() => import("@/screens/Watch").then((m) => ({ default: m.Watch })));
const Ask = lazy(() => import("@/screens/Ask").then((m) => ({ default: m.Ask })));
const BibleTab = lazy(() => import("@/bible/BibleTab").then((m) => ({ default: m.BibleTab })));
const More = lazy(() => import("@/screens/More").then((m) => ({ default: m.More })));
const ResourceInstaller = lazy(() => import("@/screens/ResourceInstaller").then((m) => ({ default: m.ResourceInstaller })));
const ResourceReader = lazy(() => import("@/screens/ResourceReader").then((m) => ({ default: m.ResourceReader })));
const AdminGate = lazy(() => import("@/admin/AdminGate").then((m) => ({ default: m.AdminGate })));
const Account = lazy(() => import("@/screens/Account").then(m => ({ default: m.Account })));
const Settings = lazy(() => import("@/screens/Settings").then((m) => ({ default: m.Settings })));
const Help = lazy(() => import("@/screens/Help").then(m => ({ default: m.Help })));
const AudioSettings = lazy(() => import("@/screens/AudioSettings").then((m) => ({ default: m.AudioSettings })));
const Reminders = lazy(() => import("@/screens/Reminders").then((m) => ({ default: m.Reminders })));
const ReminderSync = lazy(() => import("@/screens/Reminders").then((m) => ({ default: m.ReminderSync })));
const Privacy = lazy(() => import("@/screens/Privacy").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("@/screens/Terms").then((m) => ({ default: m.Terms })));
const Donate = lazy(() => import("@/screens/Donate").then((m) => ({ default: m.Donate })));
const Timeline = lazy(() => import("@/screens/Timeline").then((m) => ({ default: m.Timeline })));
const TimelinePeriod = lazy(() => import("@/screens/Timeline").then((m) => ({ default: m.TimelinePeriod })));
const TimelineSearch = lazy(() => import("@/screens/Timeline").then((m) => ({ default: m.TimelineSearch })));
const TimelineEventScreen = lazy(() => import("@/screens/Timeline").then((m) => ({ default: m.TimelineEventScreen })));
const Credits = lazy(() => import("@/screens/Credits").then((m) => ({ default: m.Credits })));
const ReadingPlans = lazy(() => import("@/screens/ReadingPlans").then(m => ({ default: m.ReadingPlans })));
const Plan = lazy(() => import("@/screens/Plan").then((m) => ({ default: m.Plan })));
const History = lazy(() => import("@/screens/History").then((m) => ({ default: m.History })));
const Dictionary = lazy(() => import("@/screens/Dictionary").then((m) => ({ default: m.Dictionary })));
const DictionaryEntry = lazy(() => import("@/screens/Dictionary").then((m) => ({ default: m.DictionaryEntry })));
const Person = lazy(() => import("@/screens/Person").then((m) => ({ default: m.Person })));
const Place = lazy(() => import("@/screens/Place").then((m) => ({ default: m.Place })));
const Relations = lazy(() => import("@/screens/Relations").then((m) => ({ default: m.Relations })));
const Bookmarks = lazy(() => import("@/screens/Bookmarks").then((m) => ({ default: m.Bookmarks })));
const Highlights = lazy(() => import("@/screens/Highlights").then((m) => ({ default: m.Highlights })));
const Notes = lazy(() => import("@/screens/Notes").then((m) => ({ default: m.Notes })));
const Sabbath = lazy(() => import("@/screens/Sabbath").then((m) => ({ default: m.Sabbath })));
const Books = lazy(() => import("@/screens/Books").then((m) => ({ default: m.Books })));
const BookScreen = lazy(() => import("@/screens/Books").then((m) => ({ default: m.BookScreen })));
const BookChapterScreen = lazy(() => import("@/screens/Books").then((m) => ({ default: m.BookChapterScreen })));
const BookPageLink = lazy(() => import("@/screens/Books").then((m) => ({ default: m.BookPageLink })));
const LawIndex = lazy(() => import("@/screens/Laws").then((m) => ({ default: m.LawIndex })));
const LawSectionScreen = lazy(() => import("@/screens/Laws").then((m) => ({ default: m.LawSectionScreen })));
const Precepts = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Precepts })));
const PreceptScreen = lazy(() => import("@/screens/Library").then((m) => ({ default: m.PreceptScreen })));
const Cases = lazy(() => import("@/screens/Cases").then((m) => ({ default: m.Cases })));
const CaseScreen = lazy(() => import("@/screens/Cases").then((m) => ({ default: m.CaseScreen })));
const Topics = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Topics })));
const TopicScreen = lazy(() => import("@/screens/Library").then((m) => ({ default: m.TopicScreen })));
const PersonalStudies = lazy(() => import("@/screens/PersonalStudies").then(m => ({ default: m.PersonalStudies })));
const Study = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Study })));
const Encyclopedia = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Encyclopedia })));
const Glossary = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Glossary })));
const Concordance = lazy(() => import("@/screens/Library").then((m) => ({ default: m.Concordance })));
const ConcordanceBookScreen = lazy(() => import("@/screens/Library").then((m) => ({ default: m.ConcordanceBookScreen })));
const Lexicon = lazy(() => import("@/screens/Lexicon").then((m) => ({ default: m.Lexicon })));
const LexiconEntry = lazy(() => import("@/screens/Lexicon").then((m) => ({ default: m.LexiconEntry })));
const People = lazy(() => import("@/screens/People").then((m) => ({ default: m.People })));
const Tags = lazy(() => import("@/screens/Tags").then((m) => ({ default: m.Tags })));
const TagScreen = lazy(() => import("@/screens/Tags").then((m) => ({ default: m.TagScreen })));


/** Every screen, by its address: for the page, and again for a route sheet over it (ui/routeSheet). */
const routes = (
  <>
    <Route path="/" element={<Home />} />
    <Route path="/settings/admin/*" element={<AdminGate />} />
    <Route path="/settings/credits" element={<Credits />} />
    <Route path="/settings/reminders" element={<Reminders />} />
    <Route path="/settings/donate" element={<Donate />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/search" element={<Search />} />
    <Route path="/classes" element={<Classes />} />
    <Route path="/bible" element={<BibleTab />} />
    <Route path="/bible/:book" element={<BibleTab />} />
    <Route path="/bible/:book/:chapter" element={<BibleTab />} />
    <Route path="/more" element={<More />} />
    <Route path="/read/:book/:chapter" element={<BibleTab />} />
    <Route path="/note/*" element={<NoteScreen />} />
    <Route path="/watch/:video" element={<Watch />} />
    <Route path="/ask" element={<Ask />} />
    <Route path="/resources" element={<ResourceInstaller />} />
    <Route path="/resources/:id/:release" element={<ResourceReader />} />
    <Route path="/settings/account" element={<Account />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/settings/help" element={<Help />} />
    <Route path="/settings/audio" element={<AudioSettings />} />
    <Route path="/settings/requests" element={<NoteRequests />} />
    <Route path="/plans" element={<ReadingPlans />} />
    <Route path="/plan" element={<Plan />} />
    <Route path="/relations" element={<Relations />} />
    <Route path="/history" element={<History />} />
    <Route path="/dictionary" element={<Dictionary />} />
    <Route path="/dictionary/:slug" element={<DictionaryEntry />} />
    <Route path="/tabs" element={<TabsScreen />} />
    <Route path="/new" element={<NewTab />} />
    <Route path="/lexicon" element={<Lexicon />} />
    <Route path="/lexicon/:number" element={<LexiconEntry />} />
    <Route path="/people" element={<People />} />
    <Route path="/person/:id" element={<Person />} />
    <Route path="/place/:id" element={<Place />} />
    <Route path="/tags" element={<Tags />} />
    <Route path="/tags/:id" element={<TagScreen />} />
    <Route path="/books" element={<Books />} />
    <Route path="/books/:slug" element={<BookScreen />} />
    <Route path="/books/:slug/p/:page" element={<BookPageLink />} />
    <Route path="/books/:slug/:k" element={<BookChapterScreen />} />
    <Route path="/bookmarks" element={<Bookmarks />} />
    <Route path="/highlights" element={<Highlights />} />
    <Route path="/notes" element={<Notes />} />
    <Route path="/sabbath" element={<Sabbath />} />
    <Route path="/studies" element={<PersonalStudies />} />
    <Route path="/studies/:id" element={<PersonalStudies />} />
    <Route path="/study" element={<Study />} />
    <Route path="/encyclopedia" element={<Encyclopedia />} />
    <Route path="/glossary" element={<Glossary />} />
    <Route path="/concordance" element={<Concordance />} />
    <Route path="/concordance/:book" element={<ConcordanceBookScreen />} />
    <Route path="/law" element={<LawIndex />} />
    <Route path="/law/:part/:section" element={<LawSectionScreen />} />
    <Route path="/law/:part" element={<LawIndex />} />
    <Route path="/precepts" element={<Precepts />} />
    <Route path="/precepts/:slug" element={<PreceptScreen />} />
    <Route path="/timeline" element={<Timeline />} />
    <Route path="/timeline/search" element={<TimelineSearch />} />
    <Route path="/timeline/event/:slug" element={<TimelineEventScreen />} />
    <Route path="/timeline/:n" element={<TimelinePeriod />} />
    <Route path="/cases" element={<Cases />} />
    <Route path="/cases/:era/:slug" element={<CaseScreen />} />
    <Route path="/topics" element={<Topics />} />
    <Route path="/topics/:slug" element={<TopicScreen />} />
    <Route path="*" element={<Home />} />
  </>
);

export function App() {
  useResourceSync();
  const location = useLocation();
  const navType = useNavigationType();
  // A route sheet (a dictionary word, a theme, a Strong's entry…) over the page it was opened from.
  const sheet = useSheetEntry(location, navType);
  const page = sheet?.background ?? location;
  // Bible Strong's tabs: where the app is becomes the current tab's place (lib/tabs.ts); a sheet
  // over it does not move the tab, nor does a page over the workspace (lib/over-page.ts): one
  // opened from Home or the menu (a drawer, or the Home and menu pages), or further in from one.
  const prevPath = useRef<string | null>(null);
  // The history entry the tabs have been brought up to, and whether it is a route sheet.
  const tracked = useRef<{ key?: string; idx: number; sheet: boolean }>({ idx: 0, sheet: false });
  useEffect(() => {
    // The router shows a page in a transition, after the browser has gone to it. One shown only
    // after a tab change made since was already brought into the tab it was opened in (below).
    const now = window.history.state?.key as string | undefined;
    if (now !== undefined && now !== location.key && tabChanging()) return;
    tracked.current = { key: location.key, idx: historyIdx(), sheet: !!sheet };
    if (sheet) return;
    const path = location.pathname + location.search;
    const prev = prevPath.current, idx = historyIdx();
    if (navType === "PUSH" && !isOver(idx) && prev !== null && (!isTabPath(prev) || isOver(idx - 1))) markOver(idx);
    if (!isOver(idx)) recordPath(path);
    settleTabFloor(idx, navType !== "PUSH");
    prevPath.current = path;
  }, [location.key, location.pathname, location.search, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  // A tab left while the page opened in it is still on its way: that page becomes the tab's place
  // now, as it would have once shown (not a route sheet, nor a page over the workspace).
  const base = useHref("/");
  useEffect(() => onLeaveTab(() => {
    const now = window.history.state?.key as string | undefined, idx = historyIdx(), last = tracked.current;
    // Nothing on its way, or a step back (whose page was already the tab's, or not).
    if (now === undefined || now === last.key || idx < last.idx) return;
    const push = idx > last.idx;
    const at = window.location.pathname;
    const path = (base !== "/" && (at === base || at.startsWith(`${base}/`)) ? at.slice(base.length) || "/" : at) + window.location.search;
    const sheet = !!sheetKind(path) && (push || last.sheet);
    tracked.current = { key: now, idx, sheet };
    if (sheet) return;
    const prev = prevPath.current;
    if (push && !isOver(idx) && prev !== null && (!isTabPath(prev) || isOver(idx - 1))) markOver(idx);
    if (!isOver(idx)) recordPath(path);
    prevPath.current = path;
  }), [base]);
  const navigate = useNavigate();
  useSettingsButton();

  // Opening a page slides it in a little from the right and Back from the left, crossfading, as
  // Bible Strong's web page transition (220 ms, 10 px). Tab changes have their own motion (tab-motion).
  const route = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    if (navType === "REPLACE" || "tabMotion" in document.documentElement.dataset || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    route.current?.animate([{ opacity: 0, transform: `translateX(${navType === "POP" ? -10 : 10}px)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
  }, [page.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // The bar's own screens load once the app is idle, so a first switch to one never waits on its code.
  useEffect(() => {
    const load = () => { void import("@/screens/Search"); void import("@/bible/BibleTab"); void import("@/screens/Classes"); void import("@/screens/Ask"); };
    if ("requestIdleCallback" in window) { const id = requestIdleCallback(load, { timeout: 3000 }); return () => cancelIdleCallback(id); }
    const t = globalThis.setTimeout(load, 1500); return () => globalThis.clearTimeout(t);
  }, []);

  // Consume the launch once per app mount, not once per webview session. Telegram may
  // reuse that session for another shared link. Explicit routes survive refreshes.
  const launchHandled = useRef(false);
  useEffect(() => {
    if (launchHandled.current) return;
    launchHandled.current = true;
    const to = initialLaunchPath(location.pathname, startParam, location.search ? undefined : keptPath());
    if (to) navigate(to, { replace: true });
  }, [location.pathname, navigate]);

  // The tab bar stays on every screen, as in an iOS app, except the player, which takes the screen.
  // The tab bar stays through a class note or a recording: a reader who came from a verse is still in the app.
  const tabs = true;
  return (
    <div className="cj" id="shell" data-tabs={tabs ? "" : undefined}>
      <AudioPlayerProvider>
      <ThemeApplier />
      <NativeLifecycle />
      <WorkspaceCommands />
      <Lock />
      <div ref={route} className="route" data-location-key={page.key} key={page.pathname.split("/").slice(0, 2).join("/")}>
      <ScreenBoundary resetKey={page.pathname}>
      <Suspense fallback={<Screen className="route-loading"><Skeleton rows={8} /></Screen>}>
      <UnderSheetContext.Provider value={!!sheet}><Routes location={sheet ? page : undefined}>{routes}</Routes></UnderSheetContext.Provider>
      </Suspense>
      </ScreenBoundary>
      </div>
      {sheet ? <RouteSheet entry={sheet} path={location.pathname} label="Sheet"><ScreenBoundary resetKey={location.pathname}><Suspense fallback={<Skeleton rows={6} />}><Routes location={location}>{routes}</Routes></Suspense></ScreenBoundary></RouteSheet> : null}
      <Suspense fallback={null}><ReminderSync /></Suspense>
      <AudioPlayerBar />
      <PageActions />
      <Drawers />
      {tabs ? <TabBar /> : null}
      </AudioPlayerProvider>
    </div>
  );
}

/**
 * Optional app lock with the device's biometrics (7.2): when the reader turned it on in
 * Settings, the app asks for a fingerprint or face before showing anything, each time it
 * opens. The preference lives in SecureStorage so it never leaves the device.
 */
function Lock() {
  const [locked, setLocked] = useState<boolean | null>(null);
  const cover = useRef<HTMLDivElement>(null);
  // Whatever the cover hides is also out of reach: every part of the page except the lock itself
  // (its route, drawers, sheets and the tab bar, and anything opened while it shows) is inert and
  // hidden from assistive technology, so a screen reader cannot read behind it.
  const covering = locked === true || (locked === null && features.biometrics && features.secureStorage);
  useLayoutEffect(() => {
    const el = cover.current;
    if (!covering || !el) return;
    const hidden: Element[] = [];
    const hide = (n: Element) => {
      if (n === el || n.contains(el) || n.hasAttribute("inert") || n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
      n.setAttribute("inert", ""); n.setAttribute("aria-hidden", "true"); hidden.push(n);
    };
    const chain: Element[] = [];
    for (let n: Element | null = el.parentElement; n && n !== document.documentElement; n = n.parentElement) chain.push(n);
    for (const parent of chain) for (const child of Array.from(parent.children)) hide(child);
    const watch = new MutationObserver((records) => { for (const r of records) r.addedNodes.forEach((n) => { if (n instanceof Element) hide(n); }); });
    for (const parent of chain) watch.observe(parent, { childList: true });
    return () => { watch.disconnect(); for (const n of hidden) { n.removeAttribute("inert"); n.removeAttribute("aria-hidden"); } };
  }, [covering]);
  useEffect(() => {
    if (!features.biometrics || !features.secureStorage) { setLocked(false); return; }
    void secure.get("lock").then((v) => setLocked(v === "on"));
  }, []);
  useEffect(() => {
    if (!locked) return;
    const bm = app!.BiometricManager;
    const ask = () => bm.authenticate({ reason: "Unlock CyberJudah" }, (ok) => { if (ok) setLocked(false); });
    if (bm.isInited) ask(); else bm.init(ask);
  }, [locked]);
  // Until the preference is read, a device that can lock is covered, so no screen (a reopened tab
  // included) shows before the lock has had its say.
  if (!covering) return null;
  // One element for checking and locked alike, so the page stays hidden across the change.
  return (
    <div ref={cover} className="lock" data-checking={locked === null ? "" : undefined} role={locked ? "dialog" : undefined} aria-modal={locked ? "true" : undefined} aria-label={locked ? "Locked" : undefined} aria-hidden={locked ? undefined : "true"}>
      {locked ? (
        <div>
          <img src={assetUrl("brand/cyber-lion.webp")} alt="" />
          <h1>CyberJudah</h1>
          <p>Unlock with your fingerprint or face.</p>
          <Button size="xl" onClick={() => app!.BiometricManager.authenticate({ reason: "Unlock CyberJudah" }, (ok) => { if (ok) setLocked(false); })}>Unlock</Button>
        </div>
      ) : null}
    </div>
  );
}
