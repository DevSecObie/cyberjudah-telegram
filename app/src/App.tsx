import { AudioPlayerProvider, AudioPlayerBar } from "@/lib/AudioPlayer";
import { useResourceSync } from "@/resources/hooks";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";

import { launchPath } from "@shared/links.mjs";
import { isTabPath, recordPath } from "@/lib/tabs";
import { assetUrl } from "@/lib/asset";
import { app, features, startParam } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { useSettingsButton } from "@/tg/hooks";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Button, PageActions, Screen, Skeleton, TabBar } from "@/ui/ui";
import { Drawers } from "@/ui/drawers";
import { ScreenBoundary } from "@/ui/boundary";
import { ThemeApplier, useAppTheme } from "@/ui/theme";
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
const NavEditor = lazy(() => import("@/screens/NavEditor").then((m) => ({ default: m.NavEditor })));
const Settings = lazy(() => import("@/screens/Settings").then((m) => ({ default: m.Settings })));
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
const Plan = lazy(() => import("@/screens/Plan").then((m) => ({ default: m.Plan })));
const History = lazy(() => import("@/screens/History").then((m) => ({ default: m.History })));
const Dictionary = lazy(() => import("@/screens/Dictionary").then((m) => ({ default: m.Dictionary })));
const DictionaryEntry = lazy(() => import("@/screens/Dictionary").then((m) => ({ default: m.DictionaryEntry })));
const Person = lazy(() => import("@/screens/Person").then((m) => ({ default: m.Person })));
const Relations = lazy(() => import("@/screens/Relations").then((m) => ({ default: m.Relations })));
const Bookmarks = lazy(() => import("@/screens/Bookmarks").then((m) => ({ default: m.Bookmarks })));
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


export function App() {
  useResourceSync();
  const location = useLocation();
  // Bible Strong's tabs: where the app is becomes the current tab's place (lib/tabs.ts).
  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    const path = location.pathname + location.search;
    const prev = prevPath.current;
    recordPath(path, prev !== null && !isTabPath(prev));
    prevPath.current = path;
  }, [location.pathname, location.search]);
  const navigate = useNavigate();
  useSettingsButton();

  // A launch with a start param (a shared verse, a class) lands on that screen, once.
  useEffect(() => {
    if (!startParam) return;
    try { if (sessionStorage.getItem("launched")) return; sessionStorage.setItem("launched", "1"); } catch { /* ignore */ }
    const to = launchPath(startParam);
    if (to !== "/") navigate(to, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The tab bar stays on every screen, as in an iOS app, except the player, which takes the screen.
  // The tab bar stays through a class note or a recording: a reader who came from a verse is still in the app.
  const tabs = true;
  // Like an iOS app, the look follows the phone (through Telegram) until the reader picks one.
  // One theme for the whole app: the Bible's day or night colour, following the phone until the reader picks one.
  const appearance = useAppTheme().dark ? "dark" : "light";
  return (
    <AppRoot className="cj" appearance={appearance} platform={app?.platform === "ios" || app?.platform === "macos" ? "ios" : "base"} id="shell" data-tabs={tabs ? "" : undefined}>
      <AudioPlayerProvider>
      <ThemeApplier />
      <Lock />
      <div className="route" data-location-key={location.key} key={location.pathname.split("/").slice(0, 2).join("/")}>
      <ScreenBoundary resetKey={location.pathname}>
      <Suspense fallback={<Screen className="route-loading"><Skeleton rows={8} /></Screen>}>
      <Routes>
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
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/audio" element={<AudioSettings />} />
        <Route path="/settings/bar" element={<NavEditor />} />
        <Route path="/settings/requests" element={<NoteRequests />} />
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
        <Route path="/tags" element={<Tags />} />
        <Route path="/tags/:id" element={<TagScreen />} />
        <Route path="/books" element={<Books />} />
        <Route path="/books/:slug" element={<BookScreen />} />
        <Route path="/books/:slug/p/:page" element={<BookPageLink />} />
        <Route path="/books/:slug/:k" element={<BookChapterScreen />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
        <Route path="/sabbath" element={<Sabbath />} />
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
      </Routes>
      </Suspense>
      </ScreenBoundary>
      </div>
      <Suspense fallback={null}><ReminderSync /></Suspense>
      <AudioPlayerBar />
      <PageActions />
      <Drawers />
      {tabs ? <TabBar /> : null}
      </AudioPlayerProvider>
    </AppRoot>
  );
}

/**
 * Optional app lock with the device's biometrics (7.2): when the reader turned it on in
 * Settings, the app asks for a fingerprint or face before showing anything, each time it
 * opens. The preference lives in SecureStorage so it never leaves the device.
 */
function Lock() {
  const [locked, setLocked] = useState<boolean | null>(null);
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
  if (!locked) return null;
  return (
    <div className="lock" role="dialog" aria-label="Locked">
      <div>
        <img src={assetUrl("brand/cyber-lion.webp")} alt="" />
        <h1>CyberJudah</h1>
        <p>Unlock with your fingerprint or face.</p>
        <Button size="xl" onClick={() => app!.BiometricManager.authenticate({ reason: "Unlock CyberJudah" }, (ok) => { if (ok) setLocked(false); })}>Unlock</Button>
      </div>
    </div>
  );
}
