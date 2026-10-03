/** Runs in the page: canvas resolves browser color syntax and composites real alpha values. */
export function auditContrast() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const sample = (...colors: string[]) => {
    ctx.clearRect(0, 0, 1, 1);
    for (const color of colors) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); }
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const failures: { context: string; foreground: string; background: string; ratio: number; required: number }[] = [];
  let pairs = 0;
  const check = (context: string, foreground: string, backgrounds: string[], required = 4.5) => {
    const ground = sample(...backgrounds), ink = sample(...backgrounds, foreground), value = ratio(ink, ground); pairs++;
    if (value < required) failures.push({ context, foreground, background: backgrounds.join(" over "), ratio: value, required });
  };
  const probe = document.createElement("span"); probe.style.display = "none";
  const color = (name: string) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
  for (const [scope, element] of [["app", document.documentElement], ["reader", document.querySelector(".bs")]] as const) {
    if (!element) continue;
    element.append(probe);
    const surfaces = scope === "app" ? ["--canvas", "--surface-1", "--surface-2"] : ["--bs-reverse", "--bs-light-grey"];
    const inks = scope === "app" ? ["--text-1", "--text-2", "--text-3", "--text-4", "--accent", "--danger", "--success", "--warning", "--gold", "--violet", "--sky"] : ["--bs-default", "--bs-grey", "--bs-dark-grey", "--bs-tertiary", "--bs-primary", "--bs-secondary", "--bs-quart", "--bs-quint", "--bs-success"];
    for (const surface of surfaces) for (const ink of inks) {
      check(`${scope} ${ink} on ${surface}`, color(ink), [color(surface)]);
      if (scope === "app") check(`${scope} ${ink} on pressed ${surface}`, color(ink), [color(surface), color("--fill-3")]);
    }
    if (scope === "app") {
      check("prominent button", color("--on-accent"), [color("--accent")]);
      for (const surface of surfaces) check(`control edge on ${surface}`, color("--control-edge"), [color(surface)], 3);
      for (const ink of ["--media-ink", "--media-muted", "--media-accent"]) for (const surface of ["--media-canvas", "--media-surface"]) check(`${ink} on ${surface}`, color(ink), [color(surface)]);
    }
  }
  probe.remove();
  // Navigation material is sampled against both possible extreme backdrops, including its pill.
  const dock = document.querySelector('nav.tabs[aria-label="Sections"]');
  if (dock) {
    const material = getComputedStyle(dock, "::before").backgroundColor;
    const selected = getComputedStyle(dock.querySelector(".tabs__pill")!).backgroundColor;
    for (const button of dock.querySelectorAll(".tab")) for (const backdrop of ["#000", "#fff"]) {
      check(`dock ${button.getAttribute("aria-label")} ${backdrop}`, getComputedStyle(button).color, [backdrop, material, ...(button.hasAttribute("data-on") ? [selected] : [])]);
    }
  }
  // Actual text on flat content surfaces catches component-level color/opacity overrides.
  let textNodes = 0; const manual: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(".route *")) {
    if (!Array.from(element.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!rect.width || !rect.height || style.visibility !== "visible" || element.closest('[inert], [aria-hidden="true"], :disabled, .tabs, .bs-header, .sheet, .bs-sheet')) continue;
    const stack: HTMLElement[] = []; let ancestor: HTMLElement | null = element, opacity = 1;
    while (ancestor) { stack.unshift(ancestor); opacity *= Number(getComputedStyle(ancestor).opacity); ancestor = ancestor.parentElement; }
    if (!opacity) continue;
    if (stack.some(el => getComputedStyle(el).backgroundImage.includes("url("))) { manual.push(element.className); continue; }
    const layers = stack.map(el => {
      const s = getComputedStyle(el);
      const stops = s.backgroundImage.match(/(?:rgba?|color)\([^()]+\)/g) ?? [];
      return { opacity: Number(s.opacity), colors: stops.length ? stops.map(c => [s.backgroundColor, c]) : [[s.backgroundColor]] };
    });
    // Composite each opacity group from the text outward. Gradient stops are checked at
    // their worst endpoints; image-backed text is reported separately for visual review.
    const paint = (choices: string[][], ink?: string) => {
      let child = ink ?? "transparent";
      for (let i = layers.length - 1; i >= 0; i--) {
        ctx.clearRect(0, 0, 1, 1);
        for (const c of [...choices[i], child]) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        child = `rgba(${r}, ${g}, ${b}, ${a / 255 * layers[i].opacity})`;
      }
      return sample(getComputedStyle(document.documentElement).getPropertyValue("--canvas"), child);
    };
    let variants: string[][][] = [[]];
    for (const layer of layers) variants = variants.flatMap(path => layer.colors.map(c => [...path, c]));
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
    const required = large ? 3 : 4.5;
    const value = Math.min(...variants.map(v => ratio(paint(v, style.color), paint(v)))); pairs++; textNodes++;
    if (value < required) failures.push({ context: `text .${element.className}: ${element.textContent?.trim().slice(0, 45)}`, foreground: style.color, background: "composited content, including gradient stops and group opacity", ratio: value, required });
  }
  return { pairs, textNodes, manual: [...new Set(manual)], failures };
}
