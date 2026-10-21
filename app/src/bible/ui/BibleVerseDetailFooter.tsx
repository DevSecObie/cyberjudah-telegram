import { Feather } from "../icons";

export function BibleVerseDetailFooter({ verse, verses, onVerse }: { verse: number; verses: number; onVerse: (v: number) => void }) {
  if (!verses) return null;
  return (
    <div className="bs-vdetail__footer">
      {verse !== 1 ? <button type="button" onClick={() => onVerse(verse - 1)}><Feather name="arrow-left-circle" size={16} color="var(--bs-default)" /><span className="bs-vdetail__prev">Previous verse</span></button> : null}
      <span className="bs-vdetail__spacer" />
      {verse !== verses ? <button type="button" onClick={() => onVerse(verse + 1)}><span className="bs-vdetail__next">Next verse</span><Feather name="arrow-right-circle" size={16} color="var(--bs-default)" /></button> : null}
    </div>
  );
}
