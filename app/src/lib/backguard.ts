/**
 * The first screen must not be the page's first history entry. Telegram shows its own back button
 * only when there is somewhere to go, but a phone's back gesture, Telegram Desktop's back and a
 * browser's back walk the page's history, and from the first entry that leaves the app for a blank
 * page: a black screen with nothing to tap until a refresh. So a guard entry sits under the app,
 * and a back step onto it is taken back at once: the app stays where it is.
 */
type Guard = { cjBase: true };
const isGuard = (s: unknown): s is Guard => !!s && typeof s === "object" && (s as Guard).cjBase === true;

export function installBackGuard() {
  try {
    if (isGuard(history.state)) { history.pushState(null, "", location.href); }
    else {
      history.replaceState({ cjBase: true } satisfies Guard, "", location.href);
      history.pushState(null, "", location.href);
    }
    window.addEventListener("popstate", (e) => {
      if (isGuard(e.state)) history.pushState(null, "", location.href);
    });
  } catch { /* a sandbox without history: nothing to guard */ }
}
