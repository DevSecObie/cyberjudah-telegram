import React from 'react'
import { act, create } from 'react-test-renderer'
import { atom } from 'jotai/vanilla'

import type { BibleTab } from '~state/tabs'
import BibleFooter from '../BibleFooter'

jest.mock('~helpers/bibleVersions', () => ({
  getVersions: () => ({
    LSG: { hasAudio: false },
    // As the CyberJudah KJV: recorded for the 66 books, not for the Apocrypha (67 and up).
    KJV: {
      hasAudio: true,
      getAudioUrl: (book: number, chapter: number) => (book <= 66 ? `${book}/${chapter}.mp3` : ''),
    },
  }),
}))

jest.mock('~state/tabs', () => ({
  useIsCurrentTab: () => () => false,
}))

jest.mock('../atom', () => {
  const { atom: createAtom } = jest.requireActual<typeof import('jotai/vanilla')>('jotai/vanilla')
  return { playingBibleTabIdAtom: createAtom(undefined) }
})

jest.mock('../AudioTTSFooter', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return (props: Record<string, unknown>) => ReactModule.createElement('AudioTTSFooter', props)
})

jest.mock('../AudioUrlFooter', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return (props: Record<string, unknown>) => ReactModule.createElement('AudioUrlFooter', props)
})
jest.mock('../BackToAudioFooter', () => () => null)

describe('BibleFooter', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  it('renders on a standalone full-chapter screen outside the primary Bible tab', () => {
    const bibleAtom = atom({ id: 'standalone-bible', data: {} } as BibleTab)
    const chapterVerses = [
      { Livre: 49, Chapitre: 2, Verset: 1, Texte: 'Vous étiez morts.' },
    ] as never
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <BibleFooter
          bibleAtom={bibleAtom}
          book={{ Numero: 49, Nom: 'Éphésiens', Chapitres: 6 }}
          chapter={2}
          chapterVerses={chapterVerses}
          goToPrevChapter={jest.fn()}
          goToNextChapter={jest.fn()}
          goToChapter={jest.fn()}
          version="LSG"
          isInTab={false}
        />
      )
    })

    expect(
      renderer!.root.find(node => String(node.type) === 'AudioTTSFooter').props.chapterVerses
    ).toBe(chapterVerses)
  })

  const renderKjv = (book: { Numero: number; Nom: string; Chapitres: number }) => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <BibleFooter
          bibleAtom={atom({ id: 'kjv', data: {} } as BibleTab)}
          book={book}
          chapter={1}
          goToPrevChapter={jest.fn()}
          goToNextChapter={jest.fn()}
          goToChapter={jest.fn()}
          version="KJV"
          isInTab={false}
        />
      )
    })
    return renderer!.root
  }

  it('plays the recorded King James for the 66 books', () => {
    const root = renderKjv({ Numero: 1, Nom: 'Genèse', Chapitres: 50 })
    expect(root.findAll(node => String(node.type) === 'AudioUrlFooter')).toHaveLength(1)
    expect(root.findAll(node => String(node.type) === 'AudioTTSFooter')).toHaveLength(0)
  })

  it('reads an Apocrypha chapter aloud on the device, with no recording to switch to', () => {
    const root = renderKjv({ Numero: 69, Nom: 'Tobit', Chapitres: 14 })
    const tts = root.find(node => String(node.type) === 'AudioTTSFooter')
    expect(tts.props.onChangeMode).toBeUndefined()
    expect(root.findAll(node => String(node.type) === 'AudioUrlFooter')).toHaveLength(0)
  })
})
