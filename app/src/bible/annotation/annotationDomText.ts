// Copied from Bible Strong (apps/expo/src/features/bible/BibleDOM/AnnotationMode/annotationDomText.ts).

export interface AnnotationTextNodeInfo {
  node: Text
  startOffset: number
  endOffset: number
}

export const collectAnnotationTextNodes = (
  element: Element
): {
  fullText: string
  textNodes: AnnotationTextNodeInfo[]
} => {
  const textNodes: AnnotationTextNodeInfo[] = []
  let currentOffset = 0
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node: Text | null

  while ((node = walker.nextNode() as Text | null)) {
    if (!node.parentElement || !document.contains(node)) continue
    if (node.parentElement.closest('[data-ignore-verse-touch]')) continue

    const length = node.textContent?.length ?? 0
    if (length === 0) continue
    textNodes.push({
      node,
      startOffset: currentOffset,
      endOffset: currentOffset + length,
    })
    currentOffset += length
  }

  return {
    fullText: textNodes.map(item => item.node.textContent).join(''),
    textNodes,
  }
}

export const createAnnotationTextRanges = (
  textNodes: AnnotationTextNodeInfo[],
  startCharIndex: number,
  endCharIndex: number
): Range[] =>
  textNodes.flatMap(info => {
    const start = Math.max(startCharIndex, info.startOffset)
    const end = Math.min(endCharIndex, info.endOffset)
    if (end <= start) return []

    const range = document.createRange()
    range.setStart(info.node, start - info.startOffset)
    range.setEnd(info.node, end - info.startOffset)
    return [range]
  })
