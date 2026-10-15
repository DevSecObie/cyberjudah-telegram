/**
 * CyberJudah web build: Sentry's SDK (about 1 MB) is loaded after the first chapter has painted,
 * with the app's other deferred code (helpers/deferred.tsx). Calls made before it is here are
 * kept and made, in order, once it is: Sentry.init first, as RootLayout makes it on start.
 *
 * Only the calls the app makes are offered. `wrap` returns the root component itself: the SDK's
 * wrapper (profiler and touch breadcrumbs) cannot be added once the app is on screen.
 */
import type * as SentrySDK from '@sentry/react-native'
import type { ComponentType } from 'react'
import { deferredModule } from './deferred'

type SDK = typeof SentrySDK

let sdk: SDK | undefined
const pending: ((loaded: SDK) => void)[] = []

const load = deferredModule(() =>
  import('@sentry/react-native').then(loaded => {
    sdk = loaded
    for (const call of pending.splice(0)) call(loaded)
    return loaded
  })
)

const run = (call: (loaded: SDK) => void) => {
  if (sdk) call(sdk)
  else pending.push(call)
}

export const init: SDK['init'] = options => {
  run(loaded => loaded.init(options))
  return undefined
}

export const addBreadcrumb: SDK['addBreadcrumb'] = breadcrumb =>
  run(loaded => loaded.addBreadcrumb(breadcrumb))

export const captureException = (...args: Parameters<SDK['captureException']>): string => {
  if (sdk) return sdk.captureException(...args)
  run(loaded => loaded.captureException(...args))
  return ''
}

export const withScope = (callback: Parameters<SDK['withScope']>[0]): void =>
  run(loaded => {
    loaded.withScope(callback)
  })

/** The current scope's user, set on the SDK's scope (now, or once it is loaded). */
export const getCurrentScope = () => ({
  setUser: (user: Parameters<ReturnType<SDK['getCurrentScope']>['setUser']>[0]) =>
    run(loaded => {
      loaded.getCurrentScope().setUser(user)
    }),
})

export const wrap = <P extends object>(component: ComponentType<P>): ComponentType<P> => component

/** Starts loading the SDK now (it otherwise loads once the first chapter has painted). */
export const loadSentry = () => load()
