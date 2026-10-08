import type { FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

/** Explicit local test builds only; live project tokens must never go to an emulator. */
export const connectWebFirebaseEmulators = (
  app: FirebaseApp,
  host: string | undefined,
  browserHostname: string
) => {
  if (!host) return
  if (
    host !== '127.0.0.1' ||
    !['127.0.0.1', 'localhost'].includes(browserHostname) ||
    !app.options.projectId?.startsWith('demo-')
  ) {
    throw new Error('Firebase emulators require a demo project and a loopback-only test build')
  }
  connectAuthEmulator(getAuth(app), `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(getFirestore(app), host, 8089)
}
