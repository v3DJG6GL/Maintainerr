import type { MediaPlaybackSummary } from '@maintainerr/contracts'
import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import GetApiHandler from '../utils/ApiHandler'

interface MediaAnalyticsCapabilities {
  sources: MediaPlaybackSummary['source'][]
}

export const useMediaAnalyticsCapabilities = (sourceKey = 'active') =>
  useQuery({
    queryKey: ['media-analytics', sourceKey, 'capabilities'],
    queryFn: () =>
      GetApiHandler<MediaAnalyticsCapabilities>(
        '/media-analytics/capabilities',
      ),
    staleTime: 30_000,
    retry: false,
  })

export const useMediaPlaybackSummary = (
  itemId: string,
  source: MediaPlaybackSummary['source'],
  sourceKey: string,
) =>
  useQuery({
    queryKey: ['media-analytics', sourceKey, source, 'item', itemId],
    queryFn: async (): Promise<MediaPlaybackSummary | null> => {
      try {
        return await GetApiHandler<MediaPlaybackSummary>(
          `/media-analytics/items/${encodeURIComponent(itemId)}?source=${source}`,
        )
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) return null
        throw error
      }
    },
    staleTime: 30_000,
    retry: false,
  })
