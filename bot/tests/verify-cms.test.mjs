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
