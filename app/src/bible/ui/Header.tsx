import { useEffect, useRef, useState, type ReactNode } from "react";

import { haptic } from "@/tg/sdk";
import { sheetOpened } from "@/tg/hooks";
import { Feather, Ion, type FeatherName } from "../icons";
import { useModal } from "@/ui/modal";
import { usePopover } from "@/ui/popover";
import { HeaderPicker } from "./HeaderPicker";
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
        {isCollapsed ? <b className="bs-header__summary">{bookLabel} · {version}</b> : selectedReference ? (
          <div className="bs-header__center"><b>{selectedReference}</b></div>
        ) : focusedReference ? (
          <>
            <div className="bs-header__focus"><b style={lift}>{focusedReference} - {version}</b></div>
            <MenuButton style={fade} onClick={() => setMenuOpen(true)} />
          </>
        ) : (
          <>
            <div className="bs-pills toolbar-group" role="group" aria-label="Passage">
              <button type="button" className="bs-pill bs-pill--book" aria-label={`Choose book and chapter. Current selection: ${bookLabel}`} title={`Choose book and chapter. Current selection: ${bookLabel}`} onClick={() => { haptic("select"); onBook(); }}><span className="bs-pill__bg" style={fade} /><b style={lift}>{short}</b></button>
              <button type="button" className="bs-pill bs-pill--version" aria-label={`Choose version. Current selection: ${version}`} title={`Choose version. Current selection: ${version}`} onClick={() => { haptic("select"); onVersion(); }}><span className="bs-pill__bg" style={fade} /><b style={lift}>{version}</b></button>
            </div>
            <div className="bs-header__right toolbar-group" role="group" aria-label="Scripture actions">
            <button type="button" className="bs-header__verses" aria-label="Choose a verse" title="Choose a verse" style={fade} onClick={() => { haptic("select"); onVerses(); }}><Feather name="chevrons-down" size={20} style={{ opacity: 0.3 }} /></button>
              <MenuButton style={fade} onClick={() => setMenuOpen(true)} />
              {focusedReference ? <button type="button" className="bs-iconbtn" aria-label="Exit focus mode" title="Exit focus mode" onClick={onClearFocus}><Feather name="x" size={20} /></button> : null}
            </div>
          </>
        )}
      </div>
      {hasChapterBookmark && !selectedReference ? <button type="button" className="bs-header__ribbon" aria-label="Edit bookmark" title="Edit bookmark" onClick={onChapterBookmark}><Ion name="bookmark" size={24} color={chapterBookmarkColor} /></button> : null}
      <OptionsMenu open={menuOpen} hasChapterBookmark={hasChapterBookmark} onClose={() => setMenuOpen(false)} onPick={(a) => { setMenuOpen(false); onMenu(a); }} />
    </header>
  );
}
function MenuButton({ onClick, style }: { onClick: () => void; style?: React.CSSProperties }) {
  return <button type="button" className="bs-iconbtn" aria-label="Scripture options" title="Scripture options" style={style} onClick={() => { haptic("select"); onClick(); }}><Feather name="more-vertical" size={18} /></button>;
}
/**
 * Bible Strong's options menu (BibleOptionsMenu): a dropdown under the ⋮ button, not a sheet.
 * Its items, in its order, and the Scripture search, which Bible Strong keeps in its search tab.
 */
function OptionsMenu({ open, hasChapterBookmark, onClose, onPick }: { open: boolean; hasChapterBookmark: boolean; onClose: () => void; onPick: (a: MenuAction) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = usePopover(open, ref);
  useModal(ref, open && present, onClose, { lock: false, trap: false });
  useEffect(() => { if (open) return sheetOpened(); }, [open]);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.addEventListener("cj:close", onClose);
    return () => el.removeEventListener("cj:close", onClose);
  }, [onClose, present]);
  const items: [MenuAction, string, FeatherName][] = [
    ["params", "Font and settings", "type"],
    ["search", "Search the Scriptures", "search"],
    ["history", "Recently viewed", "clock"],
    ["bookmark", hasChapterBookmark ? "Edit bookmark" : "Add bookmark", "bookmark"],
    ["export", "Export…", "share-2"],
    ["newtab", "Open in new tab", "external-link"],
  ];
  if (!present) return null;
  return (
    <>
      <div className="bs-dropdown__catch" onClick={onClose} />
      <div ref={ref} className="bs-dropdown" data-popover="" inert={!open} aria-hidden={!open} role="menu" aria-label="Passage options" data-sheet-open=""
        onKeyDown={e => {
          const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
          if (next >= 0) { e.preventDefault(); items[next].focus(); }
          else if (e.key === "Tab") onClose();
        }}>
        <b className="bs-dropdown__title">Passage options</b>
        {items.map(([a, label, icon]) => (
          <button key={a} type="button" role="menuitem" data-autofocus={a === "params" ? "" : undefined} className="bs-dropdown__item" onClick={() => { haptic("select"); onPick(a); }}>
            <Feather name={icon} size={18} /><span>{label}</span>{["params", "bookmark", "export"].includes(a) ? <Feather name="chevron-right" size={16} /> : null}
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
      <button type="button" className="bs-context__exit" aria-label="Exit focus mode" title="Exit focus mode" onClick={onExit}><span><Feather name="x" size={15} color="var(--bs-primary)" /></span></button>
    </div>
  );
}

export function VersionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(false);
  useEffect(() => { if (!open) { setQuery(""); setFilters(false); } }, [open]);
  const matches = "KJV King James Version English Apocrypha".toLowerCase().includes(query.trim().toLowerCase());
  return (
    <HeaderPicker open={open} onClose={onClose} title="Version" right={<button type="button" className="bs-filterbtn" aria-label="Version filters" title="Version filters" aria-expanded={filters} onClick={() => setFilters(!filters)}><Feather name="sliders" size={18} color="var(--bs-primary)" /></button>}>
      <label className="bs-search"><Feather name="search" size={18} /><input aria-label="Search versions" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      {filters ? <p className="bs-tip">English · Public domain · Includes the Apocrypha</p> : null}
      <div className="bs-versions">
        {matches ? <><h3 className="bs-versions__language">English</h3><button type="button" className="bs-versionrow" aria-current="true" onClick={onClose}><span className="bs-versionrow__id">KJV</span><span className="bs-versionrow__name">King James Version, with the Apocrypha</span><small>Public domain · the library's one text</small><Feather name="check" size={18} color="var(--bs-primary)" /></button></> : <p className="bs-tip">No versions found.</p>}
      </div>
    </HeaderPicker>
  );
}

export type { ReactNode };
