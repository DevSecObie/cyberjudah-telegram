import sharp from "sharp";
import { copyFile, writeFile } from "node:fs/promises";

// Build-size derivatives of the app's existing artwork; never use Capacitor's starter icon.
const source = new URL("../public/icons/light-1024.png", import.meta.url);
await copyFile(source, new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", import.meta.url));
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const root = new URL(`../android/app/src/main/res/mipmap-${density}/`, import.meta.url);
  await sharp(source.pathname).resize(size, size).png().toFile(new URL("ic_launcher.png", root).pathname);
  await sharp(source.pathname).resize(size, size).png().toFile(new URL("ic_launcher_round.png", root).pathname);
  // Android's adaptive foreground safe region is centered inside a 108dp canvas.
  const canvas = Math.round(size * 108 / 48), content = Math.round(canvas * 66 / 108);
  const icon = await sharp(source.pathname).resize(content, content).png().toBuffer();
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: "#05070f" } }).composite([{ input: icon, gravity: "center" }]).png().toFile(new URL("ic_launcher_foreground.png", root).pathname);
}
await writeFile(new URL("../android/app/src/main/res/values/ic_launcher_background.xml", import.meta.url), '<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#05070f</color></resources>\n');
