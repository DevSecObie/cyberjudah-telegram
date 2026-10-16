// CyberJudah web build: the letter list (a carousel) shows only inside the search sheet, once
// opened, so its code loads then (or in the background once the first chapter has painted).
import { deferredComponent } from '~helpers/deferred'

export default deferredComponent(() => import('./AlphabetList'))
