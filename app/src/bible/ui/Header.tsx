import { useEffect, useRef, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { sheetOpened } from "@/tg/hooks";
import { Feather, Ion, type FeatherName } from "../icons";
import { Sheet } from "./Sheet";
import { HEADER_HEIGHT, HEADER_HEIGHT_MIN, PASSAGE_CONTEXT_HEADER_HEIGHT } from "../dom/Chapter";

/**
 * BibleHeader: 54 px on the page background with a bottom border. Normally the book and
 * chapter pill joined to the version pill, the verse chevrons, and the ⋮ menu; with verses
 * selected only their reference, centred; with a focus the reference and the version. A
 * fast scroll down collapses it to 20 px (its controls fade, its texts lift 4 px).
 */
export type MenuAction = "params" | "history" | "bookmark" | "export" | "search" | "newtab";
export function Header({ bookLabel, version, onBook, onVersion, onVerses, selectedReference, focusedReference, onClearFocus, collapsed, onMenu, chapterBookmarkColor, onChapterBookmark, hasChapterBookmark, menuOpen, setMenuOpen }: {
  bookLabel: string; version: string; onBook: () => void; onVersion: () => void; onVerses: () => void;
  selectedReference: string | null; focusedReference: string | null; onClearFocus: () => void; collapsed: boolean;
  onMenu: (a: MenuAction) => void; chapterBookmarkColor?: string; onChapterBookmark: () => void; hasChapterBookmark: boolean; menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const fade = { opacity: collapsed ? 0 : 1, transition: "opacity .3s" } as const;
  const lift = { transform: `translateY(${collapsed ? -4 : 0}px)`, transition: "transform .3s" } as const;
  const isCollapsed = collapsed && !selectedReference;
  const short = bookLabel.length > 14 && window.innerWidth < 400 ? `${bookLabel.slice(0, 10)}…` : bookLabel;
  return (
    <header className="bs-header" style={{ height: isCollapsed ? HEADER_HEIGHT_MIN : HEADER_HEIGHT, minHeight: isCollapsed ? HEADER_HEIGHT_MIN : HEADER_HEIGHT }} data-selected={selectedReference ? "" : undefined}>
      <div className="bs-header__row">
        {selectedReference ? (
          <div className="bs-header__center"><b>{selectedReference}</b></div>
        ) : focusedReference ? (
          <>
            <div className="bs-header__focus"><b style={lift}>{focusedReference} - {version}</b></div>
            <MenuButton style={fade} onClick={() => setMenuOpen(true)} />
          </>
        ) : (
          <>
            <div className="bs-pills">
              <button type="button" className="bs-pill bs-pill--book" aria-label={`Choose book and chapter. Current selection: ${bookLabel}`} onClick={() => { haptic("select"); onBook(); }}><span className="bs-pill__bg" style={fade} /><b style={lift}>{short}</b></button>
              <button type="button" className="bs-pill bs-pill--version" aria-label={`Choose version. Current selection: ${version}`} onClick={() => { haptic("select"); onVersion(); }}><span className="bs-pill__bg" style={fade} /><b style={lift}>{version}</b></button>
            </div>
            <button type="button" className="bs-header__verses" aria-label="Choose a verse" style={fade} onClick={() => { haptic("select"); onVerses(); }}><Feather name="chevrons-down" size={20} style={{ opacity: 0.3 }} /></button>
            <div className="bs-header__right">
              <MenuButton style={fade} onClick={() => setMenuOpen(true)} />
              {focusedReference ? <button type="button" className="bs-iconbtn" aria-label="Exit focus mode" onClick={onClearFocus}><Feather name="x" size={20} /></button> : null}
            </div>
          </>
        )}
      </div>
      {hasChapterBookmark && !selectedReference ? <button type="button" className="bs-header__ribbon" aria-label="Edit bookmark" onClick={onChapterBookmark}><Ion name="bookmark" size={24} color={chapterBookmarkColor} /></button> : null}
      {menuOpen ? <OptionsMenu hasChapterBookmark={hasChapterBookmark} onClose={() => setMenuOpen(false)} onPick={(a) => { setMenuOpen(false); onMenu(a); }} /> : null}
    </header>
  );
}
function MenuButton({ onClick, style }: { onClick: () => void; style?: React.CSSProperties }) {
  return <button type="button" className="bs-iconbtn" aria-label="Scripture options" style={style} onClick={() => { haptic("select"); onClick(); }}><Feather name="more-vertical" size={18} /></button>;
}
/**
 * Bible Strong's options menu (BibleOptionsMenu): a dropdown under the ⋮ button, not a sheet.
 * Its items, in its order, and the Scripture search, which Bible Strong keeps in its search tab.
 */
function OptionsMenu({ hasChapterBookmark, onClose, onPick }: { hasChapterBookmark: boolean; onClose: () => void; onPick: (a: MenuAction) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => sheetOpened(), []);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    el.addEventListener("cj:close", onClose); window.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("cj:close", onClose); window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const items: [MenuAction, string, FeatherName][] = [
    ["params", "Font and settings", "type"],
    ["search", "Search the Scriptures", "search"],
    ["history", "History", "clock"],
    ["bookmark", hasChapterBookmark ? "Edit bookmark" : "Add bookmark", "bookmark"],
    ["export", "Export", "share-2"],
    ["newtab", "Open in new tab", "external-link"],
  ];
  return (
    <>
      <div className="bs-dropdown__catch" onClick={onClose} />
      <div ref={ref} className="bs-dropdown" role="menu" aria-label="Scripture options" data-sheet-open="">
        {items.map(([a, label, icon]) => (
          <button key={a} type="button" role="menuitem" className="bs-dropdown__item" onClick={() => { haptic("select"); onPick(a); }}>
            <span>{label}</span><Feather name={icon} size={18} />
          </button>
        ))}
      </div>
    </>
  );
}

/** PassageContextButton: the 44 px bar under the header while a passage is focused. */
export function PassageContextBar({ focused, collapsed, onExpand, onCollapse, onExit }: { focused: boolean; collapsed: boolean; onExpand: () => void; onCollapse: () => void; onExit: () => void }) {
  return (
    <div className="bs-context" aria-hidden={collapsed} style={{ top: HEADER_HEIGHT, height: PASSAGE_CONTEXT_HEADER_HEIGHT, opacity: collapsed ? 0 : 1, pointerEvents: collapsed ? "none" : "auto", transform: `translateY(${collapsed ? -(HEADER_HEIGHT - HEADER_HEIGHT_MIN + PASSAGE_CONTEXT_HEADER_HEIGHT) : 0}px)` }}>
      <button type="button" className="bs-context__main" aria-expanded={!focused} onClick={focused ? onExpand : onCollapse}>{focused ? "Read whole chapter" : "Back to the Scripture"}</button>
      <button type="button" className="bs-context__exit" aria-label="Exit focus mode" onClick={onExit}><span><Feather name="x" size={15} color="var(--bs-primary)" /></span></button>
    </div>
  );
}

export function VersionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Version">
      <div className="bs-versions">
        <button type="button" className="bs-versionrow" aria-current="true" onClick={onClose}><span className="bs-versionrow__id">KJV</span><span className="bs-versionrow__name">King James Version, with the Apocrypha</span><small>Public domain · the library's one text</small><Feather name="check" size={18} color="var(--bs-primary)" /></button>
      </div>
    </Sheet>
  );
}

export type { ReactNode };
