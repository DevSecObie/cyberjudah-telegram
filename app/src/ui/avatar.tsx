import { useState, type CSSProperties } from "react";
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

/** The approved portrait sized for the avatar (128 or 256px, enough for a 2x screen), if there is one. */
export function portraitSrc(id: string | undefined, size: number): string | undefined {
  if (!id || !PORTRAITS.has(id)) return undefined;
  return `${import.meta.env.BASE_URL}people/${id}-${size * 2 <= 128 ? 128 : 256}.webp`;
}

const initial = (name: string) => (name.replace(/^(the|a|an)\s+/i, "").match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();

/** `ink` and `base` set the colours where the page's own tokens don't reach (the Bible's portals). */
export function EntityAvatar({ id, name, kind, src: picture, size = 52, ink, base, className, style, ...rest }: {
  id?: string; name: string; kind: AvatarKind; src?: string; size?: number; ink?: string; base?: string; className?: string; style?: CSSProperties;
} & Record<`data-${string}`, string | undefined>) {
  const [failed, setFailed] = useState<string>();
  const wanted = portraitSrc(id, size) || picture || AVATAR_IMAGES[kind];
  const src = wanted && wanted !== failed ? wanted : undefined;
  const vars = { ...(ink ? { ["--av-ink" as string]: ink } : {}), ...(base ? { ["--av-base" as string]: base } : {}) };
  return (
    <span className={`avatar${className ? ` ${className}` : ""}`} data-kind={kind} aria-hidden="true" {...rest}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...vars, ...style }}>
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} /> : initial(name)}
    </span>
  );
}
