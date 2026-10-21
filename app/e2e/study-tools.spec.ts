import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

async function setup(page: Page) {
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(`${process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io"}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 1, verses: 2, testament: "Old Testament", url: "/bible/genesis", chapterIds: [1] }] });
    if (path === "/api/kjv/genesis/1.json") return r.fulfill({ json: { book: "Genesis", chapter: 1, translation: "KJV", verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }, { verse: 2, text: "And the earth was without form, and void." }] } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.addInitScript(() => localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress" })));
}
test("personal study opens to read, writes after the pencil, renames from its title and exports its actual draft", async ({ page }) => {
  await setup(page); await page.goto("/studies");
  await page.getByRole("button", { name: "New study", exact: true }).click();
  // Bible Strong's EditStudyScreen: read-only first, the pencil to write, the check to finish.
  await expect(page.getByRole("textbox", { name: "Writing 1", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit study", exact: true }).click();
  await page.getByRole("textbox", { name: "Writing 1", exact: true }).fill("**In the beginning**\n\n<script>window.__injected = true</script>\n\n[bad](javascript:alert(1))");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Untitled study", exact: true }).click();
  await page.getByLabel("Study title", { exact: true }).fill("Creation study");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();
  const url = page.url(); await page.reload();
  await expect(page.getByRole("heading", { name: "Creation study" })).toBeVisible();
  await expect(page.locator(".study-prose strong")).toHaveText("In the beginning");
  await expect(page.locator('.study-prose script, .study-prose [href^="javascript:"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Study options", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export study", exact: true }).click();
  const file = await download; const saved = JSON.parse(await fs.readFile((await file.path())!, "utf8"));
  expect(saved.title).toBe("Creation study"); expect(saved.blocks[0].text).toContain("**In the beginning**"); expect(url).toContain(saved.id);
});
test("the formatting bar writes the study's Markdown on the line or selection being written", async ({ page }) => {
  await setup(page); await page.goto("/studies");
  await page.getByRole("button", { name: "New study", exact: true }).click();
  await page.getByRole("button", { name: "Edit study", exact: true }).click();
  const writing = page.getByRole("textbox", { name: "Writing 1", exact: true });
  await writing.fill("Light");
  await writing.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(0, 5); });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(writing).toHaveValue("**Light**");
  await page.getByRole("button", { name: /^Normal/ }).click();
  await page.getByRole("menuitem", { name: "Title", exact: true }).click();
  await expect(writing).toHaveValue("# **Light**");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Bulleted list", exact: true }).click();
  await expect(writing).toHaveValue("- **Light**");
  // A heading takes the place of a list marker, not beside it.
  await page.getByRole("button", { name: /^Normal/ }).click();
  await page.getByRole("menuitem", { name: "Subtitle", exact: true }).click();
  await expect(writing).toHaveValue("## **Light**");
  // The toolbar gives back the selection a frame later; filling before that would write into it.
  await expect.poll(() => writing.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(5);
  // A quote or a list marks every selected line, and Undo takes a toolbar change back.
  await writing.fill("Light\nDarkness");
  await writing.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(0, el.value.length); });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Quote", exact: true }).click();
  await expect(writing).toHaveValue("> Light\n> Darkness");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(writing).toHaveValue("Light\nDarkness");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add writing", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Writing 2", exact: true })).toBeVisible();
});
test("competing study edits report a conflict without overwriting either draft", async ({ page, context }) => {
  await setup(page); await page.goto("/studies"); await page.getByRole("button", { name: "New study", exact: true }).click();
  await page.getByRole("button", { name: "Edit study", exact: true }).click();
  const other = await context.newPage(); await setup(other); await other.goto(page.url());
  await other.getByRole("button", { name: "Edit study", exact: true }).click();
  await page.getByRole("textbox", { name: "Writing 1", exact: true }).fill("First window"); await expect(page.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();
  await other.getByRole("textbox", { name: "Writing 1", exact: true }).fill("Second window");
  await expect(other.getByRole("alert")).toContainText("changed in another window");
  await expect(other.getByRole("textbox", { name: "Writing 1", exact: true })).toHaveValue("Second window");
  await page.reload(); await expect(page.locator(".study-prose")).toHaveText("First window"); await other.close();
});
test("reader keeps Link and Relation, adds Scripture to studies and preserves existing word marks", async ({ page }) => {
  await setup(page); await page.goto("/read/genesis/1"); await page.locator("#verset-1 .bs-text").click();
  const selected = page.getByRole("dialog", { name: "Selected: Genesis 1:1", exact: true }); await expect(selected).toBeVisible();
  await expect(selected.getByRole("button", { name: "Link", exact: true })).toBeVisible(); await expect(selected.getByRole("button", { name: "Relation", exact: true })).toBeVisible();
  await expect(selected.getByRole("button", { name: "Mark phrase", exact: true })).toHaveCount(0);
  // Removing the custom form must not remove a reader's marks from the old data model.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("cyberjudah-personal-study", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("annotations", "readwrite");
      tx.objectStore("annotations").put({ id: "fe47a55e-15f4-42db-8a95-809b314b3c11", verseKey: "genesis-1-1", start: 7, end: 20, quote: "beginning God", style: "underline", created: "2026-10-08T18:00:00.000Z" });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await selected.getByRole("tab", { name: "Annotate", exact: true }).click(); await selected.getByRole("button", { name: "To study", exact: true }).click();
  await page.getByRole("dialog", { name: "Add to study", exact: true }).getByRole("button", { name: "New study", exact: true }).click();
  await expect(page.locator(".study-block blockquote")).toContainText("In the beginning God created");
  await page.goto("/read/genesis/1"); await expect(page.locator("#verset-1 .phrase-underline")).toHaveText("beginning God");
});
test("browser backup includes locally saved reader notes", async ({ page }) => {
  await setup(page); await page.goto("/settings");
  await page.evaluate(() => localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1": { id: "note1", title: "Creation", description: "Keep this note", date: 1 } })));
  const download = page.waitForEvent("download"); await page.getByText("Download a backup", { exact: true }).click();
  const file = await download; const backup = JSON.parse(await fs.readFile((await file.path())!, "utf8")); expect(backup.keys.bs_n_genesis_1).toContain("Keep this note");
});

test("a single-book plan starts only after choosing its start action", async ({ page }) => {
  await setup(page); await page.goto("/plans");
  await page.getByRole("combobox", { name: "Choose a book", exact: true }).selectOption("genesis");
  await expect(page).toHaveURL(/\/plans$/);
  await page.getByRole("button", { name: "Start this book", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("link", { name: "Genesis · Change plan", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Genesis 1", exact: true })).toBeVisible();
});
