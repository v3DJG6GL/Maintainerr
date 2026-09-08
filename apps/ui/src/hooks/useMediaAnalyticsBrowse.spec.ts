import axios from 'axios'
import { act, renderHook } from '../test-utils/render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useMediaAnalyticsBrowse,
  type AnalyticsBrowseRequest,
} from './useMediaAnalyticsBrowse'

const request: AnalyticsBrowseRequest = {
  scope: 'search',
  id: 'Sample',
  sort: 'tracearrWatchTime',
  sortOrder: 'desc',
  offset: 0,
  limit: 30,
}
const ready = {
  status: 'ready',
  snapshotId: 'first',
  updatedAt: '2026-09-08',
  totalSize: 60,
  items: [{ id: 'item-1' }],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useMediaAnalyticsBrowse', () => {
  it('polls visible preparation and pins subsequent pages to the completed snapshot', async () => {
    vi.useFakeTimers()
    const get = vi
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: {
          status: 'preparing',
          snapshotId: 'first',
          completed: 10,
          total: 60,
        },
      })
      .mockResolvedValue({ data: ready })
    const { result } = renderHook(() => useMediaAnalyticsBrowse())
    let promise: Promise<unknown>
    await act(async () => {
      promise = result.current.fetchPage(request)
      await Promise.resolve()
    })
    expect(result.current.feedback).toEqual({
      status: 'preparing',
      completed: 10,
      total: 60,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
      await promise
    })
    expect(result.current.feedback).toEqual({
      status: 'ready',
      updatedAt: ready.updatedAt,
    })
    await act(async () => {
      await result.current.fetchPage({ ...request, offset: 30 })
    })
    const url = new URL(String(get.mock.calls[2]?.[0]), 'http://localhost')
    expect(url.searchParams.get('snapshotId')).toBe('first')
    expect(url.searchParams.get('offset')).toBe('30')
    expect(url.searchParams.get('scope')).toBe('search')
    expect(url.searchParams.get('sort')).toBe('tracearrWatchTime')
  })

  it('cancels an old source and never shows its late preparation state', async () => {
    let resolveOld: (value: unknown) => void
    const get = vi
      .spyOn(axios, 'get')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValue({ data: { ...ready, snapshotId: 'second' } })
    const { result, unmount } = renderHook(() => useMediaAnalyticsBrowse())
    let old: Promise<unknown>
    await act(async () => {
      old = result.current.fetchPage(request).catch(() => undefined)
    })
    await act(async () => {
      await result.current.fetchPage({
        ...request,
        sort: 'streamystatsPlayCount',
      })
    })
    expect(get.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await act(async () => {
      resolveOld({
        data: {
          status: 'preparing',
          snapshotId: 'first',
          completed: 1,
          total: 99,
        },
      })
      await old
    })
    expect(result.current.feedback).toEqual({
      status: 'ready',
      updatedAt: ready.updatedAt,
    })
    unmount()
    expect(get.mock.calls[1]?.[1]?.signal?.aborted).toBe(true)
  })

  it('stops at the absolute preparation deadline even when polling is delayed', async () => {
    vi.useFakeTimers()
    const get = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        status: 'preparing',
        snapshotId: 'first',
        completed: 1,
        total: 60,
      },
    })
    const { result } = renderHook(() => useMediaAnalyticsBrowse())
    let pending: Promise<unknown>
    await act(async () => {
      pending = result.current.fetchPage(request).catch(() => undefined)
      await Promise.resolve()
    })
    vi.setSystemTime(Date.now() + 30 * 60_000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
      await pending
    })
    expect(result.current.feedback?.status).toBe('error')
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('surfaces expiry and starts a fresh snapshot only after explicit cancellation/retry', async () => {
    const get = vi
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: ready })
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } })
      .mockResolvedValue({ data: { ...ready, snapshotId: 'fresh' } })
    const { result } = renderHook(() => useMediaAnalyticsBrowse())
    await act(async () => {
      await result.current.fetchPage(request)
    })
    await act(async () => {
      await result.current
        .fetchPage({ ...request, offset: 30 })
        .catch(() => undefined)
    })
    expect(result.current.feedback?.status).toBe('error')
    await act(async () => {
      result.current.cancel()
      await result.current.fetchPage(request)
    })
    expect(
      new URL(
        String(get.mock.calls[2]?.[0]),
        'http://localhost',
      ).searchParams.has('snapshotId'),
    ).toBe(false)
  })
})
