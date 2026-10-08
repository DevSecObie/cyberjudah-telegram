type BridgeAuth = {
  authStateReady(): Promise<void>
  readonly currentUser: { uid: string } | null
}
type Dependencies = {
  auth: BridgeAuth
  initData(): string | undefined
  request: typeof fetch
  signIn(token: string): Promise<{ uid: string }>
}

/** SDK restoration always wins. The Worker alone establishes the Telegram identity. */
export function createTelegramFirebaseBridge({ auth, initData, request, signIn }: Dependencies) {
  let pending: Promise<string | null> | undefined
  const currentUser = () => auth.currentUser
  const start = async () => {
    await auth.authStateReady()
    const raw = initData()
    if (!raw) return null // Normal browser/email/provider sign-in remains available.
    const restored = currentUser()
    const response = await request(`/api/firebase/${restored ? 'identity' : 'token'}`, {
      method: 'POST', headers: { authorization: `tma ${raw}` }, cache: 'no-store',
      credentials: 'omit',
    })
    if (!response.ok) throw new Error(response.status === 401
      ? 'Reopen the app from Telegram to sign in.'
      : 'Telegram sign-in is unavailable. Your saved data has not been moved.')
    const result: { uid?: unknown; token?: unknown } = await response.json()
    if (typeof result.uid !== 'string' || !/^tg_[1-9][0-9]*$/.test(result.uid)) throw new Error('Invalid Telegram sign-in response')
    // A restored provider account must be linked explicitly, never silently overwritten.
    if (restored) {
      if (restored.uid !== result.uid) throw new Error('This Firebase account differs from your Telegram account. Sign out before switching accounts; no data was moved.')
      return restored.uid
    }
    // Another provider sign-in may have completed while the mint request was in flight.
    const signedInMeanwhile = currentUser()
    if (signedInMeanwhile) {
      if (signedInMeanwhile.uid !== result.uid) throw new Error('The signed-in account changed. No data was moved.')
      return signedInMeanwhile.uid
    }
    if (typeof result.token !== 'string' || !result.token) throw new Error('Missing Telegram sign-in token')
    const user = await signIn(result.token)
    if (user.uid !== result.uid) throw new Error('Telegram sign-in identity mismatch')
    return user.uid
  }
  return () => {
    if (!pending) pending = start().finally(() => { pending = undefined })
    return pending
  }
}
