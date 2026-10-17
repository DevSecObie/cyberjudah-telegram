import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";

const out = new URL("./.build/firestore-admin.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/firestore-admin.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
// A distinct query string per test group gives each its own module instance (and its own
// module-level access-token cache), the same trick bot/tests/mydata.test.mjs uses for storage state.
const load = (tag) => import(`${out}?case=${tag}`);

function field(v) { return { stringValue: v }; }
function doc(name, fields) { return { name, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, field(String(v))])) }; }

/** A minimal stand-in for both real Firestore and the local emulator: GET lists documents (with one
 * page of pagination so the loop is exercised), POST :batchWrite records and accepts every delete. */
function firestoreFetch({ byPath = {}, tokenEndpoint } = {}) {
  const calls = [];
  const batches = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: init.headers ?? {} });
    if (tokenEndpoint && u.href === "https://oauth2.googleapis.com/token") return tokenEndpoint(init);
    if (u.pathname.endsWith(":batchWrite")) {
      const body = JSON.parse(init.body);
      batches.push(body.writes);
      return new Response(JSON.stringify({ writeResults: body.writes.map(() => ({})) }), { status: 200 });
    }
    // Path after ".../documents/" identifies the collection or subcollection being listed.
    const marker = "/documents/";
    const path = u.pathname.slice(u.pathname.indexOf(marker) + marker.length);
    const pages = byPath[path];
    if (!pages) return new Response("", { status: 404 });
    const pageToken = u.searchParams.get("pageToken") ?? "0";
    const page = pages[Number(pageToken)];
    if (!page) return new Response(JSON.stringify({ documents: [] }), { status: 200 });
    const body = { documents: page.documents };
    if (page.next) body.nextPageToken = String(Number(pageToken) + 1);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchFn, calls, batches };
}

test("export and deletion are a no-op, without any network call, when Firestore is not configured", async () => {
  const { exportAccountSyncMarks, deleteAccountSyncMarks } = await load("unconfigured");
  const env = { fetch: undefined };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("must not call Firestore when it is not configured"); };
  try {
    assert.equal(await exportAccountSyncMarks(env, 1), null);
    assert.equal(await deleteAccountSyncMarks(env, 1), 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("an invalid signing secret rejects export and deletion instead of silently skipping them", async () => {
  const { exportAccountSyncMarks, deleteAccountSyncMarks } = await load("invalid-config");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("must not reach the network with an invalid secret"); };
  try {
    for (const bad of ["not json", JSON.stringify({ type: "service_account", project_id: "other-project", client_email: "x@other-project.iam.gserviceaccount.com", private_key: "x" })]) {
      const env = { FIREBASE_SERVICE_ACCOUNT: bad };
      await assert.rejects(exportAccountSyncMarks(env, 1));
      await assert.rejects(deleteAccountSyncMarks(env, 1));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("the end-to-end emulator needs no signing secret, is addressed as demo-cyberjudah, and its admin bypass token is used", async () => {
  const { exportAccountSyncMarks, deleteAccountSyncMarks } = await load("emulator");
  const highlight = doc("projects/demo-cyberjudah/databases/(default)/documents/users/tg_5/highlights/abc", { key: "bs_h_genesis_1", entry: "1", value: "color2" });
  const revisionSibling = doc("projects/demo-cyberjudah/databases/(default)/documents/users/tg_5/highlights/revision-1", { history: "true" });
  const note = doc("projects/demo-cyberjudah/databases/(default)/documents/users/tg_5/notes/note1", { key: "nt_genesis_1", entry: "1" });
  const noteRevision = doc("projects/demo-cyberjudah/databases/(default)/documents/users/tg_5/notes/note1/revisions/rev1", { history: "true" });
  const byPath = {
    "users/tg_5/highlights": [{ documents: [highlight, revisionSibling] }],
    "users/tg_5/notes": [{ documents: [note] }],
    "users/tg_5/notes/note1/revisions": [{ documents: [noteRevision] }],
    "users/tg_5/links": [{ documents: [] }],
    "users/tg_5/bookmarks": [{ documents: [] }],
    "users/tg_5/tags": [{ documents: [] }],
    "users/tg_5/relations": [{ documents: [] }],
    "users/tg_5/studies": [{ documents: [] }],
    "users/tg_5/wordAnnotations": [{ documents: [] }],
  };
  const { fetchFn, calls, batches } = firestoreFetch({ byPath });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    const env = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" };
    const exported = await exportAccountSyncMarks(env, 5);
    assert.deepEqual(Object.keys(exported).sort(), ["highlights", "notes"]);
    assert.equal(exported.highlights.length, 2, "the current mark and its sibling revision history doc both come back");
    const noteRow = exported.notes.find((r) => r.id === "note1");
    assert.equal(noteRow.revisions.length, 1, "a note's revision history, in its own subcollection, is attached");
    assert.ok(calls.every((c) => c.url.hostname === "127.0.0.1"), "every call goes to the loopback emulator, never the real service");
    assert.ok(calls.every((c) => c.headers.authorization === "Bearer owner"), "the emulator's documented admin bypass, never a real token");
    const deleted = await deleteAccountSyncMarks(env, 5);
    assert.equal(deleted, 4, "the highlight, its sibling revision, the note and the note's revision");
    assert.equal(batches.flat().length, 4);
    assert.ok(batches.flat().every((w) => w.delete.startsWith("projects/demo-cyberjudah/databases/(default)/documents/users/tg_5/")));
  } finally { globalThis.fetch = originalFetch; }
});

test("an emulator host that is not loopback is refused, the same as no configuration at all", async () => {
  const { exportAccountSyncMarks } = await load("non-loopback");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("must not treat a non-loopback host as the test emulator"); };
  try { assert.equal(await exportAccountSyncMarks({ FIRESTORE_EMULATOR_HOST: "evil.example:8089" }, 1), null); }
  finally { globalThis.fetch = originalFetch; }
});

test("production mints a Google access token from the signing secret, scoped to Firestore, and reuses it", async () => {
  const { exportAccountSyncMarks } = await load("production");
  const keys = await generateKeyPair("RS256", { extractable: true });
  const env = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ type: "service_account", project_id: "cyberjudah-app", client_email: "bridge@cyberjudah-app.iam.gserviceaccount.com", private_key: await exportPKCS8(keys.privateKey) }) };
  let mints = 0;
  const byPath = Object.fromEntries(["highlights", "notes", "links", "bookmarks", "tags", "relations", "studies", "wordAnnotations"]
    .map((name) => [`users/tg_9/${name}`, [{ documents: [] }]]));
  const { fetchFn, calls } = firestoreFetch({
    byPath,
    tokenEndpoint: async (init) => {
      mints++;
      const assertion = new URLSearchParams(init.body).get("assertion");
      const { payload } = await jwtVerify(assertion, keys.publicKey, { algorithms: ["RS256"], audience: "https://oauth2.googleapis.com/token", issuer: "bridge@cyberjudah-app.iam.gserviceaccount.com" });
      assert.equal(payload.sub, payload.iss);
      assert.equal(payload.scope, "https://www.googleapis.com/auth/datastore");
      return new Response(JSON.stringify({ access_token: "minted-token", expires_in: 3600 }), { status: 200 });
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    assert.equal(await exportAccountSyncMarks(env, 9), null, "no collection holds anything for this reader");
    await exportAccountSyncMarks(env, 9);
    assert.equal(mints, 1, "the access token is cached and reused rather than minted on every call");
    const firestoreCalls = calls.filter((c) => c.url.hostname === "firestore.googleapis.com");
    assert.ok(firestoreCalls.length > 0);
    assert.ok(firestoreCalls.every((c) => c.headers.authorization === "Bearer minted-token"));
    assert.ok(firestoreCalls.every((c) => c.url.pathname.startsWith("/v1/projects/cyberjudah-app/databases/(default)/documents/")));
  } finally { globalThis.fetch = originalFetch; }
});

test("deletion follows pagination through every page before writing, and a failed batch rejects rather than reporting a partial count", async () => {
  const { deleteAccountSyncMarks } = await load("batching");
  const many = Array.from({ length: 2 }, (_, i) => doc(`projects/demo-cyberjudah/databases/(default)/documents/users/tg_7/highlights/doc${i}`, { entry: String(i) }));
  const byPath = {
    "users/tg_7/highlights": [{ documents: [many[0]], next: true }, { documents: [many[1]] }],
    "users/tg_7/notes": [{ documents: [] }],
    "users/tg_7/links": [{ documents: [] }],
    "users/tg_7/bookmarks": [{ documents: [] }],
    "users/tg_7/tags": [{ documents: [] }],
    "users/tg_7/relations": [{ documents: [] }],
    "users/tg_7/studies": [{ documents: [] }],
    "users/tg_7/wordAnnotations": [{ documents: [] }],
  };
  const { fetchFn, batches } = firestoreFetch({ byPath });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    const deleted = await deleteAccountSyncMarks({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, 7);
    assert.equal(deleted, 2, "pagination across two pages is followed before any deletion happens");
    assert.equal(batches.length, 1);
  } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = async (url, init) => { if (new URL(url).pathname.endsWith(":batchWrite")) return new Response("", { status: 500 }); return fetchFn(url, init); };
  try { await assert.rejects(deleteAccountSyncMarks({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, 7), /deletion failed/i); }
  finally { globalThis.fetch = originalFetch; }
});
