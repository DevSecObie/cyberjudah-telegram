import { resolveFontFamily } from '~themes/styleValues'
import { useTheme as useStylingTheme } from '~themes/ThemeProvider'
import { pageContentStyle } from '~common/ui/PageContent'
import { useTranslation } from 'react-i18next'
import { SectionList, useWindowDimensions } from 'react-native'
import Header from '~common/Header'
import Box, { SafeAreaBox, VStack } from '~common/ui/Box'
import Text from '~common/ui/Text'
import {
  useTeachings,
  openTeaching,
  type StrongTeaching,
} from '~features/home/useTeachings'
import PassageMediaLibraryCard from './PassageMediaLibraryCard'
const PassageMediaLibraryScreen = () => {
  const stylingTheme = useStylingTheme()

  const { t } = useTranslation()
  const feed = useTeachings()
  const { width: windowWidth } = useWindowDimensions()
  const episodes = feed.data?.teachings ?? []
  const contentWidth = Math.min(windowWidth, 760)
  const thumbnailWidth = Math.min(
    176,
    Math.max(128, (contentWidth - 40) * 0.38)
  )
  const sections: { title: string; data: StrongTeaching[] }[] = episodes.length
    ? [
        {
          title: t('Latest Teachings'),
          data: episodes,
        },
      ]
    : []

  return (
    <SafeAreaBox className="overflow-hidden border-continuous bg-reverse">
      <Header hasBackButton background title={t('passageMediaLibrary.title')} />
      <SectionList
        sections={sections}
        keyExtractor={item => item.url}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          pageContentStyle,
          {
            width: '100%',
            maxWidth: contentWidth,
            alignSelf: 'center',
            paddingHorizontal: 20,
            paddingTop: 24,
            paddingBottom: 48,
          },
        ]}
        ListHeaderComponent={
          <VStack className="overflow-hidden border-continuous mb-[22px] gap-[5px]">
            <Text
              className="text-[25px] leading-[31px]"
              style={{
                fontFamily: resolveFontFamily(stylingTheme.fontFamily.title),
              }}
            >
              {t('passageMediaLibrary.heading')}
            </Text>
            <Text
              className="text-grey text-[15px] leading-[21px]"
              style={{
                fontFamily: resolveFontFamily(stylingTheme.fontFamily.text),
              }}
            >
              {t('passageMediaLibrary.subtitle')}
            </Text>
          </VStack>
        }
        renderSectionHeader={({ section }) => (
          <Box className="overflow-hidden border-continuous bg-reverse pt-[30px] pb-[20px]">
            <Text
              className="text-[19px]"
              style={{
                fontFamily: resolveFontFamily(stylingTheme.fontFamily.title),
              }}
            >
              {section.title}
            </Text>
          </Box>
        )}
        renderItem={({ item }) => (
          <PassageMediaLibraryCard
            item={item}
            thumbnailWidth={thumbnailWidth}
            onPress={() => openTeaching(item)}
          />
        )}
        ListEmptyComponent={
          <Box className="overflow-hidden border-continuous py-[60px] items-center justify-center">
            <Text className="text-grey text-center">
              {feed.isPending
                ? t('Loading classes…')
                : feed.isError
                  ? t('Classes could not be loaded. Please try again.')
                  : t('passageMediaLibrary.empty')}
            </Text>
          </Box>
        }
      />
    </SafeAreaBox>
  )
}

export default PassageMediaLibraryScreen
