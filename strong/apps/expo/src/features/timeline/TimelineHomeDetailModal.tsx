import { resolveFontFamily } from '~themes/styleValues'
import { useTheme as useStylingTheme } from '~themes/ThemeProvider'
import React from 'react'
import { type SheetRef, SheetScrollView } from '~common/sheet'
import Sheet from '~common/ContextualPanel/ContextualSheet'
import InlineSheetContent from '~common/ContextualPanel/InlineSheetContent'
import { useTranslation } from 'react-i18next'
import Accordion from '~common/ui/Accordion'
import Box from '~common/ui/Box'
import Paragraph from '~common/ui/Paragraph'
import Text from '~common/ui/Text'
interface Props {
  inline?: boolean
  modalRef: React.RefObject<SheetRef | null>
  HeaderComponent?: React.ReactNode
  FooterComponent?: React.ReactNode
}

const TimelineHomeDetailModal = ({ modalRef, inline = false }: Props) => {
  const stylingTheme = useStylingTheme()

  const { t } = useTranslation()

  const Container = inline ? InlineSheetContent : Sheet
  return (
    <Container
      ref={modalRef}
      snapPoints={[1]}
      panelTitle={t('Questions fréquentes')}
      panelWidth={500}
    >
      <SheetScrollView>
        <Box className="overflow-hidden border-continuous mt-[20px] p-[20px]">
          <Paragraph>
            The periods, the events and their years are Bible Strong's Bible Timeline. Only its
            history is kept here: its descriptions, articles, pictures and prophetic interpretation
            are not.
          </Paragraph>
          <Text
            className="mt-[20px] text-[24px]"
            style={{ fontFamily: resolveFontFamily(stylingTheme.fontFamily.title) }}
          >
            {t('Questions fréquentes')}
          </Text>
        </Box>
        <Box className="overflow-hidden border-continuous px-[20px]">
          <Accordion
            title={
              <Text
                className="text-[18px]"
                style={{ fontFamily: resolveFontFamily(stylingTheme.fontFamily.title) }}
              >
                {t("Qu'est-ce que la chronologie biblique ?")}
              </Text>
            }
          >
            <Paragraph className="m-[20px]" scale={-1}>
              {`An event opens to our case studies on it, with their scripture in the KJV. An event with no case study yet stays on the line, greyed, as Bible Strong shows an event without details.

The last age is ours: the captivity, displacement, persecution, resistance and achievements of the peoples the assembly identifies as the Israelites today.`}
            </Paragraph>
          </Accordion>
          <Accordion
            title={
              <Text
                className="text-[18px]"
                style={{ fontFamily: resolveFontFamily(stylingTheme.fontFamily.title) }}
              >
                {t('Comment avez-vous déterminé les dates, en particulier la date de création ?')}
              </Text>
            }
          >
            <Paragraph className="m-[20px]" scale={-1}>
              {`The periods, the events and their years are Bible Strong's Bible Timeline. A king's reign, where shown, is from Who's Who in the Bible (Joan Comay and Ronald Brownrigg), its chronology of the kings.

Each event keeps its own date label, precision and uncertainty. Where sources disagree, both are shown.`}
            </Paragraph>
          </Accordion>
          <Accordion
            title={
              <Text
                className="text-[18px]"
                style={{ fontFamily: resolveFontFamily(stylingTheme.fontFamily.title) }}
              >
                {t('Quelles sont vos principales sources pour la chronologie ?')}
              </Text>
            }
          >
            <Paragraph className="m-[20px]" scale={-1}>
              {`Each event keeps three things apart: the documented history, from the sources listed under it; quotes and sources from the classes, each linked to the class or episode at the moment it was said; and the Scriptures read with it. Where sources disagree, both are shown.`}
            </Paragraph>
          </Accordion>
          <Accordion
            title={
              <Text
                className="text-[18px]"
                style={{ fontFamily: resolveFontFamily(stylingTheme.fontFamily.title) }}
              >
                {t('Prévoyez-vous la date du retour du Christ ?')}
              </Text>
            }
          >
            <Paragraph className="m-[20px]" scale={-1}>
              {`Redemption is the final card. It does not assign a date to future events.

The pictures are ours, painted for CyberJudah under the assembly's depiction brief: each period's scene, and on an event the approved portrait of the person it is about. A period still waiting on direction shows its colour.`}
            </Paragraph>
          </Accordion>
        </Box>
      </SheetScrollView>
    </Container>
  )
}

export default TimelineHomeDetailModal
