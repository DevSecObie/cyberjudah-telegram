import { expect, test } from "@playwright/test";

test("icons: the manifest supplies local decodable sizes, safe masks and a single-ink variant", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(new Set(manifest.icons.map((icon: { purpose: string }) => icon.purpose))).toEqual(new Set(["any", "maskable", "monochrome"]));
  await page.goto("/");
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, response.url());
    expect(url.origin).toBe(new URL(response.url()).origin);
    const image = await request.get(url.href);
    expect(image.ok(), url.href).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
    const pixels = await page.evaluate(async ({ url, purpose }) => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height), width = image.width;
      let outside = 0, inks = new Set<string>(), opaque = 0, transparent = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, alpha = data[i + 3];
        if (alpha === 255) opaque++; else if (alpha === 0) transparent++;
        if (purpose === "monochrome" && alpha > 0) inks.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        if (purpose === "maskable" && Math.hypot(x + .5 - width / 2, y + .5 - image.height / 2) > width * .4 && [0, 1, 2].some(c => Math.abs(data[i + c] - data[c]) > 6)) outside++;
      }
      return { width, height: image.height, outside, inks: [...inks], opaque, transparent, total: width * image.height };
    }, { url: url.href, purpose: icon.purpose });
    expect(`${pixels.width}x${pixels.height}`).toBe(icon.sizes);
    if (icon.purpose === "monochrome") {
      expect(pixels.inks).toEqual(["0,0,0"]);
      expect(pixels.opaque).toBeGreaterThan(pixels.total * .05);
      expect(pixels.transparent).toBeGreaterThan(pixels.total * .5);
    } else expect(pixels.opaque).toBe(pixels.total);
    if (icon.purpose === "maskable") expect(pixels.outside, "All artwork stays inside the 80% diameter safe circle").toBe(0);
  }
});

test("icons: light/dark favicons and the full-bleed Apple touch icon load at their declared sizes", async ({ page }) => {
  await page.goto("/");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const icon = await page.evaluate(async () => {
      const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
      const selected = links.filter(link => !link.media || matchMedia(link.media).matches).at(-1)!;
      const image = new Image(); image.src = selected.href; await image.decode();
      return { href: selected.href, width: image.width, height: image.height, sizes: selected.sizes.value };
    });
    expect(icon.href).toContain(`/icons/${scheme}-32.png`);
    expect(`${icon.width}x${icon.height}`).toBe(icon.sizes);
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').evaluate(async (link: HTMLLinkElement) => {
    const image = new Image(); image.src = link.href; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    return { size: `${image.width}x${image.height}`, declared: link.sizes.value, corners: [[0, 0], [179, 0], [0, 179], [179, 179]].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]) };
  });
  expect(touch.size).toBe(touch.declared); expect(touch.corners).toEqual([255, 255, 255, 255]);
});
