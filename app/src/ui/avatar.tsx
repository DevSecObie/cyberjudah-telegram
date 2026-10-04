import type { CSSProperties } from "react";

/**
 * A person's avatar, as Bible Strong shows one for each entity (a man, a woman, a group). Our own
 * pictures are still to be made: until then each is the name's first letter on a tint for its
 * kind. When the pictures exist, put them in AVATAR_IMAGES and every avatar in the app uses them.
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

const initial = (name: string) => (name.replace(/^(the|a|an)\s+/i, "").match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();

/** `ink` and `base` set the colours where the page's own tokens don't reach (the Bible's portals). */
export function EntityAvatar({ name, kind, src: picture, size = 52, ink, base, className, style, ...rest }: {
  name: string; kind: AvatarKind; src?: string; size?: number; ink?: string; base?: string; className?: string; style?: CSSProperties;
} & Record<`data-${string}`, string | undefined>) {
  const src = picture || AVATAR_IMAGES[kind];
  const vars = { ...(ink ? { ["--av-ink" as string]: ink } : {}), ...(base ? { ["--av-base" as string]: base } : {}) };
  return (
    <span className={`avatar${className ? ` ${className}` : ""}`} data-kind={kind} aria-hidden="true" {...rest}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...vars, ...style }}>
      {src ? <img src={src} alt="" draggable={false} /> : initial(name)}
    </span>
  );
}
