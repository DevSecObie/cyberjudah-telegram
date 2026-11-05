import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";

const out = new URL("./.build/firestore-admin.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/firestore-admin.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
// A distinct query string per test group gives each its own module instance (and its own
// module-level access-token cache), the same trick bot/tests/mydata.test.mjs uses for storage state.
const load = (tag) => import(`${out}?case=${tag}`);

const identityEnv = { BOT_TOKEN: "firestore-identity-fixture", DB: { prepare: () => ({ bind() { return this; }, run: async () => ({}), first: async () => null }) } };

function field(v) { return { stringValue: v }; }
// Firestore stamps every stored document with createTime; a "missing" parent (subcollections only) has none.
function doc(name, fields) { return { name, createTime: "2026-10-28T00:00:00Z", fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, field(String(v))])) }; }

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
      return new Response(JSON.stringify({ writeResults: body.writes.map(() => ({})), status: body.writes.map(() => ({})) }), { status: 200 });
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
      const env = { ...identityEnv, FIREBASE_SERVICE_ACCOUNT: bad };
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
    const env = { ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" };
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
  const env = { ...identityEnv, FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ type: "service_account", project_id: "cyberjudah-app", client_email: "bridge@cyberjudah-app.iam.gserviceaccount.com", private_key: await exportPKCS8(keys.privateKey) }) };
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
    const deleted = await deleteAccountSyncMarks({ ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, 7);
    assert.equal(deleted, 2, "pagination across two pages is followed before any deletion happens");
    assert.equal(batches.length, 1);
  } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = async (url, init) => { if (new URL(url).pathname.endsWith(":batchWrite")) return new Response("", { status: 500 }); return fetchFn(url, init); };
  try { await assert.rejects(deleteAccountSyncMarks({ ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, 7), /deletion failed/i); }
  finally { globalThis.fetch = originalFetch; }
});

test("deletion of a linked login reaches everything Bible Strong keeps for it, staging included, found by listing rather than by name", async () => {
  const { deleteAccountSyncMarks } = await load("bible-strong");
  const root = "projects/demo-cyberjudah/databases/(default)/documents";
  const env = { ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089", DB: { prepare: (sql) => ({ bind() { return this; }, run: async () => ({}), first: async () => sql.startsWith("SELECT firebase_uid") ? { firebase_uid: "google-uid" } : null }) } };
  const lists = {
    "staging_users/google-uid/strongsHebreu": [doc(`${root}/staging_users/google-uid/strongsHebreu/H430`, { n: 1 })],
    "staging_users/google-uid/tabGroups": [doc(`${root}/staging_users/google-uid/tabGroups/g1`, { n: 1 })],
    // A parent kept only for its subcollection is not itself stored; its children still go.
    "staging_users/google-uid/notes": [{ name: `${root}/staging_users/google-uid/notes/n1` }],
    "staging_users/google-uid/notes/n1/revisions": [doc(`${root}/staging_users/google-uid/notes/n1/revisions/r1`, { n: 1 })],
    "users/tg_8/highlights": [doc(`${root}/users/tg_8/highlights/h1`, { n: 1 })],
    "staging_studies/s1/revisions": [doc(`${root}/staging_studies/s1/revisions/r1`, { n: 1 })],
  };
  const ids = { "staging_users/google-uid": ["strongsHebreu", "tabGroups", "notes"], "staging_users/google-uid/notes/n1": ["revisions"] };
  const docs = new Set(["staging_users/google-uid", "staging_users-status/google-uid", "users/google-uid"]);
  const queries = [];
  const writes = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.hostname, "127.0.0.1");
    if (u.pathname.endsWith(":batchWrite")) { const batch = JSON.parse(init.body).writes; writes.push(...batch.map((w) => w.delete)); return Response.json({ status: batch.map(() => ({})) }); }
    if (u.pathname.endsWith("/documents:runQuery")) {
      const query = JSON.parse(init.body).structuredQuery;
      queries.push([query.from[0].collectionId, query.where.fieldFilter.field.fieldPath, query.where.fieldFilter.value.stringValue]);
      return Response.json(query.from[0].collectionId === "staging_studies" && query.where.fieldFilter.value.stringValue === "google-uid"
        ? [{ document: doc(`${root}/staging_studies/s1`, { n: 1 }) }] : [{ readTime: "now" }]);
    }
    const path = decodeURIComponent(u.pathname.slice(u.pathname.indexOf("/documents/") + "/documents/".length));
    if (path.endsWith(":listCollectionIds")) {
      const found = ids[path.slice(0, -":listCollectionIds".length)];
      return found ? Response.json({ collectionIds: found }) : new Response("", { status: 404 });
    }
    if (lists[path]) {
      if (lists[path].some((d) => !d.createTime)) assert.equal(u.searchParams.get("showMissing"), "true");
      return Response.json({ documents: lists[path] });
    }
    if (docs.has(path)) return Response.json(doc(`${root}/${path}`, { n: 1 }));
    return new Response("", { status: 404 });
  };
  try {
    const deleted = await deleteAccountSyncMarks(env, 8);
    const expected = [
      "staging_users/google-uid/strongsHebreu/H430", "staging_users/google-uid/tabGroups/g1", "staging_users/google-uid/notes/n1/revisions/r1",
      "staging_users/google-uid", "staging_users-status/google-uid", "users/google-uid",
      "users/tg_8/highlights/h1", "staging_studies/s1/revisions/r1", "staging_studies/s1",
    ].map((p) => `${root}/${p}`);
    assert.deepEqual([...writes].sort(), [...expected].sort());
    assert.equal(deleted, expected.length);
    assert.ok(writes.indexOf(`${root}/staging_studies/s1/revisions/r1`) < writes.indexOf(`${root}/staging_studies/s1`), "children go before their parent");
    assert.deepEqual(queries.filter(([, , uid]) => uid === "google-uid").map(([c]) => c).sort(), ["staging_studies", "studies", "study_deletion_owners"]);
    assert.ok(queries.every(([, field]) => field === "user.id"), "studies are found by their owner, never by listing other readers'");
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP 200 does not acknowledge deletion when a write failed or its status is missing", async () => {
  const { deleteAccountSyncMarks } = await load("write-status");
  const documents = Array.from({ length: 301 }, (_, i) => doc(`projects/demo-cyberjudah/databases/(default)/documents/users/tg_7/highlights/doc${i}`, {}));
  const { fetchFn } = firestoreFetch({ byPath: { "users/tg_7/highlights": [{ documents }] } });
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [
      { status: Array.from({ length: 300 }, (_, i) => i === 0 ? { code: 7, message: "Permission denied" } : {}) },
      {}, { status: [] }, { status: Array(299).fill({}) },
      { status: Array(300).fill(null) }, { status: Array(300).fill({ code: "0" }) },
    ]) {
      let writes = 0;
      globalThis.fetch = async (url, init) => {
        if (new URL(url).pathname.endsWith(":batchWrite")) {
          writes++;
          return Response.json(body);
        }
        return fetchFn(url, init);
      };
      await assert.rejects(deleteAccountSyncMarks({ ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, 7), /deletion failed/i);
      assert.equal(writes, 1, "stop before another batch when any delete is unconfirmed");
    }
    globalThis.fetch = async (url, init) => {
      if (new URL(url).pathname.endsWith(":batchWrite")) return Response.json({ status: JSON.parse(init.body).writes.map(() => ({ code: 0 })) });
      return fetchFn(url, init);
    };
    assert.equal(await deleteAccountSyncMarks({ ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, 7), 301);
  } finally { globalThis.fetch = originalFetch; }
});

test("a failed revision delete preserves the owning study for an owner-query retry", async () => {
  const { deleteAccountSyncMarks } = await load("parent-retry");
  const root = "projects/demo-cyberjudah/databases/(default)/documents";
  const study = `${root}/studies/mine`, other = `${root}/studies/theirs`;
  const revision = `${study}/revisions/r1`, sibling = `${study}/revisions/r2`;
  const store = new Map([
    [study, { user: { mapValue: { fields: { id: { stringValue: "tg_7" } } } } }],
    [other, { user: { mapValue: { fields: { id: { stringValue: "tg_8" } } } } }],
    [revision, {}], [sibling, {}], [`${other}/revisions/r1`, {}],
  ]);
  let failRevision = true;
  const batches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.hostname, "127.0.0.1");
    const document = name => ({ name, fields: store.get(name), createTime: "2026-11-05T00:00:00Z" });
    if (u.pathname.endsWith(":batchWrite")) {
      const writes = JSON.parse(init.body).writes.map(w => w.delete);
      batches.push(writes);
      // A real batchWrite is not atomic: a sibling or parent succeeds even if a revision fails.
      return Response.json({ status: writes.map(name => {
        if (name === revision && failRevision) return { code: 14 };
        store.delete(name);
        return {};
      }) });
    }
    if (u.pathname.endsWith(":runQuery")) {
      const query = JSON.parse(init.body).structuredQuery;
      assert.equal(query.where.fieldFilter.value.stringValue, "tg_7");
      return Response.json(query.from[0].collectionId === "studies" && store.has(study)
        ? [{ document: document(study) }] : []);
    }
    const path = u.pathname.slice(u.pathname.indexOf("/documents/") + "/documents/".length);
    if (path.endsWith(":listCollectionIds")) return Response.json({ collectionIds: [] });
    const name = `${root}/${path}`;
    if (store.has(name)) return Response.json(document(name));
    if (path.split("/").length % 2 === 0) return new Response("", { status: 404 });
    const docs = [...store.keys()].filter(key => key.startsWith(`${name}/`) && !key.slice(name.length + 1).includes('/'));
    return Response.json({ documents: docs.map(document) });
  };
  try {
    const env = { ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" };
    await assert.rejects(deleteAccountSyncMarks(env, 7), /deletion failed/i);
    assert.equal(store.has(sibling), false, "a successful sibling write may already be gone");
    assert.equal(store.has(revision), true);
    assert.equal(store.has(study), true, "keep the parent discoverable by its owner while any descendant remains");
    assert.ok(batches.every(batch => !batch.includes(study)));
    failRevision = false;
    assert.equal(await deleteAccountSyncMarks(env, 7), 2);
    assert.deepEqual([...store.keys()].sort(), [other, `${other}/revisions/r1`].sort());
  } finally { globalThis.fetch = originalFetch; }
});

test("recursive deletion reaches revisions below missing UID roots and parents, including paginated unknown collections", async () => {
  const { deleteAccountSyncMarks } = await load("missing-parents");
  const root = "projects/demo-cyberjudah/databases/(default)/documents";
  const owned = ["users", "staging_users"].flatMap(scope => [
    `${scope}/tg_7/notes/gone/revisions/r1`,
    `${scope}/tg_7/notes/gone/revisions/r2`,
    `${scope}/tg_7/studies/gone/revisions/r1`,
    `${scope}/tg_7/assistantConversations/gone/turns/t1`,
  ]);
  const untouched = ["users/tg_8/notes/gone/revisions/r1", "studies/unknown-owner/revisions/r1"];
  // Every intermediate parent, including users/tg_7 itself, is already absent.
  const store = new Set([...owned, ...untouched]);
  const batches = [], requests = [];
  let failRead = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(u.hostname, "127.0.0.1");
    if (u.pathname.endsWith(":batchWrite")) {
      const writes = JSON.parse(init.body).writes.map(w => w.delete);
      batches.push(writes);
      writes.forEach(name => store.delete(name.slice(root.length + 1)));
      return Response.json({ status: writes.map(() => ({})) });
    }
    // No existing top-level study retains an ownership field. Never guess ownership.
    if (u.pathname.endsWith(":runQuery")) return Response.json([]);
    const path = u.pathname.slice(u.pathname.indexOf("/documents/") + "/documents/".length);
    requests.push(path);
    if (path.endsWith(":listCollectionIds")) {
      const parent = path.slice(0, -":listCollectionIds".length);
      const ids = [...new Set([...store].filter(p => p.startsWith(`${parent}/`)).map(p => p.slice(parent.length + 1).split("/")[0]))];
      const offset = Number(JSON.parse(init.body).pageToken ?? 0);
      return Response.json({ collectionIds: ids.slice(offset, offset + 1), ...(offset + 1 < ids.length ? { nextPageToken: String(offset + 1) } : {}) });
    }
    if (path.split("/").length % 2 === 0) {
      return store.has(path) ? Response.json(doc(`${root}/${path}`, {})) : new Response("", { status: 404 });
    }
    if (failRead && path === "users/tg_7/notes/gone/revisions") return new Response("", { status: 503 });
    assert.equal(u.searchParams.get("showMissing"), "true", "recursive inventory must request missing parent placeholders");
    const children = [...new Set([...store].filter(p => p.startsWith(`${path}/`)).map(p => p.slice(path.length + 1).split("/")[0]))];
    const offset = Number(u.searchParams.get("pageToken") ?? 0);
    return Response.json({
      documents: children.slice(offset, offset + 1).map(id => store.has(`${path}/${id}`) ? doc(`${root}/${path}/${id}`, {}) : { name: `${root}/${path}/${id}` }),
      ...(offset + 1 < children.length ? { nextPageToken: String(offset + 1) } : {}),
    });
  };
  try {
    const env = { ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" };
    await assert.rejects(deleteAccountSyncMarks(env, 7), /read failed/i);
    assert.equal(batches.length, 0, "a failed orphan inventory must precede every write");
    assert.equal(store.size, owned.length + untouched.length);
    failRead = false;
    assert.equal(await deleteAccountSyncMarks(env, 7), owned.length);
    assert.deepEqual(batches.flat().sort(), owned.map(path => `${root}/${path}`).sort());
    assert.deepEqual([...store].sort(), untouched.sort(), "other accounts and unattributable top-level orphans are never guessed to belong to this login");
    assert.ok(requests.filter(path => path === "staging_users/tg_7:listCollectionIds").length > 1, "collection-id pagination is followed");
    assert.ok(requests.filter(path => path === "staging_users/tg_7/notes/gone/revisions").length > 1, "document pagination is followed");
  } finally { globalThis.fetch = originalFetch; }
});

test("orphan inventory is read-only, paginated and projects away study content without guessing ownership", async () => {
  const { inventoryOrphanedStudyParents } = await load("orphan-inventory");
  const root = "projects/demo-cyberjudah/databases/(default)/documents";
  const missing = { name: `${root}/studies/missing` };
  const stagingMissing = { name: `${root}/staging_studies/missing` };
  const { fetchFn, calls, batches } = firestoreFetch({ byPath: {
    studies: [{ documents: [doc(`${root}/studies/owned`, { title: "private content" })], next: true }, { documents: [missing] }],
    staging_studies: [{ documents: [stagingMissing] }],
  } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    await assert.rejects(inventoryOrphanedStudyParents({}), /unavailable/);
    assert.equal(calls.length, 0);
    assert.deepEqual(await inventoryOrphanedStudyParents({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }), {
      version: 1, orphanParents: [missing.name, stagingMissing.name], ownershipResolved: false,
    });
    assert.equal(batches.length, 0);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.url.searchParams.get("showMissing") === "true" && call.url.searchParams.get("mask.fieldPaths") === "user.id"));
  } finally { globalThis.fetch = originalFetch; }
});

test("read-only inventory can use an existing short-lived identity without copying a signing key", async () => {
  const { inventoryOrphanedStudyParents } = await load("inventory-existing-identity");
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.origin, "https://firestore.googleapis.com");
    assert.match(u.pathname, /^\/v1\/projects\/cyberjudah-app\/databases\/\(default\)\/documents\/(studies|staging_studies)$/);
    assert.equal(init.method ?? "GET", "GET");
    assert.equal(init.headers.authorization, "Bearer synthetic-existing-identity");
    assert.equal(u.searchParams.get("showMissing"), "true");
    reads++;
    return Response.json({ documents: [] });
  };
  try {
    assert.deepEqual(await inventoryOrphanedStudyParents({}, async () => "synthetic-existing-identity"), {
      version: 1, orphanParents: [], ownershipResolved: false,
    });
    assert.equal(reads, 2);
  } finally { globalThis.fetch = originalFetch; }
});

for (const ledgerFields of [
  { state: { stringValue: "ownership-unresolved" } },
  { version: { integerValue: "1" }, user: { mapValue: { fields: { id: { stringValue: "original-owner" } } } }, studyRoot: { stringValue: "studies" }, studyId: { stringValue: "reclaimed" } },
]) test("account cleanup refuses a recreated parent with unresolved or conflicting historical ownership before deleting anything", async () => {
  const { deleteFirebaseAccountSyncMarks } = await load("reclaimed-" + JSON.stringify(ledgerFields));
  const root = "projects/demo-cyberjudah/databases/(default)/documents";
  const oldFetch = globalThis.fetch;
  const batches = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url), path = decodeURIComponent(u.pathname.split("/documents/")[1] ?? "");
    if (u.pathname.endsWith(":batchWrite")) { batches.push(JSON.parse(init.body)); return Response.json({ status: [{}] }); }
    if (u.pathname.endsWith(":runQuery")) {
      const q = JSON.parse(init.body).structuredQuery;
      return Response.json(q.from[0].collectionId === "studies" ? [{ document: { name: root + "/studies/reclaimed", fields: { user: { mapValue: { fields: { id: { stringValue: "new-owner" } } } } } } }] : []);
    }
    if (path === "study_deletion_owners/studies:reclaimed") return Response.json({ name: root + "/" + path, fields: ledgerFields });
    if (path === "users/new-owner/notes") return Response.json({ documents: [{ name: root + "/users/new-owner/notes/own-note", createTime: "2026-11-05T00:00:00Z" }] });
    if (path.endsWith(":listCollectionIds")) return Response.json({ collectionIds: [] });
    return new Response("", { status: 404 });
  };
  try {
    await assert.rejects(deleteFirebaseAccountSyncMarks({ ...identityEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089" }, "new-owner"), /study_ownership_unresolved/);
    assert.equal(batches.length, 0, "even unrelated own notes wait until every historical ownership check passes");
  } finally { globalThis.fetch = oldFetch; }
});
