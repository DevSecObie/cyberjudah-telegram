import Constants from 'expo-constants'
import type { TimelineSection } from './types'

// Geometry and content are published together by CyberJudah, including CMS changes.
export const getEvents = async (): Promise<TimelineSection[]> => {
  const baseUrl = (Constants.expoConfig?.extra?.resourceApiUrl as string | undefined) || '/bs'
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/timelines/en/sections`)
  if (!response.ok) throw new Error(`TIMELINE_HTTP_${response.status}`)
  return response.json()
}
