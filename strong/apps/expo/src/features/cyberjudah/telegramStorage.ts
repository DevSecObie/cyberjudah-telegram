// CyberJudah: reads the values the CyberJudah Telegram app saved. Inside Telegram they are the
// account's CloudStorage (the same on every device); the Telegram app also keeps a copy in this
// site's localStorage as "cj:<key>", which is all there is in a browser. This app shares the
// Telegram app's origin (cyberjudah.io), so both are readable here. Nothing is written or removed.

import { isImportedKey } from './telegramImport'

type CloudStorage = {
  getKeys: (cb: (error: string | null, keys?: string[]) => void) => void
  getItems: (keys: string[], cb: (error: string | null, values?: Record<string, string>) => void) => void
}

const cloudStorage = (): CloudStorage | undefined => {
  if (typeof window === 'undefined') return undefined
  const app = (window as unknown as { Telegram?: { WebApp?: { CloudStorage?: CloudStorage; initData?: string } } }).Telegram?.WebApp
  // Outside Telegram the SDK is present but has no account: its CloudStorage would only fail.
  return app?.initData ? app.CloudStorage : undefined
}

const fromCloud = async (): Promise<Record<string, string>> => {
  const cloud = cloudStorage()
  if (!cloud) return {}
  const keys = await new Promise<string[]>(resolve => cloud.getKeys((error, k) => resolve(error ? [] : (k ?? []))))
  const wanted = keys.filter(isImportedKey)
  const out: Record<string, string> = {}
  // Telegram reads at most a few dozen keys a call.
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50)
    const values = await new Promise<Record<string, string>>(resolve =>
      cloud.getItems(batch, (error, v) => resolve(error ? {} : (v ?? {})))
    )
    for (const [k, v] of Object.entries(values)) if (v) out[k] = v
  }
  return out
}

const fromDevice = (): Record<string, string> => {
  const out: Record<string, string> = {}
  try {
    const storage = window.localStorage
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i)
      if (!name?.startsWith('cj:')) continue
      const key = name.slice(3)
      const value = storage.getItem(name)
      if (value && isImportedKey(key)) out[key] = value
    }
  } catch {
    // Storage blocked: nothing to bring in from this device.
  }
  return out
}

/** Every value the import reads, the account's copy first, then this device's. */
export async function readTelegramAppValues(): Promise<Record<string, string>> {
  const device = fromDevice()
  const cloud = await fromCloud().catch(() => ({}))
  return { ...device, ...cloud }
}
