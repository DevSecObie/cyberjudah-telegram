import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Feather, type FeatherName } from "@/bible/icons";
import { Button, Sheet } from "@/bible/ui/Sheet";
import { haptic } from "@/tg/sdk";

import { Icon } from "./icons";
import "./panel.css";

/**
 * Bible Strong's ContextualPanel (common/ContextualPanel), as it is on the iPhone: a trigger that
 * opens a sheet of screens. `navigation.open(name)` pushes a screen, `back()` returns one level,
 * `close()` dismisses and resets; each screen comes in with a 200 ms fade and a 10 px slide.
 */
export type PanelNavigation = { open: (screen: string) => void; back: () => void; close: () => void };
export type PanelScreen = { title: string; headerRight?: ReactNode; headerContent?: ReactNode; content: (navigation: PanelNavigation) => ReactNode };

export function ContextualPanel({ trigger, triggerSize, label, screens, initialScreen, onClose, className }: {
  trigger: ReactNode; triggerSize?: number; label: string; screens: Record<string, PanelScreen>; initialScreen: string; onClose?: () => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState([initialScreen]);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const opened = useRef(false);
  const screen = screens[history[history.length - 1]] ?? screens[initialScreen];
  const close = () => {
    if (!opened.current) return;
    opened.current = false;
    setOpen(false); setHistory([initialScreen]); onClose?.();
  };
  const navigation: PanelNavigation = {
    open: (name) => { if (screens[name]) { setDirection("forward"); setHistory((h) => [...h, name]); } },
    back: () => { if (history.length > 1) { setDirection("backward"); setHistory((h) => h.slice(0, -1)); } },
    close,
  };
  const present = (e: React.MouseEvent) => {
    // A trigger inside a link row opens the panel, not the row.
    e.preventDefault(); e.stopPropagation();
    if (opened.current) return;
    opened.current = true; haptic("select");
    setHistory([initialScreen]); setDirection("forward"); setOpen(true);
  };
  const key = history.join("/");
  return (
    <>
      <button type="button" className={`panel-trigger${className ? ` ${className}` : ""}`} aria-label={label} title={label} onClick={present}
        style={triggerSize ? { width: triggerSize, height: triggerSize } : undefined}>{trigger}</button>
      {/* Outside the trigger's header or row, which may move or clip, but inside the app's styles. */}
      {createPortal(<Sheet open={open} onClose={close} label={screen.title} title={<span key={key} className="panel-step" data-direction={direction}>{screen.title}</span>}
        hasBack={history.length > 1} onBack={navigation.back} right={screen.headerRight} headerChildren={screen.headerContent}>
        <div key={key} className="panel-step" data-direction={direction}>{screen.content(navigation)}</div>
      </Sheet>, document.getElementById("root") ?? document.body)}
    </>
  );
}

/** Bible Strong's PanelAction on the iPhone (ActionSheetItem): a 20 px row, a 15 px icon, a line under it. */
export function PanelAction({ label, icon, destructive, nested, onPress }: { label: string; icon: FeatherName; destructive?: boolean; nested?: boolean; onPress: () => void }) {
  return (
    <button type="button" className="panel-action" data-destructive={destructive ? "" : undefined} onClick={onPress}>
      <span className="panel-action__content"><span className="panel-action__icon"><Feather name={icon} size={15} /></span><span>{label}</span></span>
      {nested ? <span className="panel-action__chevron"><Feather name="chevron-right" size={20} /></span> : null}
    </button>
  );
}

/** Bible Strong's PanelTextForm: the field, then Save on the right. */
export function PanelTextForm({ initialValue, label, onSave }: { initialValue: string; label: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initialValue);
  const save = () => { if (value.trim()) onSave(value.trim()); };
  return (
    <form className="panel-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input aria-label={label} placeholder={label} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className="panel-form__actions"><Button onClick={save} disabled={!value.trim()}>Save</Button></div>
    </form>
  );
}

/** Bible Strong's PanelSearch: a plain field, 8 px in from the sheet's edges. */
export function PanelSearch({ value, onChange, placeholder = "Search" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="panel-search"><input type="search" aria-label="Search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoFocus /></div>;
}

export type FilterOption = { key: string; label: string; selected: boolean; onSelect: () => void };
/** Bible Strong's FilterChoices: one row per choice, a check on the one chosen. */
export function FilterChoices({ options }: { options: FilterOption[] }) {
  return (
    <div role="radiogroup">
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={o.selected} className="panel-choice" onClick={() => { haptic("select"); o.onSelect(); }}>
          <span>{o.label}</span>{o.selected ? <span className="panel-choice__check"><Feather name="check" size={20} /></span> : null}
        </button>
      ))}
    </div>
  );
}

/** A filter of Bible Strong's FiltersHeader: either its own screen (`content`) or a list of choices (`options`). */
export type FiltersHeaderItem = { key: string; icon: FeatherName; label: string; value?: string; active?: boolean; content?: (navigation: PanelNavigation) => ReactNode; options?: FilterOption[] };

/**
 * Bible Strong's FiltersHeader button: the filter icon, or once filters are set the count (or the
 * one filter's icon) on an accent pill with a chevron. It opens the Filters screen, a row per filter
 * with its value, and each filter's own screen; Reset sits on the right while one is set.
 */
export function FiltersButton({ filters, onReset }: { filters: FiltersHeaderItem[]; onReset?: () => void }) {
  const active = filters.filter((f) => f.active);
  const reset = active.length && onReset ? <button type="button" className="panel-reset" onClick={() => { haptic("select"); onReset(); }}>Reset</button> : undefined;
  const screens: Record<string, PanelScreen> = {
    filters: {
      title: "Filters", headerRight: reset,
      content: (nav) => filters.map((f) => (
        <button key={f.key} type="button" className="panel-filter" data-active={f.active ? "" : undefined} onClick={() => nav.open(f.key)}>
          <span className="panel-filter__icon"><Feather name={f.icon} size={20} /></span>
          <span className="panel-filter__label">{f.label}</span>
          <span className="panel-filter__value">{f.value}</span>
          <span className="panel-filter__chevron"><Feather name="chevron-right" size={20} /></span>
        </button>
      )),
    },
  };
  for (const f of filters) {
    if (f.content) screens[f.key] = { title: f.label, headerRight: reset, content: f.content };
    else if (f.options) screens[f.key] = { title: f.label, headerRight: reset, content: () => <FilterChoices options={f.options!} /> };
  }
  const count = active.length;
  return (
    <ContextualPanel label={count ? `${count} ${count === 1 ? "filter" : "filters"}` : "Filter"} initialScreen="filters" screens={screens}
      className={`bs-filter${count ? " bs-filter--on" : ""}`}
      trigger={count ? <span className="bs-filter__pill"><span>{count === 1 ? <Feather name={active[0].icon} size={14} /> : <b>{count}</b>}</span><span><Icon name="chevron-down" size={13} /></span></span> : <Icon name="filter" size={20} />} />
  );
}
