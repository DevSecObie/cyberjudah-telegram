import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";

import { data, type PersonIndexRow } from "@/api/data";
import { usePeopleNamed } from "@/lib/taught";
import { sheetOpened } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { avatarKind, EntityAvatar, type AvatarKind } from "@/ui/avatar";
import { EXTRA_STAGGER, fly, place, reduced, SOURCE_SETTLE, SOURCE_STAGGER } from "../dom/MediaDeck";
import { Feather } from "../icons";
import type { Palette } from "../theme";

/**
 * Bible Strong's ChapterEntities, at the end of the chapter: "In This Chapter", with the people
 * named in it as a small fanned stack of avatars beside the deck of classes that taught it. A tap
 * spreads the people over the page, each avatar flying from the stack to its place; a person
 * opens their page.
 */
const MAX_STACKED = 3;
const ROUND: [string, string] = ["50%", "50%"];
const fan = (i: number, n: number) => { if (n <= 1) return { x: 0, y: 0, r: 0 }; const p = (i / (n - 1)) * 2 - 1; return { x: p * 6, y: Math.abs(p) * 2, r: p * 5 }; };
const KIND_LABEL: Record<AvatarKind, string> = { male: "Man", female: "Woman", group: "People", other: "Person" };

type Named = { p: PersonIndexRow; n: number; kind: AvatarKind };
const inkOf = (kind: AvatarKind, c: Palette) => kind === "female" ? c.quart : kind === "male" ? c.primary : c.tertiary;

export function ChapterPeople({ slug, chapter, palette: c, resources }: { slug: string; chapter: number; palette: Palette; resources?: ReactNode }) {
  const named = usePeopleNamed(slug, chapter);
  const everyone = useQuery({ queryKey: ["people-index"], enabled: !!named.data && Object.keys(named.data).length > 0, staleTime: Infinity, queryFn: () => data.people() });
  const stack = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [slug, chapter]);

  const people: Named[] = [];
  if (named.data && everyone.data) {
    const count = new Map<string, number>();
    for (const ids of Object.values(named.data)) for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
    const byId = new Map(everyone.data.map((p) => [p.id, p]));
    for (const [id, n] of [...count.entries()].sort((a, b) => b[1] - a[1])) { const p = byId.get(id); if (p) people.push({ p, n, kind: avatarKind(p.type) }); }
  }
  if (!people.length && !resources) return null;
  const shown = people.slice(0, MAX_STACKED);
  return (
    <section className="bs-entities" aria-label="In This Chapter">
      <h2 className="bs-entities__title"><span>In This Chapter</span></h2>
      <div className="bs-entities__row">
        {shown.length ? (
          <button ref={stack} type="button" className="bs-entities__stack" data-ignore-verse-touch=""
            aria-label={`People in this chapter: ${people.map(({ p }) => p.name).join(", ")}`} title={`People in this chapter: ${people.map(({ p }) => p.name).join(", ")}`}
            onClick={(e) => { e.stopPropagation(); haptic("select"); setOpen(true); }}>
            {shown.map(({ p, kind }, i) => {
              const f = fan(i, shown.length);
              return <EntityAvatar key={p.id} id={p.id} name={p.name} kind={kind} size={62} ink={inkOf(kind, c)} base={c.reverse} className="bs-entities__avatar"
                data-person-stack={p.id} data-rotate={String(f.r)}
                style={{ transform: `translate(${f.x}px, ${f.y}px) rotate(${f.r}deg)`, zIndex: i + 1, borderColor: c.reverse, visibility: open ? "hidden" : undefined }} />;
            })}
          </button>
        ) : null}
        {resources}
      </div>
      {open ? <PeopleOverlay people={people} source={stack} palette={c} onClosed={() => setOpen(false)} /> : null}
    </section>
  );
}

function PeopleOverlay({ people, source, palette: c, onClosed }: { people: Named[]; source: React.RefObject<HTMLButtonElement | null>; palette: Palette; onClosed: () => void }) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const stacked = [...(source.current?.querySelectorAll<HTMLElement>("[data-person-stack]") ?? [])].map((el) => el.dataset.personStack!);
  const extraStart = stacked.length ? (stacked.length - 1) * SOURCE_STAGGER + SOURCE_SETTLE : 160;
  const rest = people.filter(({ p }) => !stacked.includes(p.id));
  const delayOf = (id: string) => { const i = stacked.indexOf(id); return i >= 0 ? i * SOURCE_STAGGER : extraStart + rest.findIndex(({ p }) => p.id === id) * EXTRA_STAGGER; };

  // The stack's avatars fly to their places; everyone else fades in after them.
  useLayoutEffect(() => {
    setShown(true);
    for (const el of root.current?.querySelectorAll<HTMLElement>("[data-person-card]") ?? []) {
      const id = el.dataset.personCard!;
      const from = source.current?.querySelector<HTMLElement>(`[data-person-stack="${CSS.escape(id)}"]`);
      if (from) fly(el, place(from), Number(from.dataset.rotate ?? 0), delayOf(id), false, ROUND);
      else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? 0 : 200, delay: reduced() ? 0 : delayOf(id), fill: "both" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Telegram's back button closes the overlay first.
  useEffect(() => sheetOpened(), []);

  // Close: the stack's avatars fly home and the page comes back.
  const close = () => {
    if (closing) return;
    setClosing(true); setShown(false);
    let flew = false;
    for (const el of root.current?.querySelectorAll<HTMLElement>("[data-person-card]") ?? []) {
      const from = source.current?.querySelector<HTMLElement>(`[data-person-stack="${CSS.escape(el.dataset.personCard!)}"]`);
      el.getAnimations().forEach((a) => a.cancel());
      if (from) { flew = true; fly(el, place(from), Number(from.dataset.rotate ?? 0), 0, true, ROUND); }
      else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 0 : 160, fill: "both" });
    }
    window.setTimeout(onClosed, reduced() ? 0 : flew ? 300 : 200);
  };
  useEffect(() => {
    const el = root.current; if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onBack = () => close();
    window.addEventListener("keydown", onKey);
    el.addEventListener("cj:close", onBack);
    return () => { window.removeEventListener("keydown", onKey); el.removeEventListener("cj:close", onBack); };
  });

  return createPortal(
    <div ref={root} className="bs-gallery bs-gallery--people" data-open={shown ? "" : undefined} role="dialog" aria-modal="true" aria-label="People in this chapter" data-sheet-open=""
      style={{ ["--deck-bg" as string]: "var(--canvas)", ["--deck-ink" as string]: "var(--text-1)", ["--deck-primary" as string]: "var(--accent)", color: "var(--text-1)" }}
      onClick={close}>
      <button type="button" className="bs-gallery__close" aria-label="Close" title="Close" style={{ background: "var(--canvas)", color: "var(--text-1)" }} onClick={(e) => { e.stopPropagation(); close(); }}>
        <Feather name="x" size={24} color="var(--text-1)" />
      </button>
      <div className="bs-gallery__scroll">
        <div className={`bs-people${people.length <= 6 ? " bs-people--center" : ""}`}>
          {people.map(({ p, n, kind }) => (
            <button key={p.id} type="button" className="bs-people__item" aria-label={`Open ${p.name}`} title={`Open ${p.name}`}
              onClick={(e) => { e.stopPropagation(); haptic("select"); navigate(`/person/${p.id}`); }}>
              <EntityAvatar id={p.id} name={p.name} kind={kind} size={68} ink={inkOf(kind, c)} base={c.reverse} className="bs-people__avatar" data-person-card={p.id} style={{ borderColor: c.reverse }} />
              <span className="bs-people__text" style={{ animationDelay: `${delayOf(p.id) + 180}ms` }}>
                <b>{p.name}</b>
                <small>{KIND_LABEL[kind]} · {n} {n === 1 ? "verse" : "verses"}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
