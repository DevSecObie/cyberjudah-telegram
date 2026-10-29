import { expect, test, type Page } from "@playwright/test";

// Bible Strong's Places: the places a chapter names come after its people in "In This Chapter",
// with the place picture, and each opens its page (Bible Strong's StrongEntityPage for a place).
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const verses = Array.from({ length: 25 }, (_, i) => ({ verse: i + 1, text: i === 7 ? "And the LORD God planted a garden eastward in Eden; and there he put the man whom he had formed." : `Verse ${i + 1} of the chapter.` }));
const PLACES = [
  { id: "eden-gen-2-8", name: "Eden", names: ["Eden"], region: "", verses: 13, first: "genesis/2/8" },
  { id: "euphrates-gen-2-14", name: "Euphrates", names: ["Euphrates"], region: "", verses: 61, first: "genesis/2/14" },
  { id: "cush-gen-2-13", name: "Ethiopia", names: ["Ethiopia", "Cush"], region: "", verses: 44, first: "genesis/2/13" },
];
const EDEN = { id: "eden-gen-2-8", name: "Eden", names: ["Eden"], description: "The garden the LORD God planted eastward (Genesis 2:8)", region: "", coords: null, strongs: [], verses: ["genesis/2/8", "genesis/2/10", "genesis/2/15"], source: { name: "The King James Bible with Apocrypha", license: "Public domain", url: "https://cyberjudah.io/bible" } };
const EUPHRATES = { id: "euphrates-gen-2-14", name: "Euphrates", names: ["Euphrates"], description: "The fourth river out of Eden (Genesis 2:14)", region: "", coords: [31, 46.2], pin: { lat: 31, lon: 46.2, wikidata: "Q34589", url: "https://www.wikidata.org/wiki/Q34589", label: "Euphrates" }, strongs: [], verses: ["genesis/2/14"], source: EDEN.source };

async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { if (!localStorage.getItem("cj:bs")) localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress" })); });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 50, verses: 1533, chapterIds: [2] }] });
    if (path === "/api/kjv/genesis/2.json") return r.fulfill({ json: { book: "genesis", chapter: 2, translation: "KJV", verses } });
    if (path === "/api/concordance/genesis/2.json") return r.fulfill({ json: { book: "Genesis", chapter: 2, cited_by: [], people: { "19": ["adam-gen-2-19"], "20": ["adam-gen-2-19"] }, places: { "8": ["eden-gen-2-8"], "10": ["eden-gen-2-8"], "13": ["cush-gen-2-13"], "14": ["euphrates-gen-2-14"] } } });
    if (path === "/api/people/index.json") return r.fulfill({ json: [{ id: "adam-gen-2-19", name: "Adam", names: ["Adam"], description: "First man", verses: 30, first: "genesis/2/19", type: "Male" }] });
    if (path === "/api/places/index.json") return r.fulfill({ json: PLACES });
    if (path === "/api/places/eden-gen-2-8.json") return r.fulfill({ json: EDEN });
    if (path === "/api/places/euphrates-gen-2-14.json") return r.fulfill({ json: EUPHRATES });
    if (path === "/api/kjv/genesis/2.json") return r.fulfill({ json: { book: "genesis", chapter: 2, verses } });
    return r.fulfill({ status: 404, body: "" });
  });
}

test("In This Chapter holds the people and then the places, each place with the place picture", async ({ page }) => {
  await setup(page);
  await page.goto("/read/genesis/2");
  const stack = page.locator(".bs-entities__stack");
  await stack.scrollIntoViewIfNeeded();
  await expect(stack).toHaveAttribute("aria-label", "In this chapter: Adam, Eden, Ethiopia, Euphrates");
  await stack.click();
  const dialog = page.getByRole("dialog", { name: "In this chapter" });
  await expect(dialog.locator(".bs-people__text b")).toHaveText(["Adam", "Eden", "Ethiopia", "Euphrates"]);
  await expect(dialog.locator(".bs-people__text small")).toHaveText(["Man · 2 verses", "Place · 2 verses", "Place · 1 verse", "Place · 1 verse"]);
  await expect(dialog.locator(".bs-people__item", { hasText: "Eden" }).locator("img")).toHaveAttribute("src", /\/bs\/entity-avatars\/place\.png$/);
  await dialog.getByRole("button", { name: "Open Eden" }).click();
  await expect(page).toHaveURL(/\/place\/eden-gen-2-8$/);
});

test("a place's page: Place, its name and what the KJV says of it, then its verses; no map pin without an exact match", async ({ page }) => {
  await setup(page);
  await page.goto("/place/eden-gen-2-8");
  await expect(page.locator(".entity__eyebrow").first()).toHaveText("Place");
  await expect(page.getByRole("heading", { level: 1, name: "Eden" })).toBeVisible();
  await expect(page.locator(".entity__desc")).toHaveText("The garden the LORD God planted eastward (Genesis 2:8).");
  await expect(page.getByRole("region", { name: "Where it is" })).toHaveCount(0);
  const list = page.getByRole("region", { name: "Verses" });
  await expect(list.locator(".entity__note")).toHaveText("First named in Genesis 2:8");
  await expect(list.locator(".scard__ref")).toHaveText(["Genesis 2:8", "Genesis 2:10", "Genesis 2:15"]);
  await expect(list.locator(".scard").first().locator(".scard__text")).toContainText("planted a garden eastward in Eden");
  await expect(page.locator(".entity__source")).toHaveText("Names and verses from the King James Bible with Apocrypha.");
  await expect(page.locator("body")).not.toContainText(/STEPBible|TIPNR/);
});

test("a place Wikidata has exactly shows where it is, with its Wikidata link", async ({ page }) => {
  await setup(page);
  await page.goto("/place/euphrates-gen-2-14");
  const where = page.getByRole("region", { name: "Where it is" });
  await expect(where).toContainText("31.00° N, 46.20° E");
  await expect(where.getByRole("button", { name: "Euphrates on Wikidata" })).toBeVisible();
  await expect(page.locator(".entity__source")).toContainText("Location from Wikidata");
});

test("a place that does not load says so and offers to try again", async ({ page }) => {
  await setup(page);
  await page.goto("/place/nowhere-gen-1-1");
  await expect(page.getByText("This place did not load")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
