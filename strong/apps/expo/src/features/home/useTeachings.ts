import { useQuery } from '@tanstack/react-query'
import { Linking, Platform } from 'react-native'
import type {
  StrongTeaching,
  StrongTeachings,
} from '../../../../../../shared/strong-teachings'

export type { StrongTeaching }

export function useTeachings() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return useQuery({
    queryKey: ['cyberjudah-teachings', timeZone],
    // Reachability probes can be blocked in Telegram; a failed request must finish as an error.
    networkMode: 'always',
    queryFn: async (): Promise<StrongTeachings> => {
      const response = await fetch(
        `/app/strong/_content/teachings?timeZone=${encodeURIComponent(timeZone)}`
      )
      if (!response.ok)
        throw new Error('Classes could not be loaded. Please try again.')
      return response.json()
    },
    staleTime: 600_000,
    refetchInterval: query =>
      query.state.data?.feedOk === false ? 60_000 : 600_000,
    retry: 1,
  })
}

export function teachingDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return date
  return new Date(
    Date.UTC(+match[1], +match[2] - 1, +match[3])
  ).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export const teachingSubtitle = (teaching: StrongTeaching) =>
  [teaching.sub, teachingDate(teaching.date), teaching.teacher]
    .filter(Boolean)
    .join(' · ')

/** Keep the existing class notes and pending-recording controls throughout the fork migration. */
export function openTeaching(teaching: StrongTeaching) {
  const path =
    teaching.pending && teaching.video
      ? `/app/watch/${encodeURIComponent(teaching.video)}`
      : `/app/note${teaching.url}`
  if (Platform.OS === 'web') window.location.assign(path)
  else void Linking.openURL(`https://cyberjudah.io${path}`)
}
