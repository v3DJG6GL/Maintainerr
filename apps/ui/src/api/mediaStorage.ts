import type { MediaStorageDetails } from '@maintainerr/contracts'
import { useQuery } from '@tanstack/react-query'
import GetApiHandler from '../utils/ApiHandler'

export const useMediaStorageDetails = (
  itemId: string,
  serverId: string | null | undefined,
) =>
  useQuery({
    queryKey: ['media-storage', serverId, itemId],
    enabled: serverId != null,
    queryFn: async (): Promise<MediaStorageDetails | null> => {
      const data = await GetApiHandler<MediaStorageDetails>(
        `/media-server/meta/${encodeURIComponent(itemId)}/storage`,
      )
      return data && Array.isArray(data.files) && Array.isArray(data.folders)
        ? data
        : null
    },
    staleTime: 30_000,
    retry: false,
  })
