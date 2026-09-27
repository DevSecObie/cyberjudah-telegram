// @ts-check
/** @typedef {{ live: boolean; upcoming: boolean; video: string | null; title: string | null; starts: string | null; checked: string }} LiveNow */

/**
 * The stream named on a channel's /live page: on the air, or scheduled, or neither. The page
 * carries the player response of that stream; nothing else in the app needs an API key for it.
 * @param {string} html
 * @param {string} checked
 * @returns {LiveNow}
 */
export function parseLive(html, checked) {
  const none = { live: false, upcoming: false, video: null, title: null, starts: null, checked };
  const details = /"videoDetails":\{(.*?)\},"(?:playerConfig|annotations|storyboards|microformat)/s.exec(html)?.[1] ?? "";
  const video = /"videoId":"([\w-]{11})"/.exec(details)?.[1] ?? null;
  if (!video) return none;
  const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(details)?.[1]?.replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/\\\\/g, "\\") ?? null;
  const live = /"isLiveNow":true/.test(html) || (/"isLive":true/.test(details) && !/"isUpcoming":true/.test(details));
  const upcoming = !live && /"isUpcoming":true/.test(details);
  const starts = /"scheduledStartTime":"(\d+)"/.exec(html)?.[1];
  return { live, upcoming, video, title, starts: starts ? new Date(Number(starts) * 1000).toISOString() : null, checked };
}
