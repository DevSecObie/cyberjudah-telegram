import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import { useState } from 'react'
import { useAtomValue } from 'jotai/react'
import type { RefObject } from 'react'
import type { SheetRef } from '~common/sheet'
import ContextualSheet from '~common/ContextualPanel/ContextualSheet'
import { getDefaultBibleTab } from '~state/tabs'
import { useBookPanelScreens } from '../BibleSelectorTrigger.web'
import { bookSelectorDataAtom } from './state'
export { bookSelectorDataAtom } from './state'

function WebBookSelectorSheet({
  sheetRef,
}: {
  sheetRef: RefObject<SheetRef | null>
  selectedBookNum?: number
}) {
  const state = useAtomValue(bookSelectorDataAtom)
  const [fallback] = useState(() => getDefaultBibleTab().data)
  const panel = useBookPanelScreens({ ...state, data: state.data ?? fallback })
  return (
    <ContextualSheet
      ref={sheetRef}
      panelInitialScreen="books"
      panelScreens={panel.screens}
      panelWidth={400}
      onPresent={panel.reset}
      onClose={panel.reset}
    />
  )
}

// CyberJudah: inside the Telegram app the reader is on a phone, so it behaves as Bible Strong's
// phone app does (BookSelectorSheet.phone.tsx).
// Loaded only there: the website, and its tests, never load the phone version.
export default (isEmbeddedInCyberJudah()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./BookSelectorSheet.phone') as typeof import('./BookSelectorSheet.phone')).default
  : WebBookSelectorSheet)
