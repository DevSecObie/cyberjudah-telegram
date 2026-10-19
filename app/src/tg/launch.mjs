import { launchPath } from "../../../shared/links.mjs";

/**
 * Where the app opens. Only an open at the root is redirected: a start parameter selects its
 * screen; otherwise the app reopens the tab that was current, as Bible Strong does
 * (AppSwitcherScreen restores the last active tab). A tab still on the New Tab page, or none
 * yet (the first launch), leaves the welcome page at the root.
 */
export function initialLaunchPath(pathname, param, lastTab) {
  if (pathname !== "/") return null;
  const to = launchPath(param);
  if (to !== "/") return to;
  if (typeof lastTab !== "string" || !lastTab.startsWith("/") || lastTab.startsWith("//") || lastTab === "/" || /^\/new(\?|$)/.test(lastTab)) return null;
  // The tab keeps an app path already (not a website path), so it is used as it is.
  return lastTab;
}
