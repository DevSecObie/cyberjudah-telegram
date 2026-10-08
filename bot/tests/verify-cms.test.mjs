import test from "node:test";
import assert from "node:assert/strict";
import { validateInitData } from "../src/initdata.mjs";
import { verifyCms } from "../scripts/verify-cms.mjs";

test("CMS verification uses a configured admin, refuses non-admins and makes only reads", async () => {
  const paths = [];
  const options = { url: "https://fixture.invalid", token: "test-token", admins: "1,2", log() {}, fetcher: async (url, init) => {
    assert.equal(init.method, undefined);
    const user = (await validateInitData(init.headers.authorization.slice(4), "test-token")).user;
    const path = new URL(url).pathname.split("/").at(-1); paths.push(path);
    if (user.id === 3) return new Response(null, { status: 403 });
    assert.equal(user.id, 1);
    return Response.json({ [{ timeline: "entries", classes: "classes", people: "people", precepts: "passes" }[path]]: [] });
  } };
  await verifyCms(options);
  assert.deepEqual(paths, ["timeline", "timeline", "classes", "people", "precepts"]);
  await assert.rejects(verifyCms({ ...options, admins: "" }), /ADMIN_IDS/);
  await assert.rejects(verifyCms({ ...options, fetcher: async () => new Response(null) }), /non-admin must be refused/);
});

test("CMS verification reports every unavailable editor and still checks working editors", async () => {
  let calls = 0;
  const paths = [], messages = [];
  await assert.rejects(verifyCms({ url: "https://fixture.invalid", token: "test-token", admins: "2", log: message => messages.push(message), fetcher: async url => {
    if (++calls === 1) return new Response(null, { status: 403 });
    const path = new URL(url).pathname.split("/").at(-1); paths.push(path);
    if (path === "timeline") return Response.json({ error: "Missing APP_REPO_TOKEN" }, { status: 503 });
    if (path === "classes") return Response.json({ error: "Missing CYBERJUDAH_TOKEN" }, { status: 503 });
    return Response.json({ [{ people: "people", precepts: "passes" }[path]]: [] });
  } }), error => /APP_REPO_TOKEN/.test(error.message) && /CYBERJUDAH_TOKEN/.test(error.message));
  assert.deepEqual(paths, ["timeline", "classes", "people", "precepts"]);
  assert.ok(messages.some(message => message.startsWith("CMS people: admin read verified")));
  assert.ok(messages.some(message => message.startsWith("CMS precepts: admin read verified")));
});
