import { useEffect, useState, useSyncExternalStore } from 'react'
import { Appearance } from 'react-native'
import { useSelector } from 'react-redux'
import { useThemeSelectionOverride } from '~common/ThemeSelectionOverrideContext'
import { RootState } from '~redux/modules/reducer'
import { getAppColorScheme, subscribeAppColorScheme } from './cyberjudahBridge'

const useCurrentThemeSelector = () => {
  const themeSelectionOverride = useThemeSelectionOverride()
  const preferredColorScheme = useSelector(
    (state: RootState) => state.user.bible.settings.preferredColorScheme || 'auto'
  )
  const preferredLightTheme = useSelector(
    (state: RootState) => state.user.bible.settings.preferredLightTheme || 'default'
  )
  const preferredDarkTheme = useSelector(
    (state: RootState) => state.user.bible.settings.preferredDarkTheme || 'dark'
  )

  const [systemColorScheme, setSystemColorScheme] = useState(() => Appearance.getColorScheme())

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemColorScheme(colorScheme)
    })

    return () => subscription.remove()
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => {
      setSystemColorScheme(Appearance.getColorScheme())
    })
  }, [preferredColorScheme])

  // CyberJudah: inside the Telegram app, "auto" follows Telegram's light or dark.
  const appColorScheme = useSyncExternalStore(subscribeAppColorScheme, getAppColorScheme)
  const computedTheme = (() => {
    if (preferredColorScheme === 'auto') {
      if ((appColorScheme ?? systemColorScheme) === 'dark') {
        return preferredDarkTheme
      }
      return preferredLightTheme
    }

    if (preferredColorScheme === 'dark') return preferredDarkTheme
    return preferredLightTheme
  })()

  return (
    themeSelectionOverride ?? {
      theme: computedTheme,
      colorScheme: (['default', 'sepia', 'nature', 'sunset'].includes(computedTheme)
        ? 'light'
        : 'dark') as 'light' | 'dark',
    }
  )
}

export default useCurrentThemeSelector
