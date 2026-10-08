const listeners = new Map<string, () => void>()
const mockSetOnline = jest.fn()
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
afterEach(() => {
  for (const [name, descriptor] of [['window', originalWindow], ['navigator', originalNavigator]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})
jest.mock('react-native', () => ({ Platform: { OS: 'web' }, AppState: {} }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: jest.fn() } }))
jest.mock('../runtimeConfig', () => ({ isOfflineModeForced: false }))
jest.mock('../resourceQueryRecovery', () => ({ refetchResourceOnReconnect: jest.fn() }))
jest.mock('@tanstack/react-query', () => ({
  QueryClient: jest.fn(() => ({ setQueryDefaults: jest.fn() })),
  focusManager: {},
  onlineManager: { setEventListener: (subscribe: (setOnline: (online: boolean) => void) => void) => subscribe(mockSetOnline) },
}))

it('uses browser connectivity for resource requests without relying on a third-party probe', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: jest.fn(),
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  const { configureQueryManagers } = require('../queryClient')
  configureQueryManagers()
  expect(mockSetOnline).toHaveBeenLastCalledWith(true)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  listeners.get('offline')!()
  expect(mockSetOnline).toHaveBeenLastCalledWith(false)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  listeners.get('online')!()
  expect(mockSetOnline).toHaveBeenLastCalledWith(true)
  const netInfo = require('@react-native-community/netinfo').default
  expect(netInfo.addEventListener).not.toHaveBeenCalled()
})
