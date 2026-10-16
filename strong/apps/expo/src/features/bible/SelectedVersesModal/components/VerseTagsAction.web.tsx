import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import { useTranslation } from 'react-i18next'
import ContextualPanel from '~common/ContextualPanel'
import { useEntityTagsScreen } from '~common/ContextualPanel/useEntityTagsScreen'
import Box from '~common/ui/Box'
import Text from '~common/ui/Text'
import { FeatherIcon } from '~common/ui/Icon'
import type { VerseTagsActionProps } from './VerseTagsAction'

function WebVerseTagsAction({ selectedVerses, reference }: VerseTagsActionProps) {
  const { t } = useTranslation()
  const tags = useEntityTagsScreen('highlights', selectedVerses)
  return (
    <ContextualPanel
      width={340}
      accessibilityLabel={t('Éditer les tags')}
      initialScreen="tags"
      onClose={tags.reset}
      trigger={
        <Box className="items-center py-2 gap-2 w-[70px]">
          <Box className="items-center justify-center bg-light-grey rounded-[16px] w-[48px] h-[48px]">
            <FeatherIcon name="tag" size={20} color="primary" />
          </Box>
          <Text className="text-[10px]">{t('Tag')}</Text>
        </Box>
      }
      screens={{
        tags: {
          ...tags.screen,
          headerContent: (
            <>
              <Text className="px-3 text-[12px] text-tertiary">{reference}</Text>
              {tags.screen.headerContent}
            </>
          ),
        },
      }}
    />
  )
}

// CyberJudah: inside the Telegram app the reader is on a phone, so it behaves as Bible Strong's
// phone app does (VerseTagsAction.phone.tsx).
// Loaded only there: the website, and its tests, never load the phone version.
export default (isEmbeddedInCyberJudah()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./VerseTagsAction.phone') as typeof import('./VerseTagsAction.phone')).default
  : WebVerseTagsAction)
