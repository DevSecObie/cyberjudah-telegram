import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { data } from "@/api/data";
import { parseReference } from "../../../bot/src/refs.mjs";
import { closeTab, currentTab, isTabPath, newTab, selectTab, switchGroup, tabTitle, useTabs } from "@/lib/tabs";
import { sheetOpened } from "@/tg/hooks";
import { useModal } from "./modal";
import { moveTab } from "./tab-motion";
import "./workspace-commands.css";

const destinations = [
  ["Bible", "/bible"], ["Search", "/search"], ["My studies", "/studies", "study writing"], ["Reading plans", "/plans"],
  ["Classes", "/classes"], ["Highlights, notes and bookmarks", "/bookmarks"], ["Strong’s lexicon", "/lexicon"],
  ["Dictionary", "/dictionary"], ["People", "/people"], ["Precepts", "/precepts"], ["Your precepts", "/relations"],
  ["Tags", "/tags"], ["Bible timeline", "/timeline"], ["Library", "/books"], ["The Law", "/law"],
  ["Topics", "/topics"], ["Concordance", "/concordance"], ["Ask CyberJudah", "/ask"], ["Downloads and resources", "/resources"],
  ["Audio settings", "/settings/audio"], ["Settings", "/settings"],
];
type Choice = { id: string; title: string; detail: string; path: string; keywords?: string; group?: string; tab?: string };
const editing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input,textarea,select,[role="textbox"]'));

/** Workspace navigation without stealing browser tabs' Cmd/Ctrl+T and Cmd/Ctrl+W. */
export function WorkspaceCommands() {
  const tabs = useTabs(), navigate = useNavigate(), location = useLocation();
  const [mode, setMode] = useState<"search" | "recent" | null>(null);
  const [query, setQuery] = useState(""), [index, setIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const close = () => setMode(null);
  useModal(box, !!mode, close);
  useEffect(() => { if (mode) return sheetOpened(); }, [mode]);
  useEffect(() => { setRecent(rows => [tabs.current, ...rows.filter(id => id !== tabs.current)].slice(0, 80)); }, [tabs.current]);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity, enabled: !!mode });
  const passage = parseReference(query, books.data ?? []);
  const openTabs: Choice[] = tabs.groups.flatMap(group => group.tabs.filter(t => t.path !== "/new").map(tab => ({ id: tab.id, tab: tab.id, group: group.id, title: tabTitle(tab.path), detail: group.name, path: tab.path })));
  const rank = (id: string) => id === tabs.current ? -1 : recent.includes(id) ? recent.indexOf(id) : 100;
  const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f’']/g, "");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const tools: Choice[] = destinations.map(([title, path, keywords]) => ({ id: path, title, path, keywords, detail: "Open in a new tab" }));
  const choices = mode === "recent" ? openTabs.sort((a, b) => rank(a.id) - rank(b.id)) : [
    ...(passage ? [{ id: "passage", title: passage.label, detail: "Open passage", path: `/read/${passage.slug}/${passage.chapter}${passage.verse ? `?v=${passage.verse}${passage.verseEnd ? `-${passage.verseEnd}` : ""}` : ""}` }] : []),
    ...[...openTabs, ...tools].filter(c => terms.every(term => normalize(`${c.title} ${c.detail} ${c.keywords ?? ""}`).includes(term))),
  ];
  const selected = Math.min(index, Math.max(0, choices.length - 1));
  const choose = (choice?: Choice) => {
    if (!choice) return;
    close();
    moveTab(() => {
      if (choice.group && choice.tab) { switchGroup(choice.group); navigate(selectTab(choice.tab), { replace: true }); }
      else navigate(newTab(choice.path));
    }, "slide");
  };
  const open = () => { setQuery(""); setIndex(0); setMode("search"); };
  useEffect(() => { window.addEventListener("cj:commands", open); return () => window.removeEventListener("cj:commands", open); }, []);
  useEffect(() => { if (mode === "search") input.current?.focus(); else if (mode) box.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus(); }, [mode]);
  useEffect(() => { box.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selected]);
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const down = (e: KeyboardEvent) => {
      if (e.isComposing || e.getModifierState("AltGraph")) return;
      const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const key = e.key.toLowerCase();
      const cycle = key === "q" && !e.metaKey && (mac ? e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey);
      if (mode) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || cycle && mode === "recent") {
          e.preventDefault();
          const step = e.key === "ArrowUp" || cycle && e.shiftKey ? -1 : 1;
          setIndex(n => choices.length ? (n + step + choices.length) % choices.length : 0);
        } else if (e.key === "Enter") { e.preventDefault(); choose(choices[selected]); }
        return;
      }
      if (e.defaultPrevented || e.repeat || editing(e.target) || [...document.querySelectorAll('[data-sheet-open], [role="dialog"], [role="menu"]')].some(el => el.getAttribute("aria-modal") !== "false" && !el.closest('[inert], [aria-hidden="true"]'))) return;
      const letter = /^[a-z]$/.test(key) ? key : e.keyCode >= 65 && e.keyCode <= 90 ? String.fromCharCode(e.keyCode).toLowerCase() : "";
      if (mod && key === "k" && !e.altKey && !e.shiftKey) { e.preventDefault(); open(); }
      else if (cycle) { e.preventDefault(); setIndex(openTabs.length > 1 ? e.shiftKey ? openTabs.length - 1 : 1 : 0); setMode("recent"); }
      else if (mod && e.altKey && !e.shiftKey && letter === "n") { e.preventDefault(); moveTab(() => { navigate(newTab()); }, "slide"); }
      else if (mod && e.altKey && !e.shiftKey && letter === "w" && isTabPath(location.pathname)) {
        e.preventDefault(); moveTab(() => { closeTab(tabs.current); navigate(currentTab().path, { replace: true }); }, "slide");
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault(); const at = openTabs.findIndex(t => t.tab === tabs.current), step = e.key === "ArrowUp" ? -1 : 1;
        choose(openTabs[(at + step + openTabs.length) % openTabs.length]);
      }
    };
    const up = (e: KeyboardEvent) => { if (mode === "recent" && e.key === (mac ? "Control" : "Alt")) { e.preventDefault(); choose(choices[selected]); } };
    const cancel = () => { if (mode === "recent") close(); };
    document.addEventListener("keydown", down); document.addEventListener("keyup", up); window.addEventListener("blur", cancel);
    return () => { document.removeEventListener("keydown", down); document.removeEventListener("keyup", up); window.removeEventListener("blur", cancel); };
  });
  if (!mode) return null;
  return <div className="sheet__scrim workspace-commands" onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={box} className="sheet workspace-commands__sheet" role="dialog" aria-modal="true" aria-label={mode === "search" ? "Find a tab or tool" : "Recent tabs"} data-sheet-open="">
      <div className="workspace-commands__header"><h2>{mode === "search" ? "Find a tab or tool" : "Recent tabs"}</h2><button type="button" onClick={close} aria-label="Close">×</button></div>
      {mode === "search" && <input ref={input} role="combobox" type="search" placeholder="A passage, a tab, a tool…" aria-label="Find a tab or tool" aria-expanded="true" aria-controls="workspace-options" aria-activedescendant={choices.length ? `workspace-option-${selected}` : undefined} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); }} />}
      <div id="workspace-options" className="workspace-commands__list" role="listbox" tabIndex={mode === "recent" ? 0 : -1} aria-label="Tabs and tools" aria-activedescendant={choices.length ? `workspace-option-${selected}` : undefined}>
        {choices.map((c, i) => <div key={c.id} id={`workspace-option-${i}`} role="option" aria-selected={i === selected} onClick={() => choose(c)}><b>{c.title}</b><small>{c.detail}</small></div>)}
        {!choices.length && <p role="status">No matching tab or tool.</p>}
      </div>
      <p className="hint">↑ ↓ to choose · Enter to open · Esc to close</p>
    </div>
  </div>;
}
