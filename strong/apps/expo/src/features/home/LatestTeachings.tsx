import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'
import Box, { HStack, TouchableBox, VStack } from '~common/ui/Box'
import Text from '~common/ui/Text'
import { usePushRouteOnce } from '~navigation/usePushRouteOnce'
import { openTeaching, teachingSubtitle, useTeachings } from './useTeachings'

/** The owner's existing thumbnail-and-text rows, preserved inside the upstream Home layout. */
export default function LatestTeachings() {
  const { t } = useTranslation()
  const pushRoute = usePushRouteOnce()
  const feed = useTeachings()
  // The upstream Classes card opens the library; it is not a separate featured-class row.
  // Keep the newest teaching here so it is visible by title and date on Home.
  const rows = feed.data?.teachings.slice(0, 8) ?? []

  return (
    <VStack
      testID="latest-teachings"
      className="px-[12px] pt-[20px] pb-[32px] gap-[4px]"
    >
      <HStack className="items-center justify-between pl-[2px] pr-[8px] mb-[6px]">
        <Text accessibilityRole="header" className="font-bold text-[19px]">
          {t('Latest Teachings')}
        </Text>
        <TouchableBox
          accessibilityRole="button"
          onPress={() => pushRoute({ pathname: '/(library)/passage-media' })}
        >
          <Text className="text-[15px] font-semibold">{t('All classes')}</Text>
        </TouchableBox>
      </HStack>
      {feed.isPending && (
        <Text className="text-grey">{t('Loading classes…')}</Text>
      )}
      {feed.isError && (
        <Text accessibilityRole="alert" className="text-grey">
          {t('Classes could not be loaded. Please try again.')}
        </Text>
      )}
      <VStack className="gap-[14px]">
        {rows.map(teaching => (
          <TouchableBox
            key={teaching.url}
            accessibilityRole="button"
            accessibilityLabel={teaching.title}
            onPress={() => openTeaching(teaching)}
            activeOpacity={0.82}
            className="flex-row items-start gap-[12px] p-[4px] rounded-[16px]"
          >
            <Box
              className="w-[124px] rounded-[14px] overflow-hidden bg-black"
              style={{ aspectRatio: 16 / 9 }}
            >
              <Image
                source={{ uri: teaching.thumb }}
                contentFit="cover"
                style={{ width: '100%', height: '100%' }}
              />
              <Box
                className="absolute left-[6px] bottom-[6px] rounded-[6px] px-[6px] py-[2px]"
                style={{ maxWidth: 112, backgroundColor: 'rgba(5,7,15,0.82)' }}
              >
                <Text
                  className="text-white text-[12px] leading-[17px] font-semibold"
                  numberOfLines={1}
                >
                  {teaching.label}
                </Text>
              </Box>
            </Box>
            <VStack className="flex-1 min-w-0 gap-[4px]">
              <Text
                className="font-semibold text-[15px] leading-[19.5px]"
                numberOfLines={3}
              >
                {teaching.title}
              </Text>
              <Text
                className="text-grey text-[13px] leading-[17.5px]"
                numberOfLines={2}
              >
                {teachingSubtitle(teaching)}
              </Text>
              {teaching.pending && (
                <Text className="text-grey text-[12px]">
                  {t('Notes coming soon')}
                </Text>
              )}
            </VStack>
          </TouchableBox>
        ))}
      </VStack>
      {feed.data?.feedOk === false && (
        <Text className="text-grey text-[13px]">
          {t('New uploads may be delayed. Saved classes are still available.')}
        </Text>
      )}
      {!!feed.data?.unavailable.length && (
        <Text className="text-grey text-[13px]">
          {t('Some classes could not be refreshed. Please try again.')}
        </Text>
      )}
    </VStack>
  )
}
