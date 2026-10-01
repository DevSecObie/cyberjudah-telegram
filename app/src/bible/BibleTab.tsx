import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { compressVerses, data, verseNumbers } from "@/api/data";
import { isRead, markRead, pushHistory, unmarkRead, useHistory, useLast, usePlan, useProgress } from "@/lib/marks";
import { advance, planDay } from "@/lib/plan";
import { createRelation, deleteRelation, endpointHref, useChapterRelations, verseKey, type Endpoint, type Relation, type VerseEndpoint, type VerseRelationItem } from "@/lib/relations";
import { share } from "@/lib/share";
import { useSpeech } from "@/lib/tts";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { alert, app, haptic, openLink } from "@/tg/sdk";
import { RelationTargetPicker } from "@/screens/Relations";
import { Chapter, HEADER_HEIGHT, HEADER_HEIGHT_MIN, PASSAGE_CONTEXT_HEADER_HEIGHT } from "./dom/Chapter";
import { colorItems, paletteOf, resolveTheme, telegramScheme, useBibleSettings, useSchemeChange } from "./settings";
import { cssVars, isDarkTheme } from "./theme";
import { keyOfVerses, readNote, useBookmarks, useChapterHighlights, useChapterLinks, useChapterNotes, useTags, uuid, versesContent, verseToReference, writeNote, type Bookmark, type Highlight, type Note } from "./store";
import { BookSelectorSheet, VersePopup } from "./ui/BookSelectorSheet";
import { BookmarkSheet, LinkSheet, NoteSheet, TagsPanel } from "./ui/Editors";
import { ChapterEnd } from "./ui/ChapterEnd";
import { ChapterPeople } from "./ui/ChapterPeople";
import { SearchSheet } from "./ui/SearchSheet";
import { Footer } from "./ui/Footer";
import { Header, PassageContextBar, VersionSheet, type MenuAction } from "./ui/Header";
import { ParamsSheet } from "./ui/ParamsSheet";
import { ResourcesSheet, type ResourceTab } from "./ui/ResourcesSheet";
import { CompareSheet } from "./ui/CompareSheet";
import { isWhy, slugOfUrl, useMomentsByVerse, useTaughtRelations, whyVerse } from "@/lib/taught";
import { MediaDeck, deckKey } from "./dom/MediaDeck";
import { newTab, selectTab } from "@/lib/tabs";
import { WhySheet } from "./ui/WhySheet";
import { SelectedVersesSheet } from "./ui/SelectedVersesSheet";
import "./bible.css";

/**
 * The Bible tab, as Bible Strong's BibleTabScreen: header, the chapter, the footer, and
 * every sheet the reading opens. State that Bible Strong keeps per tab (selected verses,
 * focus verses, context mode, fullscreen) lives here; the study data and the settings live
 * in Telegram's cloud storage.
 */
export function BibleTab() {
  const { book: slugParam, chapter: chapterParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [last, setLast, lastLoaded] = useLast();
  const slug = slugParam ?? last?.slug ?? "genesis";
  const ch = chapterParam ? Number(chapterParam) : last?.chapter ?? 1;
  useEffect(() => { if (!slugParam && lastLoaded) navigate(`/read/${slug}/${ch}`, { replace: true }); }, [slugParam, lastLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const [settings, setSettings] = useBibleSettings();
  const [scheme, setScheme] = useState(telegramScheme);
  useSchemeChange(useCallback(() => setScheme(telegramScheme()), []));
  const theme = resolveTheme(settings, scheme);
  const palette = useMemo(() => paletteOf(theme, settings), [theme, settings]);
  useEffect(() => {
    // Telegram's chrome takes the page colour while the tab is open, and gives it back after.
    if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(palette.reverse); app.setBackgroundColor(palette.reverse); }
    if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(palette.reverse);
    // So does the bottom bar, with the Bible's hairline.
    const root = document.documentElement.style;
    root.setProperty("--a-bar", palette.reverse); root.setProperty("--a-bar-line", palette.border);
    return () => { root.removeProperty("--a-bar"); root.removeProperty("--a-bar-line"); const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-void").trim() || "#05070f"; if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(bg); app.setBackgroundColor(bg); } if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(bg); };
  }, [palette.reverse]);

  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const list = books.data ?? [];
  const idx = list.findIndex((b) => b.slug === slug);
  const book = list[idx];
  const bookName = useCallback((s: string) => list.find((b) => b.slug === s)?.book ?? s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), [list]);
  const text = useQuery({ queryKey: ["chapter", slug, ch], queryFn: () => data.chapter(slug, ch), staleTime: Infinity });
  const verses = text.data?.verses ?? [];
  const next = book && ch < book.chapters ? { slug, ch: ch + 1 } : list[idx + 1] ? { slug: list[idx + 1].slug, ch: 1 } : null;
  const prev = book && ch > 1 ? { slug, ch: ch - 1 } : idx > 0 ? { slug: list[idx - 1].slug, ch: list[idx - 1].chapters } : null;
  const go = (t: { slug: string; ch: number } | null, verse?: number) => { if (t) navigate(`/read/${t.slug}/${t.ch}${verse && verse > 1 ? `?v=${verse}` : ""}`); };

  // Per-tab state.
  const [selected, setSelected] = useState<number[]>([]);
  const focus = useMemo(() => { const v = verseNumbers(params.get("v")); return v.length ? v : null; }, [params]);
  const [contextMode, setContextMode] = useState<"focused" | "fullChapter">(focus ? "focused" : "fullChapter");
  const [fullscreen, setFullscreen] = useState(false);
  const [verseToScroll, setVerseToScroll] = useState<number | undefined>(focus?.[0]);
  const [navRequest, setNavRequest] = useState(0);
  useEffect(() => { setSelected([]); setFullscreen(false); setContextMode(focus ? "focused" : "fullChapter"); setVerseToScroll(focus?.[0] ?? 1); }, [slug, ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) { setContextMode("focused"); setVerseToScroll(focus[0]); } else setContextMode("fullChapter"); }, [focus?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Study data.
  const [highlights, setHighlights] = useChapterHighlights(slug, ch);
  const [notes, setNotes] = useChapterNotes(slug, ch);
  const [links, setLinks] = useChapterLinks(slug, ch);
  const [bookmarks, setBookmarks] = useBookmarks();
  const [tags, setTags] = useTags();
  const rel = useChapterRelations(slug, ch, settings.relationsDisplay);
  // The precepts the classes lined up with these verses, under each verse beside the reader's own relations.
  const taught = useTaughtRelations(slug, ch, settings.relationsDisplay);
  const relItems = useMemo(() => { const out: Record<number, VerseRelationItem[]> = { ...rel.items }; for (const [v, items] of Object.entries(taught)) out[+v] = [...(out[+v] ?? []), ...items]; return out; }, [rel.items, taught]);
  const [progress, setProgress] = useProgress();
  const [plan, setPlan] = usePlan();
  const [history, setHistory] = useHistory();
  const reference = (vs: number[]) => verseToReference(vs.map((v) => verseKey(slug, ch, v)), bookName);
  const chapterLabel = book ? `${book.book} ${ch}` : "";
  const selectedText = () => verses.filter((v) => selected.includes(v.verse)).map((v) => ({ verse: v.verse, text: v.text }));

  // Where they left off, the history, the chapter counted as read after a while, the plan moving on.
  useEffect(() => { if (chapterLabel) { setLast({ slug, chapter: ch, name: chapterLabel, at: Date.now() }); setHistory(pushHistory(history, { slug, chapter: ch, name: chapterLabel })); } }, [slug, ch, chapterLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const progressRef = useRef(progress); progressRef.current = progress;
  useEffect(() => { const t = setTimeout(() => setProgress(markRead(progressRef.current, slug, ch)), 20_000); return () => clearTimeout(t); }, [slug, ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!plan || !list.length || !planDay(plan, list, progress).done) return;
    const next = advance(plan); setPlan(next); haptic("success");
    const tomorrow = planDay(next, list, progress);
    say(`Day ${plan.day + 1} done${next.streak > 1 ? ` · ${next.streak} day streak` : ""}${tomorrow.chapters.length ? ` · next: ${tomorrow.label}` : ""}`);
  }, [plan, list, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sheets.
  const [sheet, setSheet] = useState<null | "books" | "version" | "verses" | "params" | "bookmark" | "tags" | "note" | "link" | "relation" | "resources" | "export" | "why" | "search" | "compare">(null);
  // The classes that taught each verse: pictures after the verses, as Bible Strong shows its videos.
  const classMoments = useMomentsByVerse(slug, ch);
  // The chapter's own deck, at its end: every class moment in it, in the order of the verses.
  const chapterDeck = useMemo(() => Object.entries(classMoments.data ?? {}).sort(([a], [b]) => +a - +b).flatMap(([, ms]) => ms)
    .filter((m, i, all) => all.findIndex((x) => deckKey(x) === deckKey(m)) === i), [classMoments.data]);
  const [whyAt, setWhyAt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resourceTab, setResourceTab] = useState<ResourceTab>("dictionary");
  const [resourceVerse, setResourceVerse] = useState<number>(1);
  const [bookmarkTarget, setBookmarkTarget] = useState<{ verse?: number; existing?: Bookmark }>({});
  const [noteEdit, setNoteEdit] = useState<{ key: string; note: Note; relation?: Relation } | null>(null);
  const [tagsTarget, setTagsTarget] = useState<number[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };
  const speech = useSpeech(verses, chapterLabel, slug && ch ? { slug, chapter: ch } : undefined);
  const [repeat, setRepeat] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  useEffect(() => { if (speech.completed && audioOpen && repeat && verses.length) speech.play(1); }, [speech.completed, audioOpen, repeat]); // eslint-disable-line react-hooks/exhaustive-deps

  useBottomButtons(null, null);
  useBackButton(true, () => {
    if (sheet) { setSheet(null); return true; }
    if (menuOpen) { setMenuOpen(false); return true; }
    if (selected.length) { setSelected([]); return true; }
    return false;
  });

  // Selection.
  const toggleVerse = (v: number) => { haptic("select"); setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v])); };
  const selectedSorted = [...selected].sort((a, b) => a - b);
  const selectedKeys = selectedSorted.map((v) => verseKey(slug, ch, v));
  const selectedReference = selected.length ? reference(selectedSorted) : null;
  const selectedColor = selected.length && selected.every((v) => highlights[String(v)]?.color && highlights[String(v)].color === highlights[String(selected[0])].color) ? highlights[String(selected[0])].color : null;
  const first = selectedSorted[0];
  const hasBookmark = !!first && bookmarks.some((b) => b.book === slug && b.chapter === ch && b.verse === first);
  const hasFocus = !!focus && selected.some((v) => focus.includes(v));
  const verseEndpoint = (): VerseEndpoint => ({ type: "verse", verseKeys: selectedKeys, label: selectedReference ?? "" });

  const addHighlight = (color: string) => { const now = Date.now(); const nextHl = { ...highlights }; for (const v of selected) nextHl[String(v)] = { color, date: now, tags: highlights[String(v)]?.tags }; setHighlights(nextHl); haptic("success"); };
  const removeHighlight = () => { const nextHl = { ...highlights }; for (const v of selected) { const h = nextHl[String(v)]; if (h?.tags && Object.keys(h.tags).length) nextHl[String(v)] = { ...h, color: "" }; else delete nextHl[String(v)]; } setHighlights(nextHl); };
  const toggleTag = (tagId: string) => {
    const on = tagsTarget.some((v) => highlights[String(v)]?.tags?.[tagId]);
    const nextHl = { ...highlights }; const now = Date.now();
    for (const v of tagsTarget) { const h: Highlight = nextHl[String(v)] ?? { color: "", date: now }; const t = { ...(h.tags ?? {}) }; if (on) delete t[tagId]; else t[tagId] = true; nextHl[String(v)] = { ...h, tags: Object.keys(t).length ? t : undefined }; if (!nextHl[String(v)].color && !nextHl[String(v)].tags) delete nextHl[String(v)]; }
    setHighlights(nextHl);
  };
  const tagsSelected = Object.assign({}, ...tagsTarget.map((v) => highlights[String(v)]?.tags ?? {})) as Record<string, true>;

  const setFocus = () => {
    if (hasFocus) { setParams({}, { replace: true }); setSelected([]); return; }
    setParams({ v: compressVerses(selectedSorted) }, { replace: true }); setContextMode("focused"); setSelected([]);
  };
  const clearFocus = () => { setParams({}, { replace: true }); setContextMode("fullChapter"); };

  const saveNote = async (v: { title: string; description: string }) => {
    if (noteEdit) {
      const n = { ...noteEdit.note, title: v.title, description: v.description, date: Date.now() };
      await writeNote(slug, ch, noteEdit.key, n); setNotes({ ...notes, [noteEdit.key]: n });
      setNoteEdit(null); setSheet(null); say("Note saved"); return;
    }
    const key = keyOfVerses(selectedSorted); const n: Note = { id: uuid(), title: v.title, description: v.description, date: Date.now() };
    await writeNote(slug, ch, key, n); setNotes({ ...notes, [key]: n });
    await createRelation([verseEndpoint(), { type: "note", verseKey: selectedKeys[0], label: v.title || v.description.slice(0, 60) || "Untitled note" }]);
    setSheet(null); setSelected([]); haptic("success");
  };
  const removeNote = async () => {
    if (!noteEdit) return;
    await writeNote(slug, ch, noteEdit.key, null); const n = { ...notes }; delete n[noteEdit.key]; setNotes(n);
    if (noteEdit.relation) await deleteRelation(noteEdit.relation);
    setNoteEdit(null); setSheet(null); say("Deleted note");
  };
  const saveLink = async (v: { url: string; title: string; linkType: string }) => {
    const key = keyOfVerses(selectedSorted);
    setLinks({ ...links, [key]: { id: uuid(), url: v.url, title: v.title, linkType: v.linkType, date: Date.now() } });
    await createRelation([verseEndpoint(), { type: "link", url: v.url, label: v.title }]);
    setSheet(null); setSelected([]); haptic("success");
  };
  const openRelationItem = async (it: VerseRelationItem) => {
    const t = it.target;
    // The library's note on a verse's precepts: why they are there.
    if (isWhy(it.relation)) { setWhyAt(whyVerse(it.relation)); setSheet("why"); return; }
    if (t.type === "note") { const found = await readNote(t.verseKey); if (found) { setNoteEdit({ key: found.key, note: found.note, relation: it.relation }); setSheet("note"); } else void alert("This note no longer exists"); return; }
    if (t.type === "link") { openLink(endpointHref(t)); return; }
    navigate(endpointHref(t));
  };

  const copy = async () => { const c = versesContent(selectedText(), selectedReference ?? "", settings.shareVerses); try { await navigator.clipboard.writeText(c.all); say("Copied to the clipboard."); haptic("success"); } catch { void alert("Copying is not allowed here."); } };
  const shareSel = () => { const c = versesContent(selectedText(), selectedReference ?? "", settings.shareVerses); void share({ kind: "verse", title: selectedReference ?? chapterLabel, text: c.content.trim(), sitePath: `/bible/${slug}/${ch}`, verses: compressVerses(selectedSorted) }); };
  const exportSel = async (scope: "selection" | "chapter") => {
    const rows = scope === "selection" ? selectedText() : verses.map((v) => ({ verse: v.verse, text: v.text }));
    const ref = scope === "selection" ? selectedReference ?? chapterLabel : chapterLabel;
    const lines = [`${ref} (KJV)`, "", ...rows.map((r) => `${r.verse}. ${r.text}`)];
    const noteRows = Object.entries(notes).filter(([k]) => scope === "chapter" || k.split("/").some((v) => selected.includes(+v)));
    if (noteRows.length) lines.push("", "NOTES", ...noteRows.map(([k, n]) => `${bookName(slug)} ${ch}:${k.replace("/", ",")} — ${n.title}${n.description ? `: ${n.description}` : ""}`));
    const body = lines.join("\n");
    const file = new File([body], `${ref.replace(/[^A-Za-z0-9]+/g, "-")}.txt`, { type: "text/plain" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: ref }); return; } } catch { /* fall through */ }
    try { await navigator.clipboard.writeText(body); say("Copied to the clipboard."); } catch { void alert("Export is not available here."); }
  };

  const openResources = (v: number, tab: ResourceTab) => { setResourceVerse(v); setResourceTab(tab); setSheet("resources"); };
  const onMenu = (a: MenuAction) => {
    if (a === "params") setSheet("params");
    if (a === "history") navigate("/history");
    if (a === "bookmark") { setBookmarkTarget({ existing: bookmarks.find((b) => b.book === slug && b.chapter === ch && !b.verse) }); setSheet("bookmark"); }
    if (a === "export") void exportSel("chapter");
    if (a === "search") setSheet("search");
    if (a === "newtab") navigate(selectTab(newTab(`/read/${slug}/${ch}`)), { replace: true });
  };
  const chapterBookmark = bookmarks.find((b) => b.book === slug && b.chapter === ch && !b.verse);
  const formatBookmark = (b: Bookmark) => `${bookName(b.book)} ${b.chapter}${b.verse ? `:${b.verse}` : ""}`;

  const headerHeight = (fullscreen ? HEADER_HEIGHT_MIN : HEADER_HEIGHT) + (focus && contextMode ? PASSAGE_CONTEXT_HEADER_HEIGHT : 0);
  const focusedReference = focus ? reference(focus) : null;
  const bottomBar = 48 + (Number(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom").replace("px", "")) || 0);
  const items = colorItems(settings, palette);
  const resource = verses.find((v) => v.verse === resourceVerse);

  return (
    <div className="bs" data-dark={isDarkTheme(theme) ? "" : undefined} style={{ ...cssVars(palette), background: palette.reverse, color: palette.default }}>
      <Header bookLabel={chapterLabel} version="KJV" onBook={() => setSheet("books")} onVersion={() => setSheet("version")} onVerses={() => setSheet("verses")}
        selectedReference={selectedReference} focusedReference={focusedReference} onClearFocus={clearFocus} collapsed={fullscreen}
        onMenu={onMenu} hasChapterBookmark={!!chapterBookmark} chapterBookmarkColor={chapterBookmark?.color} onChapterBookmark={() => { setBookmarkTarget({ existing: chapterBookmark }); setSheet("bookmark"); }} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      {focus ? <PassageContextBar focused={contextMode === "focused"} collapsed={fullscreen} onExpand={() => setContextMode("fullChapter")} onCollapse={() => { setContextMode("focused"); setNavRequest((n) => n + 1); }} onExit={clearFocus} /> : null}
      {text.isError ? (
        <div className="bs-error" style={{ paddingTop: headerHeight + 100 }}><span className="bs-error__icon"><Feather2 /></span><p>This chapter did not load. Check your connection, or save this book for offline reading in Settings.</p><button type="button" className="bs-btn" onClick={() => void text.refetch()}>Retry</button></div>
      ) : (
        <Chapter slug={slug} chapter={ch} verses={verses} settings={settings} palette={palette} theme={theme}
          readingVerse={speech.current} onSeekVerse={speech.playing ? speech.play : undefined} selected={selected} focusVerses={focus} contextDisplayMode={contextMode} verseToScroll={verseToScroll} navigationRequest={navRequest}
          highlights={highlights} tags={tags} bookmarks={bookmarks} relationItems={relItems}
          moments={classMoments.data} deck={{ reference: chapterLabel, from: `/read/${slug}/${ch}` }}
          headerHeight={headerHeight} fullscreen={fullscreen} canSwipe
          footer={<><ChapterPeople slug={slug} chapter={ch} palette={palette} resources={chapterDeck.length ? <MediaDeck items={chapterDeck} placement="chapter" palette={palette} fontScale={settings.fontSizeScale} reference={chapterLabel} from={`/read/${slug}/${ch}`}
            sections={[{ title: `Taught from ${chapterLabel}`, items: chapterDeck }]} /> : null} /><ChapterEnd read={isRead(progress, slug, ch)} today={plan && list.length ? planDay(plan, list, progress) : null} slug={slug} chapter={ch}
            onToggle={(on) => { haptic(on ? "success" : "select"); setProgress(on ? markRead(progress, slug, ch) : unmarkRead(progress, slug, ch)); }} /></>}
          onToggleVerse={toggleVerse} onVerseDetail={(v) => openResources(v, "dictionary")}
          onSwipe={(dir) => go(dir === "left" ? next : prev)} onFullscreen={setFullscreen}
          onOpenBookmark={(b) => { setBookmarkTarget({ verse: b.verse, existing: b }); setSheet("bookmark"); }}
          onOpenRelations={(v) => navigate(`/relations?endpoint=${verseKey(slug, ch, v)}`)} onOpenRelationItem={(it) => void openRelationItem(it)}
          onOpenTags={(v) => { const group = Object.entries(highlights).filter(([, h]) => h.date === highlights[String(v)]?.date).map(([k]) => +k); setTagsTarget(group.length ? group : [v]); setSheet("tags"); }} onOpenTag={(id) => navigate(`/bookmarks?tag=${id}`)} />
      )}
      <Footer hasPrev={!!prev} hasNext={!!next} onPrev={() => go(prev)} onNext={() => go(next)} speech={speech} fullscreen={fullscreen} hidden={contextMode === "focused" && !!focus} bottomBar={bottomBar} reference={chapterLabel} verseCount={verses.length} repeat={repeat} setRepeat={setRepeat} expanded={audioOpen} setExpanded={setAudioOpen} />

      <WhySheet open={sheet === "why"} onClose={() => setSheet(null)} slug={slug} chapter={ch} verse={whyAt} reference={`${chapterLabel}:${whyAt}`}
        onRead={(url, v) => { setSheet(null); const m = slugOfUrl(url); navigate(m ? `/read/${m[1]}/${m[2]}${v ? `?v=${v}` : ""}` : url); }}
        onOpenClass={(url, ts) => { setSheet(null); const t = ts ? ts.split(":").reduce((n, p) => n * 60 + Number(p || 0), 0) : 0; if (/^https?:/.test(url)) openLink(`${url}${t ? `&t=${t}s` : ""}`); else navigate(`/note${url}${t ? `?t=${t}` : ""}`); }} />
      <SelectedVersesSheet open={selected.length > 0 && !sheet} onDismiss={() => setSelected([])}
        colors={items} selectedColor={selectedColor} onAddHighlight={addHighlight} onRemoveHighlight={removeHighlight} onAddColor={() => setSheet("params")} onEditColor={() => setSheet("params")}
        moreThanOne={selected.length > 1} hasBookmark={hasBookmark} hasFocus={hasFocus}
        onNote={() => { setNoteEdit(null); setSheet("note"); }} onTag={() => { setTagsTarget(selectedSorted); setSheet("tags"); }} onLink={() => setSheet("link")} onRelation={() => setSheet("relation")}
        onBookmark={() => { setBookmarkTarget({ verse: first, existing: bookmarks.find((b) => b.book === slug && b.chapter === ch && b.verse === first) }); setSheet("bookmark"); }} onFocus={setFocus}
        onLexicon={() => openResources(first, "words")} onDictionary={() => openResources(first, "dictionary")} onThemes={() => openResources(first, "themes")} onReferences={() => openResources(first, "references")} onCommentary={() => openResources(first, "commentary")} onCompare={() => { setResourceVerse(first); setSheet("compare"); }}
        onCopy={() => void copy()} onShare={shareSel} onExport={() => void exportSel("selection")} onSelectAll={() => setSelected(verses.map((v) => v.verse))} />

      <BookSelectorSheet open={sheet === "books"} onClose={() => setSheet(null)} books={list} current={{ slug, chapter: ch }} onSelect={(s, c, v) => go({ slug: s, ch: c }, v)} loadVerseCount={(s, c) => data.chapter(s, c).then((r) => r.verses.length)} progress={progress} />
      <SearchSheet open={sheet === "search"} onClose={() => setSheet(null)} books={list} onGo={(s, c, v) => go({ slug: s, ch: c }, v)} />
      <VersionSheet open={sheet === "version"} onClose={() => setSheet(null)} />
      <VersePopup open={sheet === "verses"} onClose={() => setSheet(null)} count={verses.length} selected={verseToScroll} onSelect={(v) => { setVerseToScroll(v); setNavRequest((n) => n + 1); }} />
      <ParamsSheet open={sheet === "params"} onClose={() => setSheet(null)} settings={settings} set={setSettings} palette={palette} />
      <BookmarkSheet open={sheet === "bookmark"} onClose={() => setSheet(null)} reference={bookmarkTarget.verse ? reference([bookmarkTarget.verse]) : chapterLabel} location={{ book: slug, chapter: ch, verse: bookmarkTarget.verse }} existing={bookmarkTarget.existing} bookmarks={bookmarks} setBookmarks={setBookmarks} formatReference={formatBookmark} />
      <TagsPanel open={sheet === "tags"} onClose={() => setSheet(null)} reference={reference(tagsTarget)} tags={tags} setTags={setTags} selected={tagsSelected} onToggle={toggleTag} />
      <NoteSheet open={sheet === "note"} onClose={() => { setSheet(null); setNoteEdit(null); }} reference={noteEdit ? `${bookName(slug)} ${ch}:${noteEdit.key.replace("/", ",")}` : selectedReference ?? ""} initial={noteEdit?.note} onSave={(v) => void saveNote(v)} onRemove={noteEdit ? () => void removeNote() : undefined} />
      <LinkSheet open={sheet === "link"} onClose={() => setSheet(null)} reference={selectedReference ?? ""} onSave={(v) => void saveLink(v)} />
      {sheet === "relation" ? <RelationTargetPicker source={verseEndpoint() as Endpoint} onClose={() => setSheet(null)} onCreated={() => { setSheet(null); setSelected([]); }} /> : null}
      {resource ? <CompareSheet open={sheet === "compare"} onClose={() => setSheet(null)} slug={slug} chapter={ch} verse={resource.verse} text={resource.text} reference={reference([resource.verse])} books={list} onRead={(s, c, v) => go({ slug: s, ch: c }, v)} /> : null}
      {resource ? <ResourcesSheet open={sheet === "resources"} onClose={() => setSheet(null)} tab={resourceTab} setTab={setResourceTab} slug={slug} chapter={ch} verse={resource.verse} text={resource.text} reference={reference([resource.verse])} books={list} /> : null}
      {toast ? <div className="bs-toast" role="status">{toast}</div> : null}
    </div>
  );
}

function Feather2() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--bs-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>; }
