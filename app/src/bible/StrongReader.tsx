import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router";

import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { sendToReader, useReaderCanGoBack } from "./BibleFrame";
import { strongReaderPath } from "./strongRoutes";

/**
 * The Bible screen. The reader itself is the one frame the app keeps loaded (BibleFrame, in App);
 * this screen moves it to the chapter asked for (/read/john/3?v=16), and lets Telegram's back
 * button close the reader's own screens (a commentary, a note) before leaving the Bible.
 */
export function StrongReader() {
  const { book, chapter } = useParams();
  const [params] = useSearchParams();
  const verses = params.get("v");
  useBottomButtons(null, null);
  const readerCanGoBack = useReaderCanGoBack();
  useBackButton(!readerCanGoBack, () => {
    if (!readerCanGoBack) return false;
    sendToReader({ type: "back" });
    return true;
  });
  useEffect(() => {
    if (!book) return;
    const path = strongReaderPath(book, chapter ? Number(chapter) : undefined, verses);
    sendToReader({ type: "open", path: path.replace(/^\/app\/strong/, "") });
  }, [book, chapter, verses]);
  return <h1 className="sr-only">Bible</h1>;
}
