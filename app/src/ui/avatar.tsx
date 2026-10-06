import { useEffect, useState, type CSSProperties } from "react";
import { bundledSrc, pictureSrc } from "./pictures";
import approved from "../../scripts/timeline-portraits.json";

/**
 * A person's avatar, as Bible Strong shows one for each entity (a man, a woman, a group). A person
 * with an approved portrait shows it: the same approved set and files as the Timeline
 * (app/scripts/timeline-portraits.json, public/people/<id>-<size>.webp; docs/AVATARS.md). Everyone
 * else keeps the name's first letter on a tint for its kind.
 */
export type AvatarKind = "male" | "female" | "group" | "other";

export const AVATAR_IMAGES: Partial<Record<AvatarKind, string>> = {};

/** The kind of avatar from TIPNR's type ("Male", "Female", "Group" ...). */
export function avatarKind(type?: string): AvatarKind {
  const t = (type ?? "").toLowerCase();
  if (t === "female") return "female";
  if (t === "male") return "male";
  if (t.includes("group") || t.includes("people") || t.includes("tribe")) return "group";
  return "other";
}

/** Person ids with an approved portrait, shared with the Timeline. */
export const PORTRAITS: ReadonlySet<string> = new Set((approved as { ids: string[] }).ids);

/** The approved portrait's path (under app/public) sized for the avatar: 128 or 256px, enough for a 2x screen. */
export function portraitPath(id: string | undefined, size: number): string | undefined {
  if (!id || !PORTRAITS.has(id)) return undefined;
  return `people/${id}-${size * 2 <= 128 ? 128 : 256}.webp`;
}

const initial = (name: string) => (name.replace(/^(the|a|an)\s+/i, "").match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();

/** `ink` and `base` set the colours where the page's own tokens don't reach (the Bible's portals). */
export function EntityAvatar({ id, name, kind, src: picture, size = 52, ink, base, className, style, ...rest }: {
  id?: string; name: string; kind: AvatarKind; src?: string; size?: number; ink?: string; base?: string; className?: string; style?: CSSProperties;
} & Record<`data-${string}`, string | undefined>) {
  // The portrait from R2, then its bundled copy, then any other picture; the letter when none loads.
  const path = portraitPath(id, size);
  const tries = [...(path ? [pictureSrc(path), bundledSrc(path)] : []), picture, AVATAR_IMAGES[kind]].filter((s): s is string => !!s);
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [tries[0]]);
  const src = tries[failed];
  const vars = { ...(ink ? { ["--av-ink" as string]: ink } : {}), ...(base ? { ["--av-base" as string]: base } : {}) };
  return (
    <span className={`avatar${className ? ` ${className}` : ""}`} data-kind={kind} aria-hidden="true" {...rest}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...vars, ...style }}>
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => setFailed((n) => n + 1)} /> : initial(name)}
    </span>
  );
}
