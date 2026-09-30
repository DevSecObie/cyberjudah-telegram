/** Plain text from a string with markup: tags removed until none are left, then any stray angle bracket. */
export const stripTags = (value: string): string => {
  let text = value
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^>]*>/gu, '')
  } while (text !== previous)
  return text.replace(/[<>]/gu, '')
}
