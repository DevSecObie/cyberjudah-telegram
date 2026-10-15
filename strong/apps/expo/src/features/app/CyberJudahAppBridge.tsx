import { usePathname, useRouter } from 'expo-router'
import { getDefaultStore } from 'jotai/vanilla'
import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { createPublicBibleTab } from '~features/bible/publicBibleNavigation'
import { parsePublicBibleRoute } from '~features/bible/publicBibleRoutes'
import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import { sendToApp, setAppColorScheme, type Appearance } from '~helpers/cyberjudahBridge'
import type { RootState } from '~redux/modules/reducer'
import {
  setSettingsPreferredColorScheme,
  setSettingsPreferredDarkTheme,
  setSettingsPreferredLightTheme,
} from '~redux/modules/user/settings'
import { activeTabIndexAtom, tabsAtom, tabsAtomsAtom, type BibleTab } from '~state/tabs'

/** CyberJudah: a message from the app around the reader (app/src/bible/StrongReader.tsx). */
type AppMessage =
  | { source: 'cj-app'; type: 'open'; path: string }
  | { source: 'cj-app'; type: 'back' }
  | ({ source: 'cj-app'; type: 'appearance'; scheme: 'light' | 'dark' } & Appearance)

/**
 * Opens a passage (/bible/kjv/john/3/16) in the reader's Bible tab, as Bible Strong's phone app
 * does when you pick a chapter: the same tab moves to it, with nothing reloaded.
 */
function openPassage(path: string) {
  const route = parsePublicBibleRoute(path.replace(/^\/bible\//, '').split('/'))
  if (!route) return false
  const store = getDefaultStore()
  const passage = createPublicBibleTab(route, '')
  const atoms = store.get(tabsAtomsAtom)
  let index = store.get(activeTabIndexAtom)
  if (index < 0 || store.get(atoms[index])?.type !== 'bible')
    index = atoms.findIndex(tabAtom => store.get(tabAtom).type === 'bible')
  if (index < 0) {
    store.set(tabsAtom, tabs => [...tabs, passage])
    index = store.get(tabsAtomsAtom).length - 1
  } else {
    const tab = store.get(atoms[index]) as BibleTab
    const { selectedBook, selectedChapter, selectedVerse, temp } = passage.data
    store.set(atoms[index], {
      ...tab,
      data: {
        ...tab.data,
        selectedBook,
        selectedChapter,
        selectedVerse,
        temp,
        focusVerses: undefined,
        contextDisplayMode: 'fullChapter',
      },
    })
  }
  store.set(activeTabIndexAtom, index)
  return true
}

/** CyberJudah: inside the Telegram app, the reader takes passages and Back from the app. */
export default function CyberJudahAppBridge() {
  const router = useRouter()
  const pathname = usePathname()
  const dispatch = useDispatch()
  // One theme for the app and its Bible: a choice made on either side is made on both.
  const settings = useSelector((state: RootState) => state.user.bible.settings)
  const preferredColorScheme = settings.preferredColorScheme || 'auto'
  const preferredLightTheme = settings.preferredLightTheme || 'default'
  const preferredDarkTheme = settings.preferredDarkTheme || 'dark'
  const fromApp = useRef<Appearance | null>(null)
  useEffect(() => {
    const given = fromApp.current
    // Only a choice made here goes back to the app, once the app has given its own.
    if (
      !given ||
      (given.preferredColorScheme === preferredColorScheme &&
        given.preferredLightTheme === preferredLightTheme &&
        given.preferredDarkTheme === preferredDarkTheme)
    )
      return
    fromApp.current = { preferredColorScheme, preferredLightTheme, preferredDarkTheme }
    sendToApp({ type: 'appearance', preferredColorScheme, preferredLightTheme, preferredDarkTheme })
  }, [preferredColorScheme, preferredLightTheme, preferredDarkTheme])
  // The app shows Telegram's back button while the reader has a screen open over its Bible tab.
  useEffect(() => {
    sendToApp({ type: 'depth', canGoBack: router.canGoBack() })
  }, [pathname, router])
  useEffect(() => {
    if (!isEmbeddedInCyberJudah()) return
    const onMessage = (event: MessageEvent<AppMessage>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const message = event.data
      if (message?.source !== 'cj-app') return
      if (message.type === 'open') {
        if (openPassage(message.path) && router.canGoBack()) router.dismissTo('/')
      } else if (message.type === 'back') {
        if (router.canGoBack()) router.back()
      } else if (message.type === 'appearance') {
        setAppColorScheme(message.scheme)
        fromApp.current = {
          preferredColorScheme: message.preferredColorScheme,
          preferredLightTheme: message.preferredLightTheme,
          preferredDarkTheme: message.preferredDarkTheme,
        }
        dispatch(setSettingsPreferredColorScheme(message.preferredColorScheme))
        dispatch(setSettingsPreferredLightTheme(message.preferredLightTheme))
        dispatch(setSettingsPreferredDarkTheme(message.preferredDarkTheme))
      }
    }
    window.addEventListener('message', onMessage)
    sendToApp({ type: 'ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [router, dispatch])
  return null
}
