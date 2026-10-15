// CyberJudah web build: the capture code (html2canvas) loads the first time a tab preview is taken;
// captureRef already returns a promise.
import type { captureRef as CaptureRef } from 'react-native-view-shot'

export const captureRef: typeof CaptureRef = (...args) =>
  import('react-native-view-shot').then(module => module.captureRef(...args))
