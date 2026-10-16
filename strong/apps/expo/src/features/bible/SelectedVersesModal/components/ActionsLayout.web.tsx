import { Children, isValidElement } from 'react'
import { ScrollView } from 'react-native'
import Box from '~common/ui/Box'
import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import type { ActionsLayoutProps } from './ActionsLayout'

export default function ActionsLayout({ children, width }: ActionsLayoutProps) {
  // CyberJudah: the phone app's single scrolling row (ActionsLayout.tsx) when inside the Telegram app.
  if (isEmbeddedInCyberJudah()) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        style={{ width }}
      >
        {children}
      </ScrollView>
    )
  }
  return (
    <Box className="flex-row flex-wrap" style={{ width, flexShrink: 0 }}>
      {Children.toArray(children).map(child => (
        <Box key={isValidElement(child) ? child.key : String(child)} className="w-1/4 items-center">
          {child}
        </Box>
      ))}
    </Box>
  )
}
