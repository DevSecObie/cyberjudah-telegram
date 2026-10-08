import { getApp, getApps, initializeApp } from 'firebase/app'
import { initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

import { getWebFirebaseConfig } from './webFirebaseConfig'
import { connectWebFirebaseEmulators } from './firebaseEmulators.web'

export const firebaseApp =
  getApps()[0] ??
  initializeApp(
    getWebFirebaseConfig({
      EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
        process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
    })
  )

// The SDK owns the offline document cache and pending writes, including across tabs.
export const firebaseDb = initializeFirestore(firebaseApp, {
  localCache: typeof window === 'undefined' ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

if (process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST && typeof window !== 'undefined') {
  connectWebFirebaseEmulators(firebaseApp, process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST, window.location.hostname)
}

export const getFirebaseApp = () => getApp()
