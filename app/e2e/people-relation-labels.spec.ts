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

for (const [type, partner, sibling] of [["Male", "Husband", "Brother"], ["Female", "Wife", "Sister"], ["Other", "Partner", "Sibling"]] as const) {
  test(`family labels: known ${type} targets specialize only partner and sibling`, async ({ page }) => {
    const ref = (id: string) => ({ id, name: id });
    const make = (id: string, gender: string, family = {}) => ({ id, name: id, names: [id], type: gender, description: "", tribe: "", father: [], mother: [], siblings: [], partners: [], children: [], verses: [], taught: [], source: { name: "Label fixture", license: "", url: "" }, ...family });
    const records: Record<string, ReturnType<typeof make>> = {
      root: make("root", "Male", { father: [ref("father")], mother: [ref("mother")], partners: [ref("partner")], siblings: [ref("sibling")], children: [ref("child")] }),
      father: make("father", "Male", { children: [ref("root")] }),
      mother: make("mother", "Female", { children: [ref("root")] }),
      partner: make("partner", type, { partners: [ref("root")] }),
      sibling: make("sibling", type, { siblings: [ref("root")] }),
      child: make("child", type, { father: [ref("root")] }),
    };
    await setup(page, { people: Object.values(records) });
    await page.route(/\/api\/people\/(root|father|mother|partner|sibling|child)\.json$/, r => r.fulfill({ json: records[new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5)] }));
    await page.goto("/person/root");
    const graph = page.locator(".fg");
    await expect(graph.locator(".fg__chip")).toHaveText(["Father", "Mother", partner, sibling, "Offspring"]);
    for (const name of ["Father, father", "Mother, mother", `${partner}, partner`, `${sibling}, sibling`, "Offspring, child"]) {
      await expect(graph.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await graph.getByRole("button", { name: "Father, father", exact: true }).click();
    await expect(graph.locator(".fg__label--center b")).toHaveText("father");
    await expect(graph.locator(".fg__sat .fg__chip")).toHaveText("Offspring");
    await graph.getByRole("button", { name: "Back to root", exact: true }).click();
    await expect(graph.locator(".fg__label--center b")).toHaveText("root");
    await expect(graph.locator(".fg__chip")).toHaveText(["Father", "Mother", partner, sibling, "Offspring"]);
  });
}
