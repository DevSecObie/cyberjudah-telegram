// CyberJudah web build: the HTML renderer shows only inside the Strong's sheet, once opened,
// so its code loads then (or in the background once the first chapter has painted).
import { deferredComponent } from '~helpers/deferred'

export default deferredComponent(() => import('./StylizedHTMLView'))
