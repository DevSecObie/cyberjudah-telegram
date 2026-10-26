import { expect, test, type Page } from "@playwright/test";

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
async function setup(page: Page, { people }: { people: unknown[] }) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/people/index.json" ? r.fulfill({ json: people }) : r.fulfill({ status: 404, body: "" }));
}

for (const theme of ["light", "dark"] as const) {
  test(`family: returning to the original root clears history and restores root paging (${theme})`, async ({ page }) => {
    const make = (id: string, family = {}) => ({ id, name: id, names: [id], type: "Male", description: "", tribe: "", father: [], mother: [], siblings: [], partners: [], children: [], verses: [], taught: [], source: { name: "Navigation fixture", license: "", url: "" }, ...family });
    const ref = (id: string) => ({ id, name: id });
    const records: Record<string, ReturnType<typeof make>> = {
      root: make("root", { partners: [ref("one")], children: [ref("two"), ...Array.from({ length: 6 }, (_, i) => ref(`child${i}`))] }),
      one: make("one", { partners: [ref("root")], children: [ref("two")] }),
      two: make("two", { father: [ref("root")], mother: [ref("one")] }),
    };
    await setup(page, { people: Object.values(records) });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.route(/\/api\/people\/(root|one|two)\.json$/, r => r.fulfill({ json: records[new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5)] }));
    await page.goto("/person/root");
    const graph = page.locator(".fg");
    const center = graph.locator(".fg__label--center b");
    const pick = (id: string) => graph.locator(".fg__sat").filter({ has: page.locator("b", { hasText: new RegExp(`^${id}$`) }) }).getByRole("button");
    await expect(center).toHaveText("root");
    const initial = await graph.locator(".fg__sat b").allTextContents();
    expect(initial).toHaveLength(6);
    await expect(graph.locator(".fg__foot")).toHaveAttribute("aria-label", "Page 1 of 2");
    for (const id of ["one", "two", "root"]) {
      await pick(id).click();
      await expect(center).toHaveText(id);
    }
    await expect(graph.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
    await expect(graph.getByRole("button", { name: "Start again from root", exact: true })).toHaveCount(0);
    await expect(graph.locator(".fg__line--back")).toHaveCount(0);
    await expect(graph.locator(".fg__sat b")).toHaveText(initial);
    await expect(graph.locator(".fg__foot")).toHaveAttribute("aria-label", "Page 1 of 2");
    await graph.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(graph.locator(".fg__sat b")).toHaveCount(2);
    await expect(graph.locator(".fg__foot")).toHaveAttribute("aria-label", "Page 2 of 2");
    await graph.getByRole("button", { name: "Previous page", exact: true }).click();
    await pick("one").click();
    await expect(center).toHaveText("one");
    await graph.getByRole("button", { name: "Back", exact: true }).click();
    await expect(center).toHaveText("root");
    await expect(graph.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
    await expect(graph.locator(".fg__sat b")).toHaveText(initial);
  });
}
