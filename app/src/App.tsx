import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";

import { launchPath } from "@shared/links.mjs";
import { app, features, startParam } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { useSettingsButton, useStored, useTheme } from "@/tg/hooks";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Button, TabBar } from "@/ui/ui";
import { Home } from "@/screens/Home";
import { Search } from "@/screens/Search";
import { Classes } from "@/screens/Classes";
import { NoteScreen } from "@/screens/Note";
import { Watch } from "@/screens/Watch";
import { Ask } from "@/screens/Ask";
import { BibleTab } from "@/bible/BibleTab";
import { More } from "@/screens/More";
import { Settings, ThemeApplier } from "@/screens/Settings";
import { Plan } from "@/screens/Plan";
import { History } from "@/screens/History";
import { Dictionary, DictionaryEntry } from "@/screens/Dictionary";
import { Person } from "./screens/Person";
import { Relations } from "@/screens/Relations";
import { Bookmarks } from "@/screens/Bookmarks";
import { Sabbath } from "@/screens/Sabbath";
import { BookChapterScreen, BookPageLink, Books, BookScreen } from "@/screens/Books";
import { LawIndex, LawSectionScreen, Precepts, PreceptScreen, Cases, CaseScreen, Topics, TopicScreen, Study, Encyclopedia } from "@/screens/Library";


export function App() {
  const location = useLocation();
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
  const [theme] = useStored<string>("theme", "system");
  const { scheme } = useTheme();
  const appearance = theme === "light" || theme === "sepia" ? "light" : theme === "system" ? scheme : "dark";
  return (
    <AppRoot className="cj" appearance={appearance} platform={app?.platform === "ios" || app?.platform === "macos" ? "ios" : "base"} id="shell" data-tabs={tabs ? "" : undefined}>
      <ThemeApplier />
      <Lock />
      <Routes>
        <Route path="/" element={<Home />} />
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
        <Route path="/settings" element={<Settings />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/relations" element={<Relations />} />
        <Route path="/history" element={<History />} />
        <Route path="/dictionary" element={<Dictionary />} />
        <Route path="/dictionary/:slug" element={<DictionaryEntry />} />
        <Route path="/person/:id" element={<Person />} />
        <Route path="/books" element={<Books />} />
        <Route path="/books/:slug" element={<BookScreen />} />
        <Route path="/books/:slug/p/:page" element={<BookPageLink />} />
        <Route path="/books/:slug/:k" element={<BookChapterScreen />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
        <Route path="/sabbath" element={<Sabbath />} />
        <Route path="/study" element={<Study />} />
        <Route path="/encyclopedia" element={<Encyclopedia />} />
        <Route path="/law" element={<LawIndex />} />
        <Route path="/law/:part/:section" element={<LawSectionScreen />} />
        <Route path="/law/:part" element={<LawIndex />} />
        <Route path="/precepts" element={<Precepts />} />
        <Route path="/precepts/:slug" element={<PreceptScreen />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:era/:slug" element={<CaseScreen />} />
        <Route path="/topics" element={<Topics />} />
        <Route path="/topics/:slug" element={<TopicScreen />} />
        <Route path="*" element={<Home />} />
      </Routes>
      {tabs ? <TabBar /> : null}
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
        <img src="/brand/cyber-lion.webp" alt="" />
        <h1>CyberJudah</h1>
        <p>Unlock with your fingerprint or face.</p>
        <Button size="l" onClick={() => app!.BiometricManager.authenticate({ reason: "Unlock CyberJudah" }, (ok) => { if (ok) setLocked(false); })}>Unlock</Button>
      </div>
    </div>
  );
}
