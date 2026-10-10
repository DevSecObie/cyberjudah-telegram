import { convertTelegramData, countImported, isImportedKey } from '../telegramImport'

const values: Record<string, string> = {
  bs_tags: JSON.stringify({ t1: { id: 't1', name: 'Creation', date: 5 } }),
  bs_h_genesis_1: JSON.stringify({ '1': { color: 'color2', date: 10, tags: { t1: true } }, '3': { color: 'custom-x', date: 11 } }),
  bs_n_john_3: JSON.stringify({ '16/17': { id: 'n1', title: 'Love', description: 'For God so loved', date: 12, tags: { t1: true } } }),
  bs_l_tobit_1: JSON.stringify({ '2': { id: 'l1', url: 'https://youtu.be/x', title: 'Class', linkType: 'youtube', date: 13 } }),
  bs_bm: JSON.stringify([{ id: 'b1', name: 'Reading', color: '#cc0000', book: '2-maccabees', chapter: 15, verse: 3, date: 14 }]),
  bs: JSON.stringify({ press: 'longPress', customHighlightColors: [{ id: 'custom-x', hex: '#123456', type: 'underline' }] }),
  hl: JSON.stringify({ 'genesis/1': '1:y,5-6:g', 'exodus/2': '4:b' }),
  nt_psalms_23: JSON.stringify({ '1': 'The LORD is my shepherd' }),
  'cj:ignored': 'x',
  last: '"genesis/1"',
}

describe('CyberJudah Telegram app import', () => {
  const data = convertTelegramData(values)

  it('reads only the keys it converts', () => {
    expect(isImportedKey('bs_h_genesis_1')).toBe(true)
    expect(isImportedKey('nt_psalms_23')).toBe(true)
    expect(isImportedKey('last')).toBe(false)
    expect(isImportedKey('rel_genesis_1')).toBe(false)
  })

  it('gives highlights numeric verse keys, the KJV, and their tags as tag objects', () => {
    expect(data.highlights['1-1-1']).toEqual({ color: 'color2', date: 10, version: 'KJV', tags: { t1: { id: 't1', name: 'Creation' } } })
    expect(data.highlights['1-1-3']).toEqual({ color: 'custom-x', date: 11, version: 'KJV' })
    expect(data.tags.t1.highlights).toEqual({ '1-1-1': true })
  })

  it('takes the first highlights only for chapters that never had new ones', () => {
    expect(data.highlights['1-1-5']).toBeUndefined()
    expect(data.highlights['2-2-4']).toEqual({ color: 'color4', date: 0, version: 'KJV' })
  })

  it('keys notes over several verses as Bible Strong does', () => {
    expect(data.notes['43-3-16/43-3-17']).toMatchObject({ id: 'n1', title: 'Love', description: 'For God so loved', version: 'KJV' })
    expect(data.tags.t1.notes).toEqual({ '43-3-16/43-3-17': true })
    expect(data.notes['19-23-1']).toEqual({ title: '', description: 'The LORD is my shepherd', date: 0, version: 'KJV' })
  })

  it('numbers the Apocrypha in the KJV 1611 order', () => {
    expect(data.links['69-1-2']).toMatchObject({ url: 'https://youtu.be/x', customTitle: 'Class', linkType: 'youtube' })
    expect(data.bookmarks.b1).toMatchObject({ book: 81, chapter: 15, verse: 3, name: 'Reading' })
  })

  it('brings custom highlight colours, and counts what it found', () => {
    expect(data.customHighlightColors).toEqual([{ id: 'custom-x', hex: '#123456', createdAt: 0, type: 'underline' }])
    expect(countImported(data)).toBe(8)
  })

  it('skips damaged values instead of failing', () => {
    expect(() => convertTelegramData({ bs_h_genesis_1: '{', bs_bm: '"x"', bs_n_nowhere_1: '{}' })).not.toThrow()
    expect(countImported(convertTelegramData({ bs_h_genesis_1: '{' }))).toBe(0)
  })
})
