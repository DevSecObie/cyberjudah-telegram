import { native, nativeSaveFile } from "@/native/platform";
export async function saveFile(name: string, body: string, type = "application/json") {
  if (native) { await nativeSaveFile(name, body); return; }
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
