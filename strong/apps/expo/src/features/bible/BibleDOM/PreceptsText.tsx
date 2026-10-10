import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { RootState } from '~redux/modules/reducer'
import type { VerseRelationItem } from './BibleDOMWrapper'
import { useDispatch } from './DispatchProvider'
import { OPEN_PRECEPT } from './dispatch'
import { InlineItemContainer } from './InlineItem'
import RelationsCount from './RelationsCount'
import {
  ExpandButton,
  IconButton,
  RelationIcon,
  RelationIconWrapper,
  RelationLabel,
  RelationTag,
} from './RelationsText'
import { scaleFontSize } from './scaleFontSize'
import truncate from './truncate'

/**
 * CyberJudah: what the classes taught about a verse, as the app has always shown it under the
 * verse: a "Precept(s)" note (why each is there), each precept's scripture, then each class
 * that read the verse. They are drawn as Bible Strong's own relations under a verse.
 */
export type PreceptChip =
  | { kind: 'why'; label: string }
  | { kind: 'precept'; label: string; osis?: string }
  | { kind: 'class'; label: string; path: string }
export type PreceptAction = PreceptChip & { verse: number }

// The relation each chip is drawn as: a note, a verse, a link.
const TARGET: Record<PreceptChip['kind'], VerseRelationItem['targetType']> = {
  why: 'note',
  precept: 'verse',
  class: 'externalLink',
}

interface Props {
  verse: number
  chips: PreceptChip[]
  settings: RootState['user']['bible']['settings']
  isParallel?: boolean
  isDisabled?: boolean
}

const PreceptsText = ({ verse, chips, settings, isParallel, isDisabled }: Props) => {
  const dispatch = useDispatch()
  const [isExpanded, setIsExpanded] = useState(false)
  const open = (chip: PreceptChip) =>
    dispatch({ type: OPEN_PRECEPT, payload: { ...chip, verse } satisfies PreceptAction })
  // As Bible Strong does with relations: a count badge when relations are shown as icons.
  if ((settings.relationsDisplay || 'inline') !== 'inline') {
    const why = chips.find(chip => chip.kind === 'why')
    return (
      <span data-ignore-verse-touch>
        <RelationsCount
          settings={settings}
          count={chips.filter(chip => chip.kind === 'precept').length || chips.length}
          onClick={() => open(why ?? chips[0])}
          isDisabled={isDisabled}
        />
      </span>
    )
  }
  const visible = isExpanded ? chips : chips.slice(0, 3)
  const hiddenCount = chips.length - visible.length
  const toggle = (expanded: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsExpanded(expanded)
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('layoutChanged'))
    })
  }
  return (
    <InlineItemContainer settings={settings} isDisabled={isDisabled} data-ignore-verse-touch>
      {visible.map((chip, index) => (
        <RelationTag
          key={`${chip.kind}:${chip.label}:${index}`}
          settings={settings}
          isParallel={isParallel}
          role={isDisabled ? undefined : 'link'}
          tabIndex={isDisabled ? -1 : 0}
          aria-label={chip.kind === 'why' ? `${chip.label} for verse ${verse}` : chip.label}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (isDisabled || event.key !== 'Enter') return
            event.preventDefault()
            event.stopPropagation()
            open(chip)
          }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            open(chip)
          }}
        >
          <RelationIconWrapper settings={settings}>
            <RelationIcon
              item={{ targetType: TARGET[chip.kind] } as VerseRelationItem}
              settings={settings}
            />
          </RelationIconWrapper>
          <RelationLabel settings={settings}>{truncate(chip.label, 40)}</RelationLabel>
        </RelationTag>
      ))}
      {hiddenCount > 0 && (
        <ExpandButton settings={settings} onClick={toggle(true)}>
          +{hiddenCount}
        </ExpandButton>
      )}
      {isExpanded && chips.length > 3 && (
        <IconButton settings={settings} onClick={toggle(false)}>
          <Feather
            name="chevron-left"
            size={Number(scaleFontSize(14, settings.fontSizeScale).replace('px', ''))}
            color={settings.colors[settings.theme].default}
          />
        </IconButton>
      )}
    </InlineItemContainer>
  )
}

export default PreceptsText
