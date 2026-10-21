import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Feather, type FeatherName } from "@/bible/icons";
import { Button, Sheet } from "@/bible/ui/Sheet";
import { assetUrl } from "@/lib/asset";
import { closeAll, deleteGroup, GROUP_COLORS, isDefaultGroup, newGroup, renameGroup, useTabs, type Group } from "@/lib/tabs";
import { features, popup } from "@/tg/sdk";
import { groupPager } from "@/ui/group-pager";
import { useToast } from "@/ui/toast";
import { TabIcon } from "./Tabs";

/** The default group is shown by its count ("3 tabs"), any other by its name. */
export const groupLabel = (g: Group) => (isDefaultGroup(g) ? `${g.tabs.length} ${g.tabs.length === 1 ? "tab" : "tabs"}` : g.name);

/** Bible Strong's ActionSheetItem: 20 px all round, a 15 px icon in a 20 px column, the label 10 px after it, a line under. */
function Action({ icon, label, quart, onPress }: { icon: FeatherName; label: string; quart?: boolean; onPress: () => void }) {
  return (
    <button type="button" className="gaction" data-quart={quart ? "" : undefined} onClick={onPress}>
      <span className="gaction__icon"><Feather name={icon} size={15} raw /></span>
      <span>{label}</span>
    </button>
  );
}

/**
 * Bible Strong's GroupTitleButton and GroupActionsPopover: the group's pill opens a floating sheet
 * with Close all tabs, Edit and Delete (not for the default group), then New group and View my
 * groups. Edit opens EditGroupModal, View my groups ViewGroupsModal, New group the create page.
 */
export function GroupActions({ children, label, style }: { children: React.ReactNode; label: string; style?: CSSProperties }) {
  const { group, groups } = useTabs();
  const [open, setOpen] = useState<null | "menu" | "edit" | "view">(null);
  const close = () => setOpen(null);
  const remove = async () => {
    close();
    // Outside Telegram's popups, the browser's own confirm asks the same.
    const ok = features.popups
      ? await popup({ title: "Delete group?", message: "All tabs in this group will be closed.", buttons: [{ id: "cancel", type: "cancel" }, { id: "delete", type: "destructive", text: "Delete" }] }) === "delete"
      : window.confirm("Delete group?\n\nAll tabs in this group will be closed.");
    if (!ok) return;
    const index = groups.findIndex((g) => g.id === group.id);
    deleteGroup(group.id);
    groupPager.navigateToPage(Math.max(0, index - 1));
  };
  return (
    <>
      <button type="button" className="switcherbar__group" aria-label={label} style={style} onClick={() => setOpen("menu")}>{children}</button>
      <Sheet open={open === "menu"} onClose={close} label="Group actions">
        <div className="gmenu">
          <Action icon="x-circle" label="Close all tabs" onPress={() => { closeAll(group.id); close(); }} />
          {isDefaultGroup(group) ? null : <>
            <Action icon="edit-2" label="Edit group" onPress={() => setOpen("edit")} />
            <Action icon="trash-2" label="Delete group" quart onPress={() => void remove()} />
          </>}
          <div className="gmenu__divider" />
          <Action icon="plus" label="New group" onPress={() => { close(); groupPager.navigateToPage(groups.length); }} />
          <Action icon="layers" label="View my groups" onPress={() => setOpen("view")} />
        </div>
      </Sheet>
      {isDefaultGroup(group) ? null : <EditGroup open={open === "edit"} onClose={close} group={group} />}
      <ViewGroups open={open === "view"} onClose={close} />
    </>
  );
}

/** Bible Strong's colour radios: 32 px circles, the chosen one with a faint black dot in its centre. */
function Swatches({ value, onChange, gap }: { value: string; onChange: (c: string) => void; gap: "edit" | "create" }) {
  return (
    <div className={`gswatches gswatches--${gap}`} role="radiogroup" aria-label="Color">
      {GROUP_COLORS.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`Color ${i + 1}`} className="gswatch" style={{ background: c }} onClick={() => onChange(c)}>
          {value === c ? <span /> : null}
        </button>
      ))}
    </div>
  );
}

/** Bible Strong's EditGroupModal: "Edit group", the name and the colour in one sheet, saved with Save or the return key. */
function EditGroup({ open, onClose, group }: { open: boolean; onClose: () => void; group: Group }) {
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color || GROUP_COLORS[0]);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setName(group.name); setColor(group.color || GROUP_COLORS[0]);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.select(); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => { if (!name.trim()) return; renameGroup(group.id, name.trim(), color); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Edit group" footer={<div className="gedit__footer"><Button disabled={!name.trim()} onClick={save}>Save</Button></div>}>
      <div className="gedit">
        <label className="gedit__field"><span>Name</span>
          <input ref={field} value={name} placeholder="Group name" enterKeyHint="send" onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        </label>
        <div className="gedit__field"><span>Color</span><Swatches value={color} onChange={setColor} gap="edit" /></div>
      </div>
    </Sheet>
  );
}

/** date-fns' formatDistance with addSuffix, in English: "5 minutes ago", "about 2 hours ago". */
export function timeAgo(from: number, to: number): string {
  const minutes = Math.round((to - from) / 60000);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  let text: string;
  if (minutes < 1) text = "less than a minute";
  else if (minutes < 2) text = "1 minute";
  else if (minutes < 45) text = plural(minutes, "minute");
  else if (minutes < 90) text = "about 1 hour";
  else if (minutes < 1440) text = `about ${plural(Math.round(minutes / 60), "hour")}`;
  else if (minutes < 2520) text = "1 day";
  else if (minutes < 43200) text = plural(Math.round(minutes / 1440), "day");
  else if (minutes < 86400) text = `about ${plural(Math.round(minutes / 43200), "month")}`;
  else {
    const months = Math.floor(minutes / 43200);
    if (months < 12) text = plural(Math.round(minutes / 43200), "month");
    else {
      const years = Math.floor(months / 12), rest = months % 12;
      text = rest < 3 ? `about ${plural(years, "year")}` : rest < 9 ? `over ${plural(years, "year")}` : `almost ${plural(years + 1, "year")}`;
    }
  }
  return to >= from ? `${text} ago` : `in ${text}`;
}

/** Bible Strong's TabPreviewGrid at 50 px: four of the group's tabs by kind on grey, the fourth showing how many more. */
function PreviewGrid({ group }: { group: Group }) {
  const tabs = group.tabs, more = tabs.length > 4;
  const cell = (i: number) => {
    if (i === 3 && more) return <span key="more" className="ggrid__cell">+{tabs.length - 3}</span>;
    const t = tabs[i];
    return t ? <span key={t.id} className="ggrid__cell"><TabIcon path={t.path} size={12} plain /></span> : null;
  };
  return <span className="ggrid" aria-hidden="true"><span className="ggrid__col">{cell(0)}{cell(2)}</span><span className="ggrid__col">{cell(1)}{cell(3)}</span></span>;
}

/** Bible Strong's ViewGroupsModal: a card per group, the current one outlined in its colour; a tap slides to it. */
function ViewGroups({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { groups, group: active } = useTabs();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (open) setNow(Date.now()); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} label="View my groups">
      <div className="gview">
        {groups.map((g, i) => {
          const created = isDefaultGroup(g) || !g.createdAt ? "Main group" : `Created ${timeAgo(g.createdAt, now)}`;
          const on = g.id === active.id;
          return (
            <button key={g.id} type="button" className="gcard" aria-label={`${groupLabel(g)}. ${created}`} aria-pressed={on}
              style={on ? { borderColor: g.color || "var(--bs-primary, var(--accent))" } : undefined} data-active={on ? "" : undefined}
              onClick={() => { groupPager.navigateToPage(i); onClose(); }}>
              <PreviewGrid group={g} />
              <span className="gcard__text">
                <span className="gcard__name"><span className="gcard__dot" style={g.color ? { background: g.color } : undefined} /><b>{groupLabel(g)}</b></span>
                <small>{created}</small>
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/**
 * Bible Strong's CreateGroupPage, the page after the last group: a 30 px name, the nine colours, ✕
 * and ✓. It is revealed as the pager slides to it (scale .8 to 1, fading in, held in place), takes
 * the focus once fully shown, and is cleared when left.
 */
export function CreateGroupPage({ shown, onCancel, pageRef }: { shown: boolean; onCancel: () => void; pageRef: React.Ref<HTMLElement> }) {
  const toast = useToast();
  const { groups } = useTabs();
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const field = useRef<HTMLInputElement>(null);
  const created = useRef(false);
  useEffect(() => {
    if (shown) { created.current = false; field.current?.focus({ preventScroll: true }); return; }
    if (created.current) { created.current = false; return; }
    setName(""); setColor(GROUP_COLORS[0]); field.current?.blur();
  }, [shown]);
  const create = () => {
    if (!name.trim()) return;
    created.current = true;
    const id = newGroup(name.trim(), color);
    if (!id) { toast("Group limit reached", { tone: "error" }); created.current = false; return; }
    setName(""); setColor(GROUP_COLORS[0]); field.current?.blur();
    groupPager.navigateToPage(groups.length);
  };
  const cancel = () => { setName(""); setColor(GROUP_COLORS[0]); field.current?.blur(); onCancel(); };
  const off = !name.trim();
  return (
    <section ref={pageRef} className="gcreate" aria-label="New group" inert={!shown}>
      <span className="gcreate__art" aria-hidden="true"><span style={{ ["--art" as string]: `url("${assetUrl("art/new-group.svg")}")` }} /></span>
      <div className="gcreate__bar">
        <button type="button" className="gcreate__cancel" aria-label="Cancel" onClick={cancel}><Feather name="x" size={24} raw /></button>
        <button type="button" className="gcreate__ok" aria-label="Create group" disabled={off} onClick={create}><Feather name="check" size={24} raw /></button>
      </div>
      <div className="gcreate__body">
        <input ref={field} className="gcreate__name" value={name} placeholder="Group name" aria-label="Group name" enterKeyHint="done" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }} />
        <Swatches value={color} onChange={setColor} gap="create" />
      </div>
    </section>
  );
}

