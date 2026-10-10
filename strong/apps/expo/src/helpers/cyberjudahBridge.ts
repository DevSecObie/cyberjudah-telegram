import { Linking } from 'react-native'
import type { PreferredColorScheme, PreferredDarkTheme, PreferredLightTheme } from '~common/types'
import { isEmbeddedInCyberJudah } from './cyberjudahEmbed'

/**
 * CyberJudah: inside the Telegram app the reader talks to the app around it (app/src/bible/
 * StrongReader.tsx) by message: a CyberJudah page opens as that app's own screen, any other link
 * through Telegram, and taps buzz with Telegram's haptics. Nothing leaves the app for the website.
 */
export type BridgeMessage =
  | { type: 'navigate'; path: string }
  | { type: 'open'; url: string }
  | { type: 'haptic'; kind: 'select' | 'tap' | 'success' }
  | { type: 'ready' }
  | { type: 'depth'; canGoBack: boolean }
  | ({ type: 'appearance' } & Appearance)

/** The reader's theme choice, the same three settings on both sides (app/src/bible/settings.ts). */
export type Appearance = {
  preferredColorScheme: PreferredColorScheme
  preferredLightTheme: PreferredLightTheme
  preferredDarkTheme: PreferredDarkTheme
}

// Telegram's light or dark, as the app gives it: inside a frame the browser's own may differ.
let appColorScheme: 'light' | 'dark' | undefined
const schemeListeners = new Set<() => void>()
export const getAppColorScheme = () => appColorScheme
export const setAppColorScheme = (scheme: 'light' | 'dark') => {
  if (scheme === appColorScheme) return
  appColorScheme = scheme
  schemeListeners.forEach(listener => listener())
}
export const subscribeAppColorScheme = (listener: () => void) => {
  schemeListeners.add(listener)
  return () => {
    schemeListeners.delete(listener)
  }
}

export const sendToApp = (message: BridgeMessage) => {
  if (!isEmbeddedInCyberJudah()) return false
  window.parent.postMessage({ source: 'cj-bible', ...message }, window.location.origin)
  return true
}

// The app's own screens a website path can stand for.
const APP_ROUTES =
  /^\/(?:note|watch|classes|read|bible|dictionary|lexicon|people|person|tags|books|plans?|search|ask|settings|privacy|terms|relations|history)(?:[/?#]|$)/

/** The app screen for a link, if it is one of ours or a class recording; else undefined. */
export function appPathFor(href: string): string | undefined {
  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return undefined
  }
  const path = `${url.pathname}${url.search}${url.hash}`
  if (url.hostname === 'cyberjudah.io' || url.origin === window.location.origin) {
    if (url.pathname.startsWith('/app/strong')) return undefined
    if (url.pathname.startsWith('/app/')) return path.slice('/app'.length)
    if (url.pathname.startsWith('/classes/')) return `/note${path}`
    if (APP_ROUTES.test(url.pathname)) return path
    if (url.pathname === '/' || url.pathname === '/app') return '/'
    return undefined
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '')
  const video =
    host === 'youtube.com' && url.pathname === '/watch'
      ? url.searchParams.get('v')
      : host === 'youtu.be'
        ? url.pathname.slice(1)
        : null
  if (video && /^[A-Za-z0-9_-]{11}$/.test(video)) {
    const t = Number.parseInt(url.searchParams.get('t') ?? '0', 10) || 0
    return `/watch/${video}?t=${t}`
  }
  return undefined
}

/** Opens a link from the reader as the app would: its own screen, else Telegram's browser. */
export function openFromReader(href: string) {
  const path = appPathFor(href)
  return path ? sendToApp({ type: 'navigate', path }) : sendToApp({ type: 'open', url: href })
}

let installed = false
/** Inside the Telegram app, every link the reader opens goes through the app. */
export function installCyberJudahBridge() {
  if (installed || !isEmbeddedInCyberJudah()) return
  installed = true
  const openURL = Linking.openURL.bind(Linking)
  Linking.openURL = async (url: string) => {
    if (/^(?:https?:)?\/\//i.test(url) && openFromReader(url)) return true
    return openURL(url)
  }
  const open = window.open.bind(window)
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = url?.toString()
    if (href && /^(?:https?:)?\/\//i.test(href) && openFromReader(href)) return null
    return open(url, target, features)
  }
  document.addEventListener(
    'click',
    event => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || event.defaultPrevented) return
      const href = anchor.href
      // Links inside the reader itself stay with the reader.
      if (!/^https?:/i.test(href) || new URL(href).pathname.startsWith('/app/strong')) return
      if (anchor.origin === window.location.origin && !appPathFor(href)) return
      event.preventDefault()
      openFromReader(href)
    },
    true
  )
}
