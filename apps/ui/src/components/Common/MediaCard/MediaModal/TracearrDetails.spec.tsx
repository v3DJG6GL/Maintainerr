import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MediaPlaybackSummary } from '@maintainerr/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  render as renderComponent,
  screen,
  fireEvent,
} from '../../../../test-utils/render'
import { createTestQueryClient } from '../../../../test-utils/queryClient'
import { createDeferred } from '../../../../test-utils/createDeferred'
import TracearrDetails from './TracearrDetails'

const getApiHandler = vi.fn()
vi.mock('../../../../utils/ApiHandler', () => ({
  default: (url: string) => getApiHandler(url),
}))

const render = (ui: ReactNode) => {
  const client = createTestQueryClient()
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  )
  const result = renderComponent(wrap(ui))
  return {
    ...result,
    rerender: (node: ReactNode) => result.rerender(wrap(node)),
  }
}

const summary: MediaPlaybackSummary = {
  source: 'tracearr',
  playCount: 3,
  totalWatchTimeMs: 90_000,
  lastPlayedAt: '2026-01-02T12:00:00Z',
}

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
  })

describe('TracearrDetails', () => {
  beforeEach(() => {
    getApiHandler.mockReset()
  })

  it.each([
    [0, '0 sec'],
    [500, '1 sec'],
    [20_000, '20 sec'],
    [90_000, '1 min 30 sec'],
    [3_661_000, '1 hr 1 min 1 sec'],
  ])(
    'formats %s milliseconds without losing short plays',
    async (milliseconds, expected) => {
      getApiHandler.mockResolvedValue({
        ...summary,
        totalWatchTimeMs: milliseconds,
      })
      render(<TracearrDetails itemId="item" sourceKey="server" />)
      await screen.findByText(expected)
      expect(screen.getByText('Tracearr')).toBeTruthy()
      expect(
        screen.getByText('Includes recorded plays that were not completed.'),
      ).toBeTruthy()
      expect(getApiHandler).toHaveBeenCalledWith(
        '/media-analytics/items/item?source=tracearr',
      )
    },
  )

  it('distinguishes unknown values from confirmed zero history', async () => {
    getApiHandler.mockResolvedValueOnce({
      ...summary,
      playCount: null,
      totalWatchTimeMs: null,
      lastPlayedAt: null,
    })
    const { rerender } = render(
      <TracearrDetails itemId="unknown" sourceKey="server" />,
    )
    await screen.findAllByText('-')
    expect(screen.getAllByText('-')).toHaveLength(3)
    expect(screen.queryByText('No watch history recorded yet.')).toBeNull()
    getApiHandler.mockResolvedValueOnce({
      ...summary,
      playCount: 0,
      totalWatchTimeMs: 0,
      lastPlayedAt: null,
    })
    rerender(<TracearrDetails itemId="empty" sourceKey="server" />)
    await screen.findByText('No watch history recorded yet.')
    expect(screen.getByText('0 sec')).toBeTruthy()
  })

  it('retries 503 without showing empty history or falling back to another source', async () => {
    getApiHandler
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(summary)
    render(<TracearrDetails itemId="item" sourceKey="server" />)
    await screen.findByText('Failed to load Tracearr data')
    expect(screen.queryByText('No watch history recorded yet.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('1 min 30 sec')
    expect(getApiHandler).toHaveBeenCalledTimes(2)
    expect(getApiHandler).toHaveBeenLastCalledWith(
      '/media-analytics/items/item?source=tracearr',
    )
  })

  it('labels a missing item separately from a successful zero', async () => {
    getApiHandler.mockRejectedValue(httpError(404))
    render(<TracearrDetails itemId="missing" sourceKey="server" />)
    await screen.findByText('No Tracearr data available for this item.')
    expect(screen.queryByText('No watch history recorded yet.')).toBeNull()
  })

  it('does not show data from the previous analytics server while loading', async () => {
    getApiHandler.mockResolvedValueOnce(summary)
    const { rerender } = render(
      <TracearrDetails itemId="item" sourceKey="first" />,
    )
    await screen.findByText('1 min 30 sec')
    const next = createDeferred<MediaPlaybackSummary>()
    getApiHandler.mockReturnValueOnce(next.promise)
    rerender(<TracearrDetails itemId="item" sourceKey="second" />)
    expect(screen.queryByText('1 min 30 sec')).toBeNull()
    next.resolve({ ...summary, totalWatchTimeMs: 20_000 })
    await screen.findByText('20 sec')
  })
})
