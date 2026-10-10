import { Platform } from 'react-native'
import { isEmbeddedInCyberJudah } from './cyberjudahEmbed'

/**
 * CyberJudah: true where the reader should look and behave as Bible Strong's phone app: on a phone,
 * and inside the Telegram app (always a phone). False only for the website on a computer.
 */
export const isPhoneUI = (): boolean => Platform.OS !== 'web' || isEmbeddedInCyberJudah()
