// CyberJudah web build: the reader opens on its Bible tab, so the screens of the other kinds of
// tab load when a tab of that kind is first shown (or in the background once the first chapter
// has painted). The Bible tab's screen stays in the main bundle (TabScreen.tsx).
import { deferredComponent } from '~helpers/deferred'

export const CompareVersesTabScreen = deferredComponent(
  () => import('~features/bible/CompareVersesTabScreen')
)
export const StrongTabScreen = deferredComponent(() => import('~features/lexique/StrongTabScreen'))
export const CommentariesTabScreen = deferredComponent(
  () => import('~features/commentaries/CommentariesTabScreen')
)
export const CommentaryResourceTabScreen = deferredComponent(
  () => import('~features/commentaries/CommentaryResourceTabScreen')
)
export const InvalidCommentaryTabScreen = deferredComponent(
  () => import('~features/commentaries/InvalidCommentaryTabScreen')
)
export const DictionaryTabScreen = deferredComponent(
  () => import('~features/dictionnary/DictionaryTabScreen')
)
export const NaveTabScreen = deferredComponent(() => import('~features/nave/NaveTabScreen'))
export const NotesTabScreen = deferredComponent(() => import('~features/notes/NotesTabScreen'))
export const PlanTabScreen = deferredComponent(() => import('~features/plans/PlanTabScreen'))
export const SearchTabScreen = deferredComponent(() => import('~features/search/SearchTabScreen'))
export const StudiesTabScreen = deferredComponent(
  () => import('~features/studies/StudiesTabScreen')
)
export const TimelineTabScreen = deferredComponent(
  () => import('~features/timeline/TimelineTabScreen')
)
export const NewTabScreen = deferredComponent(() => import('./NewTab/NewTabScreen'))
