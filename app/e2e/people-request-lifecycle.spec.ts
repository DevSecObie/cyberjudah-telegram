import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test.use({ bypassCSP: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

declare global {
  interface Window {
    __peopleLifecycle: {
      suspended: number;
      commits: string[];
      switchRoot: (id: string, suspend?: boolean) => void;
    };
  }
}

let bundle: string;
test.beforeAll(async () => {
  const output = await build({
    stdin: { loader: "tsx", resolveDir: fileURLToPath(new URL("..", import.meta.url)), contents: `
      import { Suspense, startTransition, useLayoutEffect, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
      import { FamilyGraph } from "./src/screens/FamilyGraph";
      const person = id => ({ id, name: id, names: [id], description: "", type: "Male", tribe: "",
        father: [], mother: [], partners: [], siblings: [], children: [{ id: "child", name: "child" }],
        verses: [], taught: [], source: { name: "Lifecycle fixture", license: "", url: "" } });
      const pending = new Promise(() => {});
      const lifecycle = window.__peopleLifecycle = { suspended: 0, commits: [], switchRoot: () => {} };
      function Commit({ id, suspend }) {
        useLayoutEffect(() => { lifecycle.commits.push(id); }, [id]);
        if (suspend) { lifecycle.suspended++; throw pending; }
        return null;
      }
      function Harness() {
        const [root, setRoot] = useState({ id: "root", suspend: false });
        lifecycle.switchRoot = (id, suspend = false) => {
          const change = () => setRoot({ id, suspend });
          if (suspend) startTransition(change); else flushSync(change);
        };
        return <Suspense fallback={<p>Suspended root</p>}>
          <FamilyGraph person={person(root.id)} onOpenProfile={() => {}} />
          <Commit id={root.id} suspend={root.suspend} />
        </Suspense>;
      }
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>
      );
    ` },
    bundle: true, write: false, format: "iife", platform: "browser",
    tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    plugins: [{ name: "people-transport", setup(b) {
      b.onResolve({ filter: /^@\/api\/data$/ }, () => ({ path: "data", namespace: "people-transport" }));
      b.onLoad({ filter: /.*/, namespace: "people-transport" }, () => ({ contents: `
        export const data = { people: async () => [], person: async id =>
          (await fetch("/__people_request__/" + id)).json() };
      ` }));
    } }],
  });
  bundle = output.outputFiles[0].text;
});

const center = (page: Page) => page.locator(".fg__static-center b, .fg__layer[data-current] .fg__label--center b");

async function setup(page: Page) {
  await page.route("**/__people_lifecycle__", r => r.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("/__people_lifecycle__");
  await page.addStyleTag({ content: await readFile(new URL("../src/styles/screens/people.css", import.meta.url), "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(center(page)).toHaveText("root");
  let requested!: () => void, release!: () => void;
  const arrived = new Promise<void>(resolve => { requested = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/__people_request__/child", async r => {
    requested(); await held;
    await r.fulfill({ json: { id: "child", name: "child", type: "Male", father: [], mother: [], partners: [], siblings: [], children: [] } });
  });
  await page.getByRole("button", { name: "Offspring, child", exact: true }).click();
  await arrived;
  await expect(page.getByRole("button", { name: "Offspring, child", exact: true })).toHaveAttribute("aria-busy", "true");
  return async () => {
    const response = page.waitForResponse("**/__people_request__/child");
    release();
    await (await response).finished();
    await page.waitForLoadState("networkidle");
  };
}

test("family: abandoning a suspended root render preserves the committed root's pending request", async ({ page }) => {
  const release = await setup(page);
  await page.evaluate(() => window.__peopleLifecycle.switchRoot("other", true));
  await expect.poll(() => page.evaluate(() => window.__peopleLifecycle.suspended)).toBeGreaterThan(0);
  await expect(center(page)).toHaveText("root");
  expect(await page.evaluate(() => window.__peopleLifecycle.commits)).toEqual(["root"]);
  await page.evaluate(() => window.__peopleLifecycle.switchRoot("root"));
  await release();
  await expect(center(page)).toHaveText("child");
  await expect(page.locator(".fg__node[aria-busy=true]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__peopleLifecycle.commits)).toEqual(["root"]);
});

test("family: committing a new root invalidates the previous root's pending request", async ({ page }) => {
  const release = await setup(page);
  await page.evaluate(() => window.__peopleLifecycle.switchRoot("other"));
  await expect(center(page)).toHaveText("other");
  await expect(page.locator(".fg__node[aria-busy=true]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__peopleLifecycle.commits)).toEqual(["root", "other"]);
  await release();
  await expect(center(page)).toHaveText("other");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
});
