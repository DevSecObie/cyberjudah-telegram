import { type Book } from "@/api/data";
import { Sheet } from "./Sheet";
import { WordStudy, useStrongs } from "./WordStudy";

/** The reader's word study sheet: a Strong's number tapped in the text, studied in place. */
export function WordSheet({ number, open, onClose, onBack, books, here }: { number: string; open: boolean; onClose: () => void; onBack?: () => void; books: Book[]; here?: { slug: string; chapter: number; verse: number } }) {
  const e = useStrongs(number, open).data;
  return (
    <Sheet open={open} onClose={onClose} hasBack={!!onBack} onBack={onBack} height="full" title={e ? e.lemma : "Word study"} subTitle={e ? `${e.xlit} · ${e.language} ${e.number}` : number} label="Word study">
      <WordStudy number={number} books={books} here={here} onRead={onClose} enabled={open} />
    </Sheet>
  );
}
