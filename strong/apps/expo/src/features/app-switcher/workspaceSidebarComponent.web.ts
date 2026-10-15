// CyberJudah web build: the sidebar shows only on a wide screen (never in the Telegram app), so its
// code (drag and drop, group menus) loads when it is first shown, and is fetched in the background
// (once the first chapter has painted) only on a wide screen.
import { deferredComponent } from '~helpers/deferred'
import { WORKSPACE_SIDEBAR_BREAKPOINT } from './utils/useResponsiveWorkspace'

export default deferredComponent(() => import('./WorkspaceSidebar'), {
  prefetch: () => window.innerWidth >= WORKSPACE_SIDEBAR_BREAKPOINT,
})
