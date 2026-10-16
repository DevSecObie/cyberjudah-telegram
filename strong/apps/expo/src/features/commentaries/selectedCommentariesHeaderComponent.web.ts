// CyberJudah web build: the reorderable list (drag and drop) shows only inside the commentary
// picker, once opened, so its code loads then (or in the background once the first chapter has
// painted).
import { deferredComponent } from '~helpers/deferred'

export default deferredComponent(() => import('./SelectedCommentariesHeader'))
