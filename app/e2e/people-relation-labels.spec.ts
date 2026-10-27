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

for (const theme of ["light", "dark"] as const) for (const [type, partner, sibling, child] of [["Male", "Husband", "Brother", "Son"], ["Female", "Wife", "Sister", "Daughter"], ["Other", "Partner", "Sibling", "Child"]] as const) {
  test(`family labels: ${type} targets determine partner, sibling and child labels (${theme})`, async ({ page }, testInfo) => {
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
    await page.emulateMedia({ colorScheme: theme });
    await page.route(/\/api\/people\/(root|father|mother|partner|sibling|child)\.json$/, r => r.fulfill({ json: records[new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5)] }));
    await page.goto("/person/root");
    const graph = page.locator(".fg");
    await expect(graph.getByRole("button", { name: `${partner}, partner`, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await graph.locator(".fg__sat").evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations({ subtree: true })).map(animation => animation.finished)));
    await page.screenshot({ path: testInfo.outputPath(`family-labels-${type.toLowerCase()}-${theme}.png`), fullPage: true });
    await expect(graph.locator(".fg__chip")).toHaveText(["Father", "Mother", partner, sibling, child]);
    for (const name of ["Father, father", "Mother, mother", `${partner}, partner`, `${sibling}, sibling`, `${child}, child`]) {
      await expect(graph.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await graph.getByRole("button", { name: "Father, father", exact: true }).click();
    await expect(graph.locator(".fg__label--center b")).toHaveText("father");
    await expect(graph.locator(".fg__sat .fg__chip")).toHaveText("Son");
    await graph.getByRole("button", { name: "Back to root", exact: true }).click();
    await expect(graph.locator(".fg__label--center b")).toHaveText("root");
    await expect(graph.locator(".fg__chip")).toHaveText(["Father", "Mother", partner, sibling, child]);
  });
}

for (const [type, label] of [["Male", "Son"], ["Female", "Daughter"], ["Other", "Child"]] as const) {
  for (const parent of ["father", "mother"] as const) {
    test(`family labels: ${type} child returning from ${parent} is ${label}`, async ({ page }) => {
      const make = (id: string, type: string, family = {}) => ({ id, name: id, names: [id], type, description: "", tribe: "", father: [], mother: [], siblings: [], partners: [], children: [], verses: [], taught: [], source: { name: "Label fixture", license: "", url: "" }, ...family });
      const records: Record<string, ReturnType<typeof make>> = {
        root: make("root", type, { [parent]: [{ id: parent, name: parent }] }),
        [parent]: make(parent, parent === "father" ? "Male" : "Female", { children: [{ id: "root", name: "root" }] }),
      };
      await setup(page, { people: Object.values(records) });
      await page.route(/\/api\/people\/(root|father|mother)\.json$/, r => r.fulfill({ json: records[new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5)] }));
      await page.goto("/person/root");
      const graph = page.locator(".fg");
      await expect(graph.locator(".fg__label--center b")).toHaveText("root");
      await graph.getByRole("button", { name: `${parent === "father" ? "Father" : "Mother"}, ${parent}`, exact: true }).click();
      await expect(graph.locator(".fg__label--center b")).toHaveText(parent);
      await expect(graph.locator(".fg__sat .fg__chip")).toHaveText(label);
      await graph.getByRole("button", { name: "Back to root", exact: true }).click();
      await expect(graph.locator(".fg__label--center b")).toHaveText("root");
    });
  }
}

test("family labels: a forefather the KJV names without the generations between, and back as a descendant", async ({ page }) => {
  const make = (id: string, family = {}) => ({ id, name: id, names: [id], type: "Male", description: "", tribe: "", father: [], mother: [], siblings: [], partners: [], children: [], verses: [], taught: [], source: { name: "Label fixture", license: "", url: "" }, ...family });
  const records: Record<string, ReturnType<typeof make>> = {
    root: make("root", { father: [{ id: "father", name: "father" }], line: [{ id: "forefather", name: "forefather", verses: ["1-maccabees/2/1"] }] }),
    father: make("father", { children: [{ id: "root", name: "root" }] }),
    forefather: make("forefather", { descendants: [{ id: "root", name: "root", verses: ["1-maccabees/2/1"] }, { id: "other", name: "other", verses: ["1-maccabees/14/29"] }] }),
    other: make("other", { line: [{ id: "forefather", name: "forefather", verses: ["1-maccabees/14/29"] }] }),
  };
  await setup(page, { people: Object.values(records) });
  await page.route(/\/api\/people\/(root|father|forefather)\.json$/, r => r.fulfill({ json: records[new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5)] }));
  await page.goto("/person/root");
  const graph = page.locator(".fg");
  await expect(graph.locator(".fg__chip")).toHaveText(["Father", "Forefather"]);
  await graph.getByRole("button", { name: "Forefather, forefather", exact: true }).click();
  await expect(graph.locator(".fg__label--center b")).toHaveText("forefather");
  await expect(graph.locator(".fg__sat .fg__chip")).toHaveText(["Descendant", "Descendant"]);
  await expect(graph.getByRole("button", { name: "Descendant, other", exact: true })).toBeVisible();
});

test("evidenced People links keep priestly courses and uncertain identity outside the family graph", async ({ page }, testInfo) => {
  const make = (id: string, extra = {}) => ({ id, name: id, names: [id], type: "Male", description: "", tribe: "", father: [], mother: [], siblings: [], partners: [], children: [], verses: [], taught: [], source: { name: "Evidence fixture", license: "", url: "" }, ...extra });
  const records: Record<string, ReturnType<typeof make>> = {
    mattathias: make("mattathias", { father: [{ id: "john", name: "John" }], priestly: [{ id: "joarib", name: "Joarib", evidenceLabel: "Scripturally confirmed", verses: ["1-maccabees/2/1"] }] }),
    joarib: make("joarib", { same: [{ id: "jehoiarib", name: "Jehoiarib", evidenceLabel: "Parallel identification", verses: ["1-chronicles/24/7"] }], course: [{ id: "mattathias", name: "Mattathias", evidenceLabel: "Scripturally confirmed" }] }),
    jehoiarib: make("jehoiarib", { alsoNamed: [{ id: "joarib", name: "Joarib", evidenceLabel: "Identity uncertain", note: "Keep this qualification.", sources: [{ id: "FIXTURE", locator: "1.2" }] }], titles: [{ title: "Priest", evidenceLabel: "Scripturally confirmed" }], variants: [{ reading: "Alternate reading", note: "A textual variant." }] }),
  };
  await setup(page, { people: Object.values(records) });
  await page.route(/\/api\/people\/(mattathias|joarib|jehoiarib)\.json$/, r => r.fulfill({ json: records[new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5)] }));
  await page.goto("/person/mattathias");
  await expect(page.locator(".fg__chip")).toHaveText(["Father"]);
  const course = page.getByRole("region", { name: "Priestly course", exact: true });
  await expect(course).toContainText("Scripturally confirmed");
  await expect(course.getByRole("link", { name: "1 Maccabees 2:1" })).toHaveAttribute("href", /\/read\/1-maccabees\/2\?v=1$/);
  await course.getByRole("link", { name: "Joarib", exact: true }).click();
  await page.getByRole("region", { name: "Identity links", exact: true }).getByRole("link", { name: "Jehoiarib", exact: true }).click();
  await expect(page.getByRole("region", { name: "Other entries linked to this person" })).toContainText("Identity uncertain");
  await expect(page.getByRole("region", { name: "Other entries linked to this person" })).toContainText("FIXTURE, 1.2");
  await expect(page.getByRole("region", { name: "Titles", exact: true })).toContainText("Priest");
  await expect(page.getByRole("region", { name: "Textual variants", exact: true })).toContainText("Alternate reading");
  await expect(page.getByRole("heading", { name: "jehoiarib", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "mattathias", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("people-evidence-phone.png"), fullPage: true });
});
