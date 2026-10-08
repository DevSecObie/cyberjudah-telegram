import type { FirebaseApp } from 'firebase/app'
import { connectAuthEmulator } from 'firebase/auth'
import { connectFirestoreEmulator } from 'firebase/firestore'
import { connectWebFirebaseEmulators } from '../firebaseEmulators.web'

jest.mock('firebase/auth', () => ({ connectAuthEmulator: jest.fn(), getAuth: jest.fn(() => 'auth') }))
jest.mock('firebase/firestore', () => ({ connectFirestoreEmulator: jest.fn(), getFirestore: jest.fn(() => 'db') }))
const app = (projectId: string) => ({ options: { projectId } }) as FirebaseApp
beforeEach(() => jest.clearAllMocks())

it('leaves production connections alone unless explicitly configured', () => {
  connectWebFirebaseEmulators(app('cyberjudah-app'), undefined, 'cyberjudah.io')
  expect(connectAuthEmulator).not.toHaveBeenCalled()
  expect(connectFirestoreEmulator).not.toHaveBeenCalled()
})

it.each([
  ['cyberjudah-app', '127.0.0.1', '127.0.0.1'],
  ['demo-cyberjudah', 'remote.example', '127.0.0.1'],
  ['demo-cyberjudah', '127.0.0.1', 'cyberjudah.io'],
])('rejects nonlocal or real project configurations: %s, %s, %s', (project, host, origin) => {
  expect(() => connectWebFirebaseEmulators(app(project), host, origin)).toThrow('loopback-only')
  expect(connectAuthEmulator).not.toHaveBeenCalled()
  expect(connectFirestoreEmulator).not.toHaveBeenCalled()
})

it('connects both official SDKs for the local demo project', () => {
  connectWebFirebaseEmulators(app('demo-cyberjudah'), '127.0.0.1', 'localhost')
  expect(connectAuthEmulator).toHaveBeenCalledWith('auth', 'http://127.0.0.1:9099', { disableWarnings: true })
  expect(connectFirestoreEmulator).toHaveBeenCalledWith('db', '127.0.0.1', 8089)
})
