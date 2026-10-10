import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import { useTranslation } from 'react-i18next'
import ContextualPanel from '~common/ContextualPanel'
import { FeatherIcon } from '~common/ui/Icon'
import CommentarySourceDetails from './CommentarySourceDetails'
import type { CommentaryDetailsTriggerProps } from './CommentaryDetailsTrigger'
function WebCommentaryDetailsTrigger({ projection }: CommentaryDetailsTriggerProps) {
  const { t } = useTranslation()
  return (
    <ContextualPanel
      width={420}
      triggerSize={46}
      trigger={<FeatherIcon name="more-horizontal" size={20} />}
      accessibilityLabel={t('commentaries.details.manage', { commentary: projection.entry.title })}
      initialScreen="details"
      screens={{
        details: {
          title: projection.entry.title,
          content: () => <CommentarySourceDetails projection={projection} />,
        },
      }}
    />
  )
}

// CyberJudah: inside the Telegram app the reader is on a phone, so it behaves as Bible Strong's
// phone app does (CommentaryDetailsTrigger.phone.tsx).
// Loaded only there: the website, and its tests, never load the phone version.
export default (isEmbeddedInCyberJudah()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./CommentaryDetailsTrigger.phone') as typeof import('./CommentaryDetailsTrigger.phone')).default
  : WebCommentaryDetailsTrigger)
