import type { ReactNode } from "react";
import { Feather } from "../icons";
import { Sheet, type SnapPoint } from "./Sheet";

/**
 * The header's selectors (books, verses, versions) as Bible Strong shows them on the iPhone:
 * bottom sheets (BookSelectorSheet, VerseSheet, VerseSelectorPopup, VersionSelectorSheet), not
 * cards under the header. Each says its detents and header; the book list and the version list
 * are full height on the page colour, the verse grids sized to them.
 */
export function HeaderPicker({ open, onClose, title, subTitle, onBack, right, children, snapPoints = ["auto"], reverse = false, centerTitle = false }: {
  open: boolean; onClose: () => void; title: string; subTitle?: string; onBack?: () => void; right?: ReactNode; children: ReactNode;
  snapPoints?: SnapPoint[]; reverse?: boolean; centerTitle?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} snapPoints={snapPoints} background={reverse ? "reverse" : "glass"} title={title} subTitle={subTitle} centerTitle={centerTitle} label={title} className="bs-picker-sheet"
      left={onBack ? <button type="button" className="bs-sheet__back" aria-label="Back to books" title="Back to books" onClick={onBack}><Feather name="arrow-left" size={20} /></button> : centerTitle ? <span className="bs-picker-sheet__spacer" /> : undefined}
      right={right ?? (centerTitle ? <span className="bs-picker-sheet__spacer bs-picker-sheet__spacer--right" /> : undefined)}>
      <div className="bs-picker__body">{children}</div>
    </Sheet>
  );
}
