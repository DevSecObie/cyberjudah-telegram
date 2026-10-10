import {
  getBook,
  getBookCorpus,
  getBookOrderForCanon,
  getBooksForCanon,
  isBookInTestament,
} from '../bibleBookCatalog'

describe('bibleBookCatalog', () => {
  // CyberJudah: 67-81 are the King James Version's Apocrypha, in 1611 order.
  it('exposes the fifteen King James Apocrypha books as 67-81', () => {
    expect(getBook(67)?.Nom).toBe('1 Esdras')
    expect(getBook(69)?.Nom).toBe('Tobit')
    expect(getBook(81)?.Nom).toBe('2 Maccabees')
    expect(getBookCorpus(67)).toBe('deuterocanonical')
    expect(getBookCorpus(81)).toBe('deuterocanonical')
  })

  it('orders the KJV 1611 canon with the Apocrypha between the Testaments', () => {
    const bookNumbers = getBooksForCanon('kjv-1611').map(book => book.Numero)
    expect(bookNumbers).toHaveLength(81)
    expect(bookNumbers.slice(38, 41)).toEqual([39, 67, 68])
    expect(bookNumbers.slice(52, 55)).toEqual([80, 81, 40])
  })

  it('keeps the Protestant canon limited to the existing 66 books', () => {
    const books = getBooksForCanon('protestant-66')

    expect(books).toHaveLength(66)
    expect(books.at(-1)?.Numero).toBe(66)
  })

  it('orders stable book identities according to the Clementine canon', () => {
    const bookNumbers = getBooksForCanon('clementine-vulgate').map(book => book.Numero)

    expect(bookNumbers.slice(14, 19)).toEqual([15, 16, 67, 68, 17])
    expect(bookNumbers.slice(43, 48)).toEqual([39, 72, 73, 40, 41])
  })

  it('orders stable book identities according to the modern Catholic canon', () => {
    const bookNumbers = getBooksForCanon('catholic-73').map(book => book.Numero)

    expect(bookNumbers).toHaveLength(73)
    expect(bookNumbers.slice(14, 23)).toEqual([15, 16, 67, 68, 17, 72, 73, 18, 19])
    expect(bookNumbers.slice(25, 32)).toEqual([22, 69, 70, 23, 24, 25, 71])
    expect(getBookOrderForCanon('catholic-73', 67)).toBeLessThan(
      getBookOrderForCanon('catholic-73', 17)
    )
    expect(getBookOrderForCanon('catholic-73', 40)).toBeGreaterThan(
      getBookOrderForCanon('catholic-73', 39)
    )
  })

  it('filters installed coverage without losing the canon order', () => {
    const books = getBooksForCanon('clementine-vulgate', [40, 17, 68, 1, 67])

    expect(books.map(book => book.Numero)).toEqual([1, 67, 68, 17, 40])
  })

  it('treats deuterocanonical books as Old Testament books', () => {
    expect(isBookInTestament(67, 'old')).toBe(true)
    expect(isBookInTestament(67, 'new')).toBe(false)
    expect(getBookCorpus(40)).toBe('new')
    expect(isBookInTestament(74, 'old')).toBe(true)
  })
})
