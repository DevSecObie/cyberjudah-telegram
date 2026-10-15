// CyberJudah web build: the colour picker (reanimated-color-picker) shows only inside a sheet,
// once opened, so its code loads then (or in the background once the first chapter has painted).
import { deferredComponent } from '~helpers/deferred'

export default deferredComponent(() => import('./ColorPicker'))
