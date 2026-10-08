/** Transient reading state belongs to a tab, not to the mounted route. No note text is kept here. */
export type ReaderSession = { selected: number[]; contextMode: "focused" | "fullChapter"; fullscreen: boolean };
const sessions = new Map<string, ReaderSession>();
export function readerSession(key: string, focused: boolean): ReaderSession {
  return sessions.get(key) ?? { selected: [], contextMode: focused ? "focused" : "fullChapter", fullscreen: false };
}
export function saveReaderSession(key: string, state: ReaderSession) {
  sessions.delete(key);
  sessions.set(key, state);
  // Match the bounded viewport cache; closed tabs cannot grow memory indefinitely.
  if (sessions.size > 80) sessions.delete(sessions.keys().next().value!);
}
