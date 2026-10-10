import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { RootState } from '~redux/modules/reducer'
import { useDispatch } from './DispatchProvider'
import { OPEN_PRECEPT } from './dispatch'
import { InlineItemContainer } from './InlineItem'
import {
  ExpandButton,
  IconButton,
  RelationIconWrapper,
  RelationLabel,
  RelationTag,
} from './RelationsText'
import { scaleFontSize } from './scaleFontSize'
import truncate from './truncate'

/** CyberJudah: a scripture the classes read with this verse; it opens the class's breakdown. */
export type PreceptMarker = { label: string; sectionId: string }

interface Props {
  precepts: PreceptMarker[]
  settings: RootState['user']['bible']['settings']
  isParallel?: boolean
  isDisabled?: boolean
}

/** CyberJudah: the precepts after their verse, drawn like Bible Strong's notes (RelationsText). */
const PreceptsText = ({ precepts, settings, isParallel, isDisabled }: Props) => {
  const dispatch = useDispatch()
  const [isExpanded, setIsExpanded] = useState(false)
  const visible = isExpanded ? precepts : precepts.slice(0, 3)
  const hiddenCount = precepts.length - visible.length
  const color = settings.colors[settings.theme].primary
  const toggle = (expanded: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsExpanded(expanded)
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('layoutChanged'))
    })
  }
  const open = (precept: PreceptMarker) =>
    dispatch({ type: OPEN_PRECEPT, payload: { sectionId: precept.sectionId } })

  return (
    <InlineItemContainer settings={settings} isDisabled={isDisabled} data-ignore-verse-touch>
      {visible.map(precept => (
        <RelationTag
          key={`${precept.sectionId}:${precept.label}`}
          settings={settings}
          isParallel={isParallel}
          role={isDisabled ? undefined : 'link'}
          tabIndex={isDisabled ? -1 : 0}
          aria-label={`Precept ${precept.label}`}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (isDisabled || event.key !== 'Enter') return
            event.preventDefault()
            event.stopPropagation()
            open(precept)
          }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            open(precept)
          }}
        >
          <RelationIconWrapper settings={settings}>
            <span
              style={{
                color,
                fontFamily: 'Georgia, serif',
                fontWeight: 700,
                fontSize: 15,
                lineHeight: 1,
                width: 16,
                textAlign: 'center',
              }}
            >
              P
            </span>
          </RelationIconWrapper>
          <RelationLabel settings={settings}>{truncate(precept.label, 40)}</RelationLabel>
        </RelationTag>
      ))}
      {hiddenCount > 0 && (
        <ExpandButton settings={settings} onClick={toggle(true)}>
          +{hiddenCount}
        </ExpandButton>
      )}
      {isExpanded && precepts.length > 3 && (
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
