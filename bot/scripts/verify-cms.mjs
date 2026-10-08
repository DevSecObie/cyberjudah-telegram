import { pathToFileURL } from "node:url";
import { signInitData } from "../src/initdata.mjs";

/** Read-only checks: never save content, open a PR or publish a change. */
export async function verifyCms({ url, token, admins, fetcher = fetch, log = console.log }) {
  const ids = (admins ?? "").split(",").map(id => Number(id.trim())).filter(id => Number.isSafeInteger(id) && id > 0);
  if (!url || !token || !ids.length) throw new Error("WORKER_URL, BOT_TOKEN and ADMIN_IDS are required to verify the CMS");
  const origin = new URL(url).origin;
  const headers = async id => ({ authorization: `tma ${await signInitData({ user: { id, first_name: "Release check" }, auth_date: String(Math.floor(Date.now() / 1000)) }, token)}` });
  let reader = 1;
  while (ids.includes(reader)) reader++;
  const request = (path, headers) => fetcher(`${origin}/api/admin/cms/${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if ((await request("timeline", await headers(reader))).status !== 403) throw new Error("CMS rights check failed: a non-admin must be refused");
  const adminHeaders = await headers(ids[0]);
  for (const [path, field] of [["timeline", "entries"], ["classes", "classes"], ["people", "people"], ["precepts", "passes"]]) {
    const response = await request(path, adminHeaders);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`CMS ${path} unavailable (HTTP ${response.status}): ${typeof body.error === "string" ? body.error.slice(0, 200) : "check repository credentials"}`);
    if (!Array.isArray(body[field])) throw new Error(`CMS ${path} returned an invalid list`);
    log(`CMS ${path}: admin read verified (${body[field].length} entries)`);
  }
  log("CMS non-admin access: refused; no edits performed");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const escape = message => String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  verifyCms({ url: process.env.WORKER_URL, token: process.env.BOT_TOKEN, admins: process.env.ADMIN_IDS, log: message => console.log(`::notice::${escape(message)}`) })
    .catch(error => { console.error(`::error::${escape(error.message)}`); process.exitCode = 1; });
}
