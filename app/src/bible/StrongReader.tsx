import { useParams, useSearchParams } from "react-router";

import { useBottomButtons } from "@/tg/hooks";
import { strongReaderPath } from "./strongRoutes";
import "./strong-reader.css";

/**
 * The Bible screen: Bible Strong's own reader (strong/, at /app/strong), so reading, selecting,
 * highlighting, notes, word annotations, the book picker and every other reader behaviour are
 * Bible Strong's. It opens at the chapter asked for (/read/john/3?v=16) and sits above the app's
 * bottom bar; inside this frame it leaves out its own.
 */
export function StrongReader() {
  const { book, chapter } = useParams();
  const [params] = useSearchParams();
  useBottomButtons(null, null);
  const src = strongReaderPath(book, chapter ? Number(chapter) : undefined, params.get("v"));
  return (
    <main className="strong-reader">
      <h1 className="sr-only">Bible</h1>
      <iframe key={src} className="strong-reader__frame" src={src} title="Bible" allow="clipboard-write; web-share; fullscreen" />
    </main>
  );
}
