import { trackAnalyticsScreen } from '~helpers/analytics'
import { useWorkspaceRoutePanel } from '~navigation/useWorkspaceRoutePanel'
import WorkspaceLayout from '~features/app-switcher/WorkspaceLayout'
import * as Sentry from '~helpers/sentry'
import { Stack, useLocalSearchParams, usePathname, useSegments } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { RootSiblingParent } from 'react-native-root-siblings'
import TrackPlayer from 'react-native-track-player'

import InitHooks from '~common/InitHooks'
import { SheetProvider } from '~common/sheet'
import ThemedToaster from '~common/ThemedToaster'
import { AppSwitcherProvider } from '~features/app-switcher/AppSwitcherProvider'
import { BookSelectorSheetProvider } from '~features/bible/BookSelectorSheet/BookSelectorSheetProvider'
import { StrongAudioProvider } from '~features/bible/StrongAudioProvider'
import { appLogger } from '~helpers/agentObservability'
import { createFormSheetOptions } from '~navigation/formSheetOptions'
import type { Theme } from '~themes/index'
import { PlaybackService } from '../../../playbackService'
import { useWebAuthStatus } from './useWebAuthStatus'
import { isPublicContentPath } from '~navigation/publicContentRoutes'
import { PublicShellProvider } from '~navigation/PublicShellContext'
import { resolvePublicShellMode } from './publicShellPolicy'
import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import CyberJudahAppBridge from './CyberJudahAppBridge'
import { useSelector } from 'react-redux'
import { selectUserLoginInfo } from '~redux/selectors/user'
import { assistantAccessible } from '~features/study-assistant/assistantConfig'
import { deferredComponent, prefetchDeferredWhenIdle, useFirstPaintDone } from '~helpers/deferred'
// Modules that hold deferred screens and sheet parts, evaluated now so the idle prefetch knows them
// (inline requires would otherwise evaluate each only when its screen is first shown).
// In the order they are prefetched: the reader's own sheets first.
import '~common/stylizedHTMLViewComponent'
import '~common/colorPickerComponent'
import '~features/commentaries/selectedCommentariesHeaderComponent'
import '~common/alphabetListComponent'
import '~features/app-switcher/TabScreen/tabScreenComponents'
import '~features/app-switcher/AppSwitcherScreen/drawerScreens'
import '~features/app-switcher/workspaceSidebarComponent'

// CyberJudah web build: what renders nothing until it is opened is mounted, and its code loaded,
// once the first chapter has painted.
const WorkspaceAnalytics = deferredComponent(
  () => import('~features/app-switcher/WorkspaceAnalytics.web')
)
const ConfirmDialogHost = deferredComponent(
  () => import('~common/ConfirmDialog/ConfirmDialogHost.web')
)
const ChangelogModal = deferredComponent(() => import('~common/Changelog'))
const UnifiedTagsModal = deferredComponent(() => import('~common/UnifiedTagsModal'))
const ReferencePreviewHost = deferredComponent(
  () => import('~features/bibleReferencePreview/ReferencePreviewHost')
)
const ColorPickerModal = deferredComponent(() => import('~common/ColorPickerModal'))
const ColorChangeModal = deferredComponent(() => import('~common/ColorChangeModal'))
const AccessibleAssistantLauncher = deferredComponent(
  () => import('~features/study-assistant/AssistantLauncher.web'),
  { prefetch: false }
)

/** The assistant's code is loaded only for an account that can use it (as it renders nothing else). */
const AssistantLauncher = () => {
  const { id } = useSelector(selectUserLoginInfo)
  return assistantAccessible(id) ? <AccessibleAssistantLauncher /> : null
}

const NavigationTracking = () => {
  const pathname = usePathname()
  const segments = useSegments()
  const params = useLocalSearchParams()
  const previousPathname = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (previousPathname.current === pathname) return
    const screenName = segments[segments.length - 1] || 'index'
    appLogger.info('navigation', 'screen.changed', { pathname, screenName, segments })
    void trackAnalyticsScreen(segments)
    Sentry.addBreadcrumb({
      category: 'screen',
      message: `Navigated to: ${pathname}`,
      data: { pathname, segments, params: Object.keys(params).length ? params : undefined },
    })
    previousPathname.current = pathname
  }, [params, pathname, segments])

  return null
}

const FullAppRuntime = ({ theme }: { theme: Theme }) => {
  const panel = useWorkspaceRoutePanel()
  const pathname = usePathname()
  const authStatus = useWebAuthStatus()
  // CyberJudah: inside the Telegram app a chapter link opens the reader itself, not the public page.
  const [guestWorkspaceRequested, setGuestWorkspaceRequested] = useState(isEmbeddedInCyberJudah)
  const publicPath = isPublicContentPath(pathname)
  const publicShellMode = resolvePublicShellMode({
    publicPath,
    authStatus,
    guestWorkspaceRequested,
  })
  const authPending = publicShellMode === 'pending'
  const painted = useFirstPaintDone()
  const publicShellActive = publicShellMode === 'public'
  useEffect(() => {
    void TrackPlayer.registerPlaybackService(() => PlaybackService)
    prefetchDeferredWhenIdle()
  }, [])

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          marginRight: !publicShellActive && panel.open ? panel.reservedWidth : 0,
          ...{
            transitionProperty: 'margin-right',
            transitionDuration: '240ms',
            transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
          },
        },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="(timeline-search)"
        options={createFormSheetOptions(theme, { sheetAllowedDetents: [1] })}
      />
      <Stack.Screen
        name="(explore)"
        options={createFormSheetOptions(theme, { sheetAllowedDetents: [0.45, 1] })}
      />
      <Stack.Screen
        name="(commentary)"
        options={createFormSheetOptions(theme, { sheetAllowedDetents: [1] })}
      />
      <Stack.Screen name="(library)" />
      <Stack.Screen
        name="strong"
        options={createFormSheetOptions(theme, { sheetAllowedDetents: [1] })}
      />
    </Stack>
  )

  return (
    <AppSwitcherProvider>
      <RootSiblingParent>
        <SheetProvider>
          <BookSelectorSheetProvider>
            <StrongAudioProvider>
              <InitHooks />
              <NavigationTracking />
              <CyberJudahAppBridge />
              <PublicShellProvider
                active={publicShellActive}
                openWorkspace={() => setGuestWorkspaceRequested(true)}
              >
                <WorkspaceLayout mode={publicShellMode}>{stack}</WorkspaceLayout>
              </PublicShellProvider>
              {!publicShellActive && !authPending && painted && <WorkspaceAnalytics />}
              {!publicShellActive && !authPending && <AssistantLauncher />}
              {!publicShellActive && !authPending && painted && <ConfirmDialogHost />}
              <ThemedToaster />
              {!publicShellActive && !authPending && painted && <ChangelogModal />}
              {!publicShellActive && !authPending && painted && <UnifiedTagsModal />}
              {painted && <ReferencePreviewHost />}
              {!publicShellActive && !authPending && painted && <ColorPickerModal />}
              {!publicShellActive && !authPending && painted && <ColorChangeModal />}
            </StrongAudioProvider>
          </BookSelectorSheetProvider>
        </SheetProvider>
      </RootSiblingParent>
    </AppSwitcherProvider>
  )
}

export default FullAppRuntime
