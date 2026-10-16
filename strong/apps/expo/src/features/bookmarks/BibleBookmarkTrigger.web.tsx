import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import ContextualPanel from '~common/ContextualPanel'
import { useBibleBookmarkScreens } from './useBibleBookmarkScreens'
import type { BibleBookmarkTriggerProps } from './BibleBookmarkTrigger'

function WebBibleBookmarkTrigger({
  children,
  book,
  chapter,
  version,
  accessibilityLabel,
}: BibleBookmarkTriggerProps) {
  const panel = useBibleBookmarkScreens(book, chapter, version)
  return (
    <ContextualPanel
      trigger={children}
      accessibilityLabel={accessibilityLabel}
      initialScreen="bookmark"
      screens={panel.screens}
      onOpen={panel.prepare}
      width={430}
    />
  )
}

// CyberJudah: inside the Telegram app the reader is on a phone, so it behaves as Bible Strong's
// phone app does (BibleBookmarkTrigger.phone.tsx).
// Loaded only there: the website, and its tests, never load the phone version.
export default (isEmbeddedInCyberJudah()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./BibleBookmarkTrigger.phone') as typeof import('./BibleBookmarkTrigger.phone')).default
  : WebBibleBookmarkTrigger)
