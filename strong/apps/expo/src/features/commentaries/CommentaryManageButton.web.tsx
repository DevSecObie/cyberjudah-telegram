import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import { useTranslation } from 'react-i18next'
import CommentaryMenu from './CommentaryMenu.web'
import Box from '~common/ui/Box'
import Text from '~common/ui/Text'
function WebCommentaryManageButton(_props: { onPress: () => void }) {
  const { t } = useTranslation()
  return (
    <CommentaryMenu
      direct
      accessibilityLabel={t('commentaries.availability.manage')}
      actions={[{ id: 'choose-commentaries', title: t('commentaries.selector.title') }]}
    >
      <Box className="px-[6px] min-h-[44px] items-center justify-center">
        <Text className="text-primary text-[14px] font-bold">
          {t('commentaries.availability.manage')}
        </Text>
      </Box>
    </CommentaryMenu>
  )
}

// CyberJudah: inside the Telegram app the reader is on a phone, so it behaves as Bible Strong's
// phone app does (CommentaryManageButton.phone.tsx).
// Loaded only there: the website, and its tests, never load the phone version.
export default (isEmbeddedInCyberJudah()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./CommentaryManageButton.phone') as typeof import('./CommentaryManageButton.phone')).default
  : WebCommentaryManageButton)
