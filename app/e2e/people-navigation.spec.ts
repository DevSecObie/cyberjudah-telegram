import { expect, test, type Page, type Route } from "@playwright/test";
import type { Person } from "../src/api/data";

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const ref = (id: string) => ({ id, name: id });
const person = (id: string, family: Partial<Person> = {}): Person => ({
  id, name: id, names: [id], description: "", type: "Male", tribe: "",
  father: [], mother: [], partners: [], siblings: [], children: [], verses: [], taught: [],
  source: { name: "Navigation fixture", license: "", url: "" }, ...family,
});
const PEOPLE: Record<string, Person> = {
  root: person("root", { father: [ref("father")], partners: [ref("partner")], children: [...Array.from({ length: 6 }, (_, i) => ref(`child${i}`)), ref("nested")] }),
  father: person("father", { children: [ref("root")] }),
  partner: person("partner", { partners: [ref("root")] }),
  nested: person("nested", { father: [ref("root")], partners: [ref("target")] }),
  target: person("target", { partners: [ref("nested")] }),
};

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/people/index.json") return r.fulfill({ json: Object.values(PEOPLE) });
    if (path === "/api/kjv/index.json") return r.fulfill({ json: [] });
    const match = path.match(/^\/api\/people\/([^/]+)\.json$/);
    if (match && PEOPLE[match[1]]) return r.fulfill({ json: PEOPLE[match[1]] });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto("/person/root");
  await expect(center(page)).toHaveText("root");
}
const center = (page: Page) => page.locator(".fg__label--center > b");
const relation = (page: Page, id: string) => page.locator(".fg__sat").filter({ has: page.locator("b", { hasText: new RegExp(`^${id}$`) }) }).getByRole("button");
const footer = (page: Page) => page.locator(".fg__foot");

async function hold(page: Page, id: string) {
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { arrived = resolve; });
  const handler = async (route: Route) => { arrived(); await gate; await route.fulfill({ json: PEOPLE[id] }); };
  await page.route(`${DATA}/api/people/${id}.json`, handler);
  return {
    requested,
    release: async () => {
      const response = page.waitForResponse(`${DATA}/api/people/${id}.json`);
      release();
      await (await response).finished();
      await page.waitForLoadState("networkidle");
    },
  };
}

async function nested(page: Page) {
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await relation(page, "nested").click();
  await expect(center(page)).toHaveText("nested");
}

for (const action of ["Back", "Reset", "Page", "New relation", "Cached relation"] as const) {
  test(`family: ${action} supersedes a held relation response`, async ({ page }) => {
    await setup(page);
    if (action === "Back" || action === "Reset") await nested(page);
    if (action === "Cached relation") {
      await relation(page, "father").click();
      await expect(center(page)).toHaveText("father");
      await footer(page).getByRole("button", { name: "Back", exact: true }).click();
      await expect(center(page)).toHaveText("root");
    }
    const pending = await hold(page, action === "Back" || action === "Reset" ? "target" : "partner");
    await relation(page, action === "Back" || action === "Reset" ? "target" : "partner").click();
    await pending.requested;
    if (action === "Back") await footer(page).getByRole("button", { name: "Back", exact: true }).click();
    else if (action === "Reset") await page.getByRole("button", { name: "Start again from root", exact: true }).click();
    else if (action === "Page") await page.getByRole("button", { name: "Next page", exact: true }).click();
    else await relation(page, "father").click();
    const expected = action === "New relation" || action === "Cached relation" ? "father" : "root";
    await expect(center(page)).toHaveText(expected);
    // Upstream getResetSteps restores the root's departure page as well as intermediate pages.
    const expectedPage = action === "Back" || action === "Page" || action === "Reset" ? "Page 2 of 2" : "Page 1 of 1";
    await expect(footer(page)).toHaveAttribute("aria-label", expectedPage);
    await pending.release();
    await expect(center(page)).toHaveText(expected);
    await expect(footer(page)).toHaveAttribute("aria-label", expectedPage);
    await expect(page.locator('.fg [aria-busy="true"]')).toHaveCount(0);
  });
}

test("family: a failed relation leaves the current person and page unchanged", async ({ page }) => {
  await setup(page);
  await page.route(`${DATA}/api/people/partner.json`, r => r.fulfill({ status: 503, body: "" }));
  await relation(page, "partner").click();
  await expect(page.locator('.fg [aria-busy="true"]')).toHaveCount(0);
  await expect(center(page)).toHaveText("root");
  await expect(footer(page)).toHaveAttribute("aria-label", "Page 1 of 2");
  await expect(footer(page).getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
});

test("family: an older completion does not clear the latest request's loading state", async ({ page }) => {
  await setup(page);
  const old = await hold(page, "partner");
  const latest = await hold(page, "father");
  await relation(page, "partner").click();
  await old.requested;
  await relation(page, "father").click();
  await latest.requested;
  // The latest request is intentionally still pending; do not wait for network idle here.
  const response = page.waitForResponse(`${DATA}/api/people/partner.json`);
  const released = old.release();
  await (await response).finished();
  await expect(relation(page, "partner")).not.toHaveAttribute("aria-busy", "true");
  await expect(relation(page, "father")).toHaveAttribute("aria-busy", "true");
  await expect(center(page)).toHaveText("root");
  await latest.release();
  await released;
  await expect(center(page)).toHaveText("father");
});

test("family: opening the active profile invalidates a pending relation", async ({ page }) => {
  await setup(page);
  await nested(page);
  const pending = await hold(page, "target");
  await relation(page, "target").click();
  await pending.requested;
  await page.locator(".fg__center .fg__node").click();
  await expect(page).toHaveURL(/\/person\/nested$/);
  const profile = page.getByRole("dialog");
  await expect(profile.locator(".fg__label--center > b")).toHaveText("nested");
  await pending.release();
  await expect(profile.locator(".fg__label--center > b")).toHaveText("nested");
  await expect(profile.locator(".fg__foot").getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
});
