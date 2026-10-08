import { getEvents } from '../events.web'

jest.mock('expo-constants', () => ({ expoConfig: { extra: { resourceApiUrl: '/bs' } } }))

describe('CyberJudah timeline service', () => {
  afterEach(() => jest.restoreAllMocks())

  it('loads the published CyberJudah sections', async () => {
    const sections = [{ id: 1, events: [] }]
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(sections), { status: 200 }))
    await expect(getEvents()).resolves.toEqual(sections)
    expect(fetcher).toHaveBeenCalledWith('/bs/v1/timelines/en/sections')
  })

  it('reports unavailable assets instead of treating an error response as sections', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await expect(getEvents()).rejects.toThrow('TIMELINE_HTTP_404')
  })
})
