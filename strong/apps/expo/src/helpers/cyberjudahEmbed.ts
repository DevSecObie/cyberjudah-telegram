// CyberJudah: this Bible app also runs inside the CyberJudah Telegram app, as its Bible screen, in a
// frame under that app's own bottom bar. There it opens straight into the reader (no public page)
// and leaves out its own bottom bar.
export const isEmbeddedInCyberJudah = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top
  } catch {
    // A frame whose parent cannot be read is still a frame.
    return true
  }
}
