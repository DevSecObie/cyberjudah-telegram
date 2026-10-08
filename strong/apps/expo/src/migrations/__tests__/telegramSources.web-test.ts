import { readTelegramCloudSnapshot, type TelegramCloudStorage } from '../telegramSources.web'

it('awaits every authoritative CloudStorage chunk and preserves exact source text', async () => {
  const keys = Array.from({ length: 205 }, (_, i) => `key_${i}`)
  const source: TelegramCloudStorage = {
    getKeys: done => done(null, keys),
    getItems: jest.fn((part, done) => done(null, Object.fromEntries(part.map(key => [key, '{"text":"preserved"}'])))),
  }
  const result = await readTelegramCloudSnapshot(source)
  expect(Object.keys(result)).toEqual(keys)
  expect(result.key_204).toBe('{"text":"preserved"}')
  expect(source.getItems).toHaveBeenCalledTimes(3)
})
it('does not turn an unavailable SDK or failed callback into an empty successful migration', async () => {
  await expect(readTelegramCloudSnapshot(undefined)).rejects.toThrow('Telegram')
  await expect(readTelegramCloudSnapshot({ getKeys: done => done('failed'), getItems: jest.fn() })).rejects.toThrow('pending')
  await expect(readTelegramCloudSnapshot({ getKeys: done => done(null, ['note']), getItems: (_keys, done) => done('failed') })).rejects.toThrow('pending')
  await expect(readTelegramCloudSnapshot({ getKeys: done => done(null, ['note']), getItems: (_keys, done) => done(null, {}) })).rejects.toThrow('changed')
})
it('accepts a successfully read empty account without consulting the device mirror', async () => {
  const source = { getKeys: (done: (error: unknown, keys: string[]) => void) => done(null, []), getItems: jest.fn() }
  expect(await readTelegramCloudSnapshot(source)).toEqual({})
  expect(source.getItems).not.toHaveBeenCalled()
})
