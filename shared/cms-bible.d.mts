declare const bible: { source: { repository: string; commit: string }; books: { book: string; slug: string; sha256: string; chapters: Record<string, number> }[] };
export default bible;
