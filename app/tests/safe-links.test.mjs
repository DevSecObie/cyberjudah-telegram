import assert from "node:assert/strict";
import test from "node:test";
import { safeImages, safeLinks } from "../src/lib/safe-links.ts";

test("an answer's links stay links only when they lead inside the app", () => {
  assert.equal(safeLinks('<a href="/settings/reminders">Reading reminders</a>'), '<a class="applink" href="/settings/reminders">Reading reminders</a>');
  assert.equal(safeLinks('<a href="/ask?chat=abc12345&amp;x=1">chat</a>'), '<a class="applink" href="/ask?chat=abc12345&amp;x=1">chat</a>');
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "https://evil.example/x", "//evil.example/x", "/\\evil.example", "data:text/html,x", "mailto:a@b.c", "/x?u=https://evil.example"]) {
    assert.equal(safeLinks(`<a href="${href}" title="t">click</a>`), "click", href);
  }
});

test("an answer shows only the app's own pictures", () => {
  const at = (p) => `/app${p}`;
  assert.equal(safeImages('<p><img src="/people/abraham-gen-11-26-256.webp" alt="Abraham"></p>', at), '<p><img class="msg__pic" src="/app/people/abraham-gen-11-26-256.webp" alt="Abraham" loading="lazy" decoding="async"></p>');
  assert.equal(safeImages('<img src="/timeline/leaders/bishop-kani-256.webp" alt="">', at), '<img class="msg__pic" src="/app/timeline/leaders/bishop-kani-256.webp" alt="" loading="lazy" decoding="async">');
  for (const src of ["https://evil.example/x.png", "//evil.example/x.webp", "/people/../secret.webp", "javascript:alert(1)", "/people/x.svg", "data:image/png;base64,AAAA", "/api/ask"]) {
    assert.equal(safeImages(`<img src="${src}" alt="x" onerror="alert(1)">`, at), "", src);
  }
});
