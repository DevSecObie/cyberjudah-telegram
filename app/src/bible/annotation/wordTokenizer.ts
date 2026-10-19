// Copied from Bible Strong (smontlouis/bible-strong, apps/expo/src/helpers/wordTokenizer.ts).
/**
 * Word Tokenizer for Bible verse annotations
 *
 * Splits verse text into word tokens with indices for annotation tracking.
 * Word indices are 0-indexed and count only actual words (not whitespace).
 */

export interface WordToken {
  word: string
  index: number // 0-indexed word position
  isWhitespace: boolean
  charStart: number // Character offset start in the original text
  charEnd: number // Character offset end (exclusive)
}

/**
 * Tokenizes verse text into word tokens with indices
 * Uses regex /(\\S+|\\s+)/g to split into words and whitespace
 *
 * @param text - Verse text to tokenize
 * @returns Array of word tokens with indices
 */
export function tokenizeVerseText(text: string): WordToken[] {
  if (!text) return []

  const regex = /(\S+|\s+)/g
  let match: RegExpExecArray | null
  let wordIndex = 0
  const tokens: WordToken[] = []

  while ((match = regex.exec(text)) !== null) {
    const word = match[0]
    const isWhitespace = /^\s+$/.test(word)
    const charStart = match.index
    const charEnd = match.index + word.length

    tokens.push({
      word,
      index: isWhitespace ? -1 : wordIndex,
      isWhitespace,
      charStart,
      charEnd,
    })

    if (!isWhitespace) {
      wordIndex++
    }
  }

  return tokens
}

/**
 * Gets the word index from a character offset position.
 * Used to convert caretRangeFromPoint positions to word indices for annotation mode.
 *
 * @param tokens - Array of word tokens
 * @param charOffset - Character offset in the text
 * @returns The word index at the given position, or null if not found
 */
export function getWordIndexFromCharOffset(tokens: WordToken[], charOffset: number): number | null {
  // Find the token that contains this character offset
  for (const token of tokens) {
    if (charOffset >= token.charStart && charOffset < token.charEnd) {
      // If it's whitespace, find the closest word (prefer the one after)
      if (token.isWhitespace) {
        const nextWord = tokens.find(t => !t.isWhitespace && t.charStart >= token.charEnd)
        const prevWord = [...tokens]
          .reverse()
          .find(t => !t.isWhitespace && t.charEnd <= token.charStart)

        // Prefer the word after the whitespace
        if (nextWord) return nextWord.index
        if (prevWord) return prevWord.index
        return null
      }
      return token.index
    }
  }

  // If charOffset is at the very end of text, return the last word
  const lastWord = [...tokens].reverse().find(t => !t.isWhitespace)
  if (lastWord && charOffset >= lastWord.charEnd) {
    return lastWord.index
  }

  // If charOffset is at the very beginning, return the first word
  const firstWord = tokens.find(t => !t.isWhitespace)
  if (firstWord && charOffset <= firstWord.charStart) {
    return firstWord.index
  }

  return null
}

/**
 * Gets the word token by its word index.
 *
 * @param tokens - Array of word tokens
 * @param wordIndex - The 0-indexed word position
 * @returns The word token, or null if not found
 */
export function getTokenByWordIndex(tokens: WordToken[], wordIndex: number): WordToken | null {
  return tokens.find(t => !t.isWhitespace && t.index === wordIndex) || null
}
