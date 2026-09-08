import type { StreamystatsItemDetails } from '@maintainerr/contracts'
import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import GetApiHandler from '../utils/ApiHandler'

export const useStreamystatsItemDetails = (itemId: string, source: string) =>
  useQuery({
    queryKey: ['streamystats', source, 'item-details', itemId],
    queryFn: async (): Promise<StreamystatsItemDetails | null> => {
      try {
        return await GetApiHandler<StreamystatsItemDetails>(
          `/streamystats/items/${encodeURIComponent(itemId)}`,
        )
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) return null
        throw error
      }
    },
    staleTime: 30_000,
    retry: false,
  })
