import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import CommentarySourceDetails from './CommentarySourceDetails'
import { useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuView } from '~common/ui/MenuView'
import ContextualPanel from '~common/ContextualPanel'
import PanelAction from '~common/ContextualPanel/PanelAction'
import CommentarySelectorSheet, { type CommentaryProjection } from './CommentarySelectorSheet'

function WebCommentaryMenu(
  props: ComponentProps<typeof MenuView> & { direct?: boolean }
) {
  const { t } = useTranslation()
  const [details, setDetails] = useState<CommentaryProjection>()
  if (!props.actions?.some(action => action.id === 'choose-commentaries'))
    return <MenuView tabActions {...props} />
  return (
    <ContextualPanel
      commands={{
        actions: props.actions,
        select: (id, nav) => {
          if (id === 'choose-commentaries') nav.open('sources')
          else props.onPressAction?.({ nativeEvent: { event: id } })
        },
      }}
      trigger={props.children}
      accessibilityLabel={props.accessibilityLabel || t('accessibility.options')}
      width={500}
      initialScreen={props.direct ? 'sources' : 'actions'}
      screens={{
        actions: {
          width: 340,
          title: t('Commentaires'),
          content: nav => (
            <>
              {props.actions
                .filter(action => !action.attributes?.hidden)
                .map(action => (
                  <PanelAction
                    key={action.id}
                    label={action.title}
                    icon={action.id === 'choose-commentaries' ? 'check-square' : 'external-link'}
                    nested={action.id === 'choose-commentaries'}
                    onPress={() => {
                      if (action.id === 'choose-commentaries') nav.open('sources')
                      else {
                        nav.close()
                        props.onPressAction?.({ nativeEvent: { event: action.id } } as Parameters<
                          NonNullable<typeof props.onPressAction>
                        >[0])
                      }
                    }}
                  />
                ))}
            </>
          ),
        },
        details: {
          title: details?.entry.title ?? t('Commentaires'),
          content: () => (details ? <CommentarySourceDetails projection={details} /> : null),
        },
        sources: {
          title: t('commentaries.selector.title'),
          content: nav => (
            <CommentarySelectorSheet
              inline
              onOpenDetails={projection => {
                setDetails(projection)
                nav.open('details')
              }}
            />
          ),
        },
      }}
    />
  )
}

// CyberJudah: inside the Telegram app the reader is on a phone, so it behaves as Bible Strong's
// phone app does (CommentaryMenu.phone.tsx).
// Loaded only there: the website, and its tests, never load the phone version.
export default (isEmbeddedInCyberJudah()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./CommentaryMenu.phone') as typeof import('./CommentaryMenu.phone')).default
  : WebCommentaryMenu)
