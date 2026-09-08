import type {
  MediaPlaybackDetails,
  MediaAnalyticsSource,
} from '@maintainerr/contracts'
import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import GetApiHandler from '../utils/ApiHandler'

interface MediaAnalyticsCapabilities {
  sources: MediaAnalyticsSource[]
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

export const useMediaPlaybackDetails = (
  itemId: string,
  source: MediaAnalyticsSource,
  sourceKey: string,
) =>
  useQuery({
    queryKey: ['media-analytics', sourceKey, source, 'item-details', itemId],
    queryFn: async (): Promise<MediaPlaybackDetails | null> => {
      try {
        return await GetApiHandler<MediaPlaybackDetails>(
          `/media-analytics/items/${encodeURIComponent(itemId)}/details?source=${source}`,
        )
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) return null
        throw error
      }
    },
    staleTime: 30_000,
    retry: false,
  })
