import { Asset } from 'expo-asset'
import { Platform } from 'react-native'
import type { Plan } from '~common/types'

let pending: Promise<Plan[]> | undefined
export const loadReadingPlans = (): Promise<Plan[]> => {
  pending ??= (async () => {
    const [asset] = await Asset.loadAsync(require('~assets/plans/cyberjudah-plans.txt'))
    if (Platform.OS !== 'web' && asset.localUri) {
      const files = await import('expo-file-system/legacy')
      return JSON.parse(await files.readAsStringAsync(asset.localUri)) as Plan[]
    }
    const response = await fetch(asset.uri)
    if (!response.ok) throw new Error(`Reading plans could not be loaded: HTTP ${response.status}`)
    return response.json() as Promise<Plan[]>
  })().catch(error => { pending = undefined; throw error })
  return pending
}

export const loadReadingPlan = async (id: string) => {
  const plan = (await loadReadingPlans()).find(plan => plan.id === id)
  if (!plan) throw new Error('Reading content is unavailable')
  return plan
}
