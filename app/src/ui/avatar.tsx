import type { CSSProperties } from "react";
import { PORTRAITS } from "./portraits";

/**
 * A person's avatar, as Bible Strong shows one for each entity (a man, a woman, a group). A person
 * with an approved portrait (PORTRAITS, by person id) shows it; everyone else keeps the name's first
 * letter on a tint for its kind.
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

/** The portrait file sized for the avatar: 64, 128 or 256px, enough for a 2x screen. */
export function portraitSrc(id: string | undefined, size: number): string | undefined {
  if (!id || !PORTRAITS.has(id)) return undefined;
  const px = size * 2 <= 64 ? 64 : size * 2 <= 128 ? 128 : 256;
  return `${import.meta.env.BASE_URL}people/${id}-${px}.webp`;
}

const initial = (name: string) => (name.replace(/^(the|a|an)\s+/i, "").match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();

/** `ink` and `base` set the colours where the page's own tokens don't reach (the Bible's portals). */
export function EntityAvatar({ id, name, kind, size = 52, ink, base, className, style, ...rest }: {
  id?: string; name: string; kind: AvatarKind; size?: number; ink?: string; base?: string; className?: string; style?: CSSProperties;
} & Record<`data-${string}`, string | undefined>) {
  const src = portraitSrc(id, size) ?? AVATAR_IMAGES[kind];
  const vars = { ...(ink ? { ["--av-ink" as string]: ink } : {}), ...(base ? { ["--av-base" as string]: base } : {}) };
  return (
    <span className={`avatar${className ? ` ${className}` : ""}`} data-kind={kind} data-portrait={src ? "" : undefined} aria-hidden="true" {...rest}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...vars, ...style }}>
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} /> : initial(name)}
    </span>
  );
}
