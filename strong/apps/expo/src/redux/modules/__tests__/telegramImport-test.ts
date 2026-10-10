// Mock react-native before other imports
import userReducer, { mergeImportedBibleData } from '../user'
import { convertTelegramData, countImported } from '~features/cyberjudah/telegramImport'

jest.mock('react-native', () => ({
  Appearance: {
    getColorScheme: jest.fn(() => 'light'),
  },
}))

// Mock expo-file-system
jest.mock('expo-file-system/legacy', () => ({}))
jest.mock('expo-file-system', () => ({}))

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({}))

// Mock bibleVersions and databases to avoid deep import chains
jest.mock('~helpers/bibleVersions', () => ({
  versions: {},
  getIfVersionNeedsUpdate: jest.fn(),
}))

jest.mock('~helpers/databases', () => ({
  databases: {},
  getIfDatabaseNeedsUpdate: jest.fn(),
}))

// Mock modules before importing reducer
jest.mock('~state/tabs', () => ({
  tabGroupsAtom: {},
}))

jest.mock('jotai/vanilla', () => ({
  getDefaultStore: jest.fn(() => ({
    set: jest.fn(),
  })),
}))

jest.mock('~helpers/firebase', () => ({
  firebaseDb: {
    collection: jest.fn(),
  },
}))

jest.mock('~i18n', () => ({
  getLanguage: jest.fn(() => 'fr'),
}))

jest.mock('~helpers/languageUtils', () => ({
  getDefaultBibleVersion: jest.fn(() => 'LSG'),
}))

// Mock theme imports
jest.mock('~themes/colors', () => ({ primary: '#000' }))
jest.mock('~themes/darkColors', () => ({ primary: '#111' }))
jest.mock('~themes/blackColors', () => ({ primary: '#222' }))
jest.mock('~themes/sepiaColors', () => ({ primary: '#333' }))
jest.mock('~themes/natureColors', () => ({ primary: '#444' }))
jest.mock('~themes/sunsetColors', () => ({ primary: '#555' }))
jest.mock('~themes/mauveColors', () => ({ primary: '#666' }))
jest.mock('~themes/nightColors', () => ({ primary: '#777' }))

// Mock generateUUID to return predictable values
jest.mock('~helpers/generateUUID', () => {
  let counter = 0
  return jest.fn(() => `uuid-${++counter}`)
})

const init = () => userReducer(undefined, { type: '@@INIT' })

describe('mergeImportedBibleData (CyberJudah Telegram app import)', () => {
  const data = convertTelegramData({
    bs_tags: JSON.stringify({ t1: { id: 't1', name: 'Creation' } }),
    bs_h_genesis_1: JSON.stringify({ '1': { color: 'color2', date: 10, tags: { t1: true } }, '2': { color: 'color5', date: 11 } }),
    bs: JSON.stringify({ customHighlightColors: [{ id: 'custom-x', hex: '#123456' }] }),
  })
  const payload = { data, version: 1, count: countImported(data) }

  it('adds what the reader saved in the Telegram app and records it', () => {
    const state = userReducer(init(), mergeImportedBibleData(payload))
    expect(state.bible.highlights['1-1-1']).toMatchObject({ color: 'color2' })
    expect(state.bible.tags.t1.highlights).toEqual({ '1-1-1': true })
    expect(state.bible.settings.customHighlightColors.map(c => c.id)).toEqual(['custom-x'])
    expect(state.telegramImport).toMatchObject({ version: 1, count: 3 })
  })

  it('never replaces what this app already holds', () => {
    const start = init()
    // The reader's own highlight on verse 2 and tag t1, made in this app.
    const before = {
      ...start,
      bible: {
        ...start.bible,
        highlights: { '1-1-2': { color: 'color1', date: 99, version: 'KJV' } },
        tags: { t1: { id: 't1', name: 'Mine', highlights: { '1-1-9': true as const } } },
      },
    }
    const state = userReducer(before, mergeImportedBibleData(payload))
    expect(state.bible.highlights['1-1-2']).toEqual({ color: 'color1', date: 99, version: 'KJV' })
    expect(state.bible.highlights['1-1-1']).toMatchObject({ color: 'color2' })
    expect(state.bible.tags.t1.name).toBe('Mine')
    expect(state.bible.tags.t1.highlights).toEqual({ '1-1-1': true, '1-1-9': true })
  })

  it('adds a custom colour once', () => {
    const once = userReducer(init(), mergeImportedBibleData(payload))
    const twice = userReducer(once, mergeImportedBibleData(payload))
    expect(twice.bible.settings.customHighlightColors).toHaveLength(1)
  })
})
