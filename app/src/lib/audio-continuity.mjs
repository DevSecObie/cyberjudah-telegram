/** The catalog order and chapter IDs are authoritative, including non-contiguous chapters. */
export function adjacentChapter(books, where, direction) {
  if (!where) return null;
  const chapters = books.flatMap((book) => book.chapterIds.map((chapter) => ({ slug: book.slug, chapter })));
  const index = chapters.findIndex((chapter) => chapter.slug === where.slug && chapter.chapter === where.chapter);
  return index < 0 ? null : chapters[index + direction] ?? null;
}

/** Register only supported actions; dispose every action this owner successfully installed. */
export function bindMediaSession(session, actions) {
  const installed = [];
  if (!session) return () => {};
  for (const [action, handler] of Object.entries(actions)) {
    try { session.setActionHandler(action, handler); installed.push(action); } catch { /* unsupported action */ }
  }
  return () => {
    for (const action of installed) {
      try { session.setActionHandler(action, null); } catch { /* platform teardown */ }
    }
    session.playbackState = 'none';
    session.metadata = null;
  };
}
