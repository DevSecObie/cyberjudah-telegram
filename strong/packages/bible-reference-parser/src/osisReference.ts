const CANONICAL_OSIS_BOOK_IDS = [
  'Gen',
  'Exod',
  'Lev',
  'Num',
  'Deut',
  'Josh',
  'Judg',
  'Ruth',
  '1Sam',
  '2Sam',
  '1Kgs',
  '2Kgs',
  '1Chr',
  '2Chr',
  'Ezra',
  'Neh',
  'Esth',
  'Job',
  'Ps',
  'Prov',
  'Eccl',
  'Song',
  'Isa',
  'Jer',
  'Lam',
  'Ezek',
  'Dan',
  'Hos',
  'Joel',
  'Amos',
  'Obad',
  'Jonah',
  'Mic',
  'Nah',
  'Hab',
  'Zeph',
  'Hag',
  'Zech',
  'Mal',
  'Matt',
  'Mark',
  'Luke',
  'John',
  'Acts',
  'Rom',
  '1Cor',
  '2Cor',
  'Gal',
  'Eph',
  'Phil',
  'Col',
  '1Thess',
  '2Thess',
  '1Tim',
  '2Tim',
  'Titus',
  'Phlm',
  'Heb',
  'Jas',
  '1Pet',
  '2Pet',
  '1John',
  '2John',
  '3John',
  'Jude',
  'Rev',
]

const SUPPORTED_OSIS_BOOK_ENTRIES: readonly (readonly [string, number])[] = [
  ...CANONICAL_OSIS_BOOK_IDS.map((book, index): [string, number] => [book, index + 1]),
  // CyberJudah: the King James Version's Apocrypha, in 1611 order (the CyberJudah feed's numbering).
  ['1Esd', 67],
  ['2Esd', 68],
  ['Tob', 69],
  ['Jdt', 70],
  ['AddEsth', 71],
  ['Wis', 72],
  ['Sir', 73],
  ['Bar', 74],
  ['EpJer', 75],
  ['PrAzar', 76],
  ['Sus', 77],
  ['Bel', 78],
  ['PrMan', 79],
  ['1Macc', 80],
  ['2Macc', 81],
]

const SUPPORTED_OSIS_BOOK_NUMBERS = new Map(SUPPORTED_OSIS_BOOK_ENTRIES)
const SUPPORTED_OSIS_BOOK_IDS_BY_NUMBER = new Map(
  SUPPORTED_OSIS_BOOK_ENTRIES.map(([book, number]) => [number, book] as const)
)

export const getSupportedOsisBookNumber = (book: string): number | undefined =>
  SUPPORTED_OSIS_BOOK_NUMBERS.get(book)

export const getSupportedOsisBookId = (bookNumber: number): string | undefined =>
  SUPPORTED_OSIS_BOOK_IDS_BY_NUMBER.get(bookNumber)

type OsisPoint = {
  book: string
  chapter: string
  verse?: string
}

type OsisSegment = {
  start: OsisPoint
  end?: OsisPoint
}

const OSIS_SEGMENT_PATTERN =
  /^([1-3]?[A-Za-z]+)\.([1-9]\d*)(?:\.([1-9]\d*))?(?:-(?:([1-3]?[A-Za-z]+)\.([1-9]\d*)(?:\.([1-9]\d*))?|([1-9]\d*)))?$/

const parseOsisSegment = (segment: string): OsisSegment | undefined => {
  const match = OSIS_SEGMENT_PATTERN.exec(segment)
  if (!match) return undefined

  const [, startBook, startChapter, startVerse, endBook, endChapter, endVerse, relativeEnd] = match
  if (!getSupportedOsisBookNumber(startBook)) return undefined

  const start: OsisPoint = {
    book: startBook,
    chapter: startChapter,
    ...(startVerse ? { verse: startVerse } : {}),
  }
  if (endBook && endChapter) {
    if (!getSupportedOsisBookNumber(endBook)) return undefined
    return {
      start,
      end: {
        book: endBook,
        chapter: endChapter,
        ...(endVerse ? { verse: endVerse } : {}),
      },
    }
  }
  if (!relativeEnd) return { start }

  return {
    start,
    end: startVerse
      ? { book: startBook, chapter: startChapter, verse: relativeEnd }
      : { book: startBook, chapter: relativeEnd },
  }
}

const serializeOsisPoint = ({ book, chapter, verse }: OsisPoint): string =>
  verse ? `${book}.${chapter}.${verse}` : `${book}.${chapter}`

const serializeOsisSegment = ({ start, end }: OsisSegment): string =>
  end ? `${serializeOsisPoint(start)}-${serializeOsisPoint(end)}` : serializeOsisPoint(start)

export const normalizeOsisReference = (osis: string): string =>
  osis
    .trim()
    .split(/[,\s]+/u)
    .map(segment => {
      const parsed = parseOsisSegment(segment)
      return parsed ? serializeOsisSegment(parsed) : segment
    })
    .join(',')
