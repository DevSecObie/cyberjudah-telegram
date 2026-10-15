// CyberJudah web build: the Home and More drawers render only once opened, so their code loads
// then. They open from the bottom bar, which the reader inside the Telegram app leaves out, so
// they are fetched in the background (once the first chapter has painted) only outside it.
import type { ComponentProps } from 'react'
import type { Home as HomeScreen } from '~features/home/HomeScreen'
import type { More as MoreScreen } from '~features/settings/MoreScreen'
import { isEmbeddedInCyberJudah } from '~helpers/cyberjudahEmbed'
import { deferredComponent } from '~helpers/deferred'

const prefetch = () => !isEmbeddedInCyberJudah()

export const Home = deferredComponent<ComponentProps<typeof HomeScreen>>(
  () =>
    import('~features/home/HomeScreen').then(module => ({
      default: module.Home,
    })),
  { prefetch }
)
export const More = deferredComponent<ComponentProps<typeof MoreScreen>>(
  () =>
    import('~features/settings/MoreScreen').then(module => ({
      default: module.More,
    })),
  { prefetch }
)
