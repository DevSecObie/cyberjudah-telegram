import { launchPath } from "../../../shared/links.mjs";

/** A start parameter selects a screen only when opening the app root. */
export function initialLaunchPath(pathname, param) {
  if (pathname !== "/") return null;
  const to = launchPath(param);
  return to === "/" ? null : to;
}
