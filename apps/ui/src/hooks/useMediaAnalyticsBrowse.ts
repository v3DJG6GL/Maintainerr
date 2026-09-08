import { t as globalT } from '@lingui/core/macro'
import type {
  MediaAnalyticsSortField,
  MediaAnalyticsPage,
  MediaItemType,
  MediaSortOrder,
} from '@maintainerr/contracts'
import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_PATH } from '../utils/ApiHandler'

export interface AnalyticsBrowseRequest {
  scope: 'library' | 'collection' | 'exclusions' | 'search'
  id: string
  type?: MediaItemType
  sort: MediaAnalyticsSortField
  sortOrder: MediaSortOrder
  offset: number
  limit: number
}

export type AnalyticsBrowseFeedback =
  | { status: 'preparing'; completed: number; total: number | null }
  | { status: 'error'; message: string }
  | { status: 'ready'; updatedAt: string }

const delay = (signal: AbortSignal, duration: number) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('Cancelled analytics browse'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, duration)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })

/** Pin every page to one source snapshot. A failed/expired snapshot never
 * silently falls back to native sorting or mixes a freshly sorted later page. */
export const useMediaAnalyticsBrowse = (scopeKey = 'active') => {
  const active = useRef<
    | { key: string; controller: AbortController; snapshotId?: string }
    | undefined
  >(undefined)
  const [feedback, setFeedback] = useState<AnalyticsBrowseFeedback>()
  const cancel = useCallback((reason?: 'unavailable') => {
    active.current?.controller.abort()
    active.current = undefined
    setFeedback(
      reason === 'unavailable'
        ? {
            status: 'error',
            message: globalT`The selected analytics source is unavailable. Retry after reconnecting it or choose another sort.`,
          }
        : undefined,
    )
  }, [])
  useEffect(() => {
    cancel()
    return () => {
      active.current?.controller.abort()
      active.current = undefined
    }
  }, [scopeKey, cancel])

  const fetchPage = useCallback(
    async <T>(
      request: AnalyticsBrowseRequest,
    ): Promise<{ totalSize: number; items: T[] }> => {
      const { offset, limit, ...scope } = request
      const key = JSON.stringify(scope)
      if (active.current?.key !== key) {
        active.current?.controller.abort()
        active.current = { key, controller: new AbortController() }
      }
      const current = active.current
      const signal = current.controller.signal
      setFeedback({ status: 'preparing', completed: 0, total: null })
      try {
        // Match the server's acquisition window with an absolute deadline, so
        // slow responses cannot silently extend preparation indefinitely.
        const deadline = Date.now() + 30 * 60_000
        while (Date.now() < deadline) {
          const query = new URLSearchParams({
            ...scope,
            offset: String(offset),
            limit: String(limit),
            ...(current.snapshotId ? { snapshotId: current.snapshotId } : {}),
          })
          const { data } = await axios.get<MediaAnalyticsPage<T>>(
            `${API_BASE_PATH}/api/media-analytics/browse?${query}`,
            {
              signal,
              timeout: Math.max(1, Math.min(30_000, deadline - Date.now())),
            },
          )
          if (signal.aborted || active.current !== current)
            throw new Error('Cancelled analytics browse')
          if (Date.now() >= deadline)
            throw new Error('Analytics preparation timed out')
          if (current.snapshotId && current.snapshotId !== data.snapshotId)
            throw new Error('Analytics snapshot changed')
          current.snapshotId = data.snapshotId
          if (data.status === 'ready') {
            setFeedback({ status: 'ready', updatedAt: data.updatedAt })
            return { totalSize: data.totalSize, items: data.items }
          }
          setFeedback({
            status: 'preparing',
            completed: data.completed,
            total: data.total,
          })
          await delay(
            signal,
            Math.min(2000, Math.max(0, deadline - Date.now())),
          )
        }
        throw new Error('Analytics preparation timed out')
      } catch (error) {
        if (!signal.aborted && active.current === current) {
          const reason: unknown = axios.isAxiosError(error)
            ? error.response?.data?.message
            : undefined
          setFeedback({
            status: 'error',
            message:
              axios.isAxiosError(error) && error.response?.status === 409
                ? globalT`This analytics snapshot expired. Retry to restart from the first page.`
                : typeof reason === 'string' && reason.length > 0
                  ? `${globalT`Analytics sorting is unavailable.`} ${reason}`
                  : globalT`Analytics sorting is unavailable. Retry or choose another sort.`,
          })
        }
        throw error
      }
    },
    [],
  )
  return { fetchPage, cancel, feedback }
}
