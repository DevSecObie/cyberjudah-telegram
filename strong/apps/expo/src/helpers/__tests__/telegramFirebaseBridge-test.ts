import { createTelegramFirebaseBridge } from '../telegramFirebaseBridge'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  const auth = { authStateReady: jest.fn(async () => {}), currentUser: null as { uid: string } | null }
  const request = jest.fn(async (_url: string, _options: RequestInit) => ({ ok: true, json: async () => ({ uid: 'tg_77', token: 'fixture-token' }) }))
  const signIn = jest.fn(async (_token: string) => {
    auth.currentUser = { uid: 'tg_77' }
    return auth.currentUser
  })
  return { auth, request, signIn }
}
describe('Telegram Firebase session bridge', () => {
  it('waits for cold-start restoration before deciding whether to mint', async () => {
    const f = fixture(), restored = deferred()
    f.auth.authStateReady.mockImplementation(() => restored.promise)
    const bridge = createTelegramFirebaseBridge({ ...f, initData: () => 'signed-launch', request: f.request as never })
    const result = bridge()
    expect(f.request).not.toHaveBeenCalled()
    f.auth.currentUser = { uid: 'tg_77' }
    restored.resolve()
    await expect(result).resolves.toBe('tg_77')
    expect(f.request).toHaveBeenCalledWith('/api/firebase/identity', expect.anything())
    expect(f.signIn).not.toHaveBeenCalled()
  })
  it('deduplicates concurrent fresh sign-ins into exactly one mint and SDK sign-in', async () => {
    const f = fixture()
    const bridge = createTelegramFirebaseBridge({ ...f, initData: () => 'signed-launch', request: f.request as never })
    expect(await Promise.all([bridge(), bridge(), bridge()])).toEqual(['tg_77', 'tg_77', 'tg_77'])
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.request).toHaveBeenCalledWith('/api/firebase/token', expect.objectContaining({ method: 'POST', headers: { authorization: 'tma signed-launch' } }))
    expect(f.signIn).toHaveBeenCalledTimes(1)
    // SDK token refresh changes no bridge state and must not request another custom token.
    await bridge()
    expect(f.request.mock.calls.filter(([url]) => url === '/api/firebase/token')).toHaveLength(1)
  })
  it('does not mint, fetch or replace an account outside Telegram', async () => {
    const f = fixture()
    f.auth.currentUser = { uid: 'email-account' }
    await expect(createTelegramFirebaseBridge({ ...f, initData: () => '', request: f.request as never })()).resolves.toBeNull()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.signIn).not.toHaveBeenCalled()
  })
  it('blocks mismatched persisted accounts instead of silently replacing or migrating them', async () => {
    const f = fixture()
    f.auth.currentUser = { uid: 'tg_88' }
    await expect(createTelegramFirebaseBridge({ ...f, initData: () => 'signed-launch', request: f.request as never })()).rejects.toThrow('differs from your Telegram account')
    expect(f.signIn).not.toHaveBeenCalled()
    expect(f.auth.currentUser.uid).toBe('tg_88')
  })
  it('never passes a rejected or malformed mint response to Firebase', async () => {
    for (const response of [{ ok: false, status: 401 }, { ok: true, json: async () => ({ uid: 'admin', token: 'invalid' }) }]) {
      const f = fixture()
      await expect(createTelegramFirebaseBridge({ ...f, initData: () => 'tampered-launch', request: jest.fn(async () => response) as never })()).rejects.toThrow()
      expect(f.signIn).not.toHaveBeenCalled()
    }
  })
  it('does not overwrite a provider login completed while minting was in flight', async () => {
    const f = fixture()
    const request = jest.fn(async () => {
      f.auth.currentUser = { uid: 'other-account' }
      return { ok: true, json: async () => ({ uid: 'tg_77', token: 'fixture-token' }) }
    })
    await expect(createTelegramFirebaseBridge({ ...f, initData: () => 'signed-launch', request: request as never })()).rejects.toThrow('account changed')
    expect(f.signIn).not.toHaveBeenCalled()
  })
})
