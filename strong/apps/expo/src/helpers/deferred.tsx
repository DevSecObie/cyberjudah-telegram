/**
 * CyberJudah web build: code the Bible reader does not need for its first paint is loaded on
 * demand (its own chunk) instead of with the app, then fetched in the background once the first
 * chapter is on screen, so opening it later is as quick as before. Only WHEN the code loads
 * changes: the component, its props and its state are the same.
 *
 * Used from `.web` files only; native keeps its static imports.
 */
import {
  createElement,
  lazy,
  Suspense,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react'

type Loader<T> = () => Promise<T>

type Prefetch = boolean | (() => boolean)

const queue: { preload: Loader<unknown>; prefetch: Prefetch }[] = []
let started = false

/**
 * Caches a loader's promise (retrying after a failure) and queues it for the idle prefetch, unless
 * `prefetch` is false (or a function that says no when the prefetch reaches it).
 */
export function deferredModule<T>(
  load: Loader<T>,
  { prefetch = true }: { prefetch?: Prefetch } = {}
): Loader<T> {
  let promise: Promise<T> | undefined
  const preload = () =>
    (promise ??= load().catch(error => {
      promise = undefined
      throw error
    }))
  if (prefetch) queue.push({ preload, prefetch })
  return preload
}

/**
 * A component whose code is loaded when it is first rendered. Until then it renders nothing,
 * which is what each component deferred this way renders while closed.
 */
export function deferredComponent<P extends object>(
  load: Loader<{ default: ComponentType<P> }>,
  options?: { prefetch?: Prefetch }
): ComponentType<P> {
  let loaded: ComponentType<P> | undefined
  const preload = deferredModule(
    () =>
      load().then(module => {
        loaded = module.default
        return module
      }),
    options
  )
  const Lazy = lazy(preload)
  const Deferred = (props: P) => {
    // The React Compiler would hoist the initializer below out of this closure.
    'use no memo'
    // Once the code is here, render it directly (no empty frame); an instance keeps one type.
    const [Component] = useState<ComponentType<P>>(() => loaded ?? (Lazy as ComponentType<P>))
    return createElement(Suspense, { fallback: null }, createElement(Component, props))
  }
  return Deferred
}

const whenIdle = (run: () => void) => {
  const w = typeof window === 'undefined' ? undefined : window
  if (w && 'requestIdleCallback' in w) w.requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 50)
}

let painted = false
const paintListeners = new Set<() => void>()

/**
 * True once the first chapter has painted, the reader has first touched or typed (nothing that
 * renders only once opened can be opened before), or 8 s after start.
 */
export const useFirstPaintDone = () =>
  useSyncExternalStore(
    subscribeToPaint,
    () => painted,
    () => false
  )

const subscribeToPaint = (listener: () => void) => {
  paintListeners.add(listener)
  return () => {
    paintListeners.delete(listener)
  }
}

/**
 * Called once the app has mounted: when the first chapter has painted (see useFirstPaintDone),
 * loads every deferred module in turn while the browser is idle.
 */
export function prefetchDeferredWhenIdle() {
  if (started || typeof document === 'undefined') return
  started = true
  const startedAt = Date.now()
  const next = (index: number) => {
    if (index >= queue.length) return
    const { preload, prefetch } = queue[index]
    if (prefetch !== true && !(typeof prefetch === 'function' && prefetch())) return next(index + 1)
    whenIdle(() => {
      // One that never settles must not hold back the rest.
      Promise.race([preload(), new Promise(resolve => setTimeout(resolve, 20000))])
        .catch(() => undefined)
        .then(() => next(index + 1))
    })
  }
  const events = ['pointerdown', 'keydown'] as const
  const done = () => {
    if (painted) return
    painted = true
    for (const event of events) document.removeEventListener(event, done, true)
    for (const listener of paintListeners) listener()
    setTimeout(() => next(0), 1000)
  }
  for (const event of events) document.addEventListener(event, done, true)
  const wait = () => {
    if (painted) return
    if (document.querySelector('[data-verse-key]') || Date.now() - startedAt > 8000) done()
    else setTimeout(wait, 250)
  }
  wait()
}
