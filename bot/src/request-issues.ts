import type { Env } from "./env";
import type { NoteRequest } from "./requests";

/** The content repository (cms-github.ts CONTENT_REPO); kept here so this module has no runtime imports. */
const CONTENT_REPO = "DevSecObie/cyberjudah";

/**
 * The notes pipeline: each class readers ask notes for has one open issue in the content
 * repository, labelled notes-request, with how many have asked. The scheduled notes job writes the
 * most asked first, and the class's pull request closes the issue when it merges.
 *
 * Only a class with a transcript in the repository gets an issue, and the issue is written from that
 * transcript's own title and date, never from what the reader sent, so nothing a reader types is
 * published. Who asked is never written to GitHub, only the count.
 */
export const LABEL = "notes-request";
export type ClassInfo = { title: string; date: string };
type Keys = Pick<Env, "SUBS" | "CYBERJUDAH_TOKEN">;

const clean = (s: string) => s.replace(/[\u0000-\u001f<>@`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);

export function issueText(video: string, cls: ClassInfo, count: number) {
  const title = clean(cls.title) || video;
  return {
    title: `Notes request: ${title}`,
    body: [
      `Readers asked for the study notes (precept pass) of **${title}**${cls.date ? ` (${cls.date})` : ""}.`,
      "",
      `- Video: https://www.youtube.com/watch?v=${video}`,
      `- Asks: ${count}`,
      `- File: \`data/precepts/classes/${video}.json\``,
      "",
      "The scheduled notes job writes the most asked first. The pass's pull request closes this issue when it merges.",
      "",
      `<!-- notes-request:${video} -->`,
    ].join("\n"),
  };
}

async function github(env: Keys, path: string, init: RequestInit, fetcher: typeof fetch) {
  return fetcher(`https://api.github.com/repos/${CONTENT_REPO}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${env.CYBERJUDAH_TOKEN}`, "user-agent": "CyberJudah-Notes", "x-github-api-version": "2022-11-28", "content-type": "application/json" },
  });
}

/**
 * Open the class's issue, or bring its count up to date. Returns the issue number, or null when
 * GitHub is not configured or refused (the request itself is kept either way).
 */
export async function syncRequestIssue(env: Keys, r: NoteRequest, cls: ClassInfo, fetcher: typeof fetch = fetch): Promise<number | null> {
  if (!env.CYBERJUDAH_TOKEN) return null;
  const text = issueText(r.video, cls, r.count);
  if (r.issue) {
    const res = await github(env, `/issues/${r.issue}`, { method: "PATCH", body: JSON.stringify(text) }, fetcher);
    return res.ok ? r.issue : null;
  }
  const res = await github(env, "/issues", { method: "POST", body: JSON.stringify({ ...text, labels: [LABEL] }) }, fetcher);
  if (!res.ok) return null;
  const issue = ((await res.json()) as { number?: number }).number;
  if (!issue) return null;
  // Keep the number with the request, re-read so an ask that landed meanwhile is not lost.
  const cur = (await env.SUBS.get(`notereq:${r.video}`, "json")) as NoteRequest | null;
  if (cur && !cur.issue) {
    await env.SUBS.put(`notereq:${r.video}`, JSON.stringify({ ...cur, issue }), { metadata: { title: cur.title, count: cur.count, last: cur.last } });
  }
  return issue;
}
