import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { StreamystatsItemDetails } from '@maintainerr/contracts'
import { act } from '@testing-library/react'
import { createTestQueryClient } from '../../../../../test-utils/queryClient'
import {
  render as renderWithI18n,
  screen,
  waitFor,
  fireEvent,
} from '../../../../../test-utils/render'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StreamystatsStatsPanel from './'

const render = (ui: ReactElement) => {
  const client = createTestQueryClient()
  return renderWithI18n(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
}

const getApiHandler = vi.fn()

vi.mock('../../../../../utils/ApiHandler', () => ({
  default: (url: string) => getApiHandler(url),
}))

describe('StreamystatsStatsPanel', () => {
  beforeEach(() => {
    getApiHandler.mockReset()
  })

  const detailsFor = (name: string): StreamystatsItemDetails => ({
    item: { id: name },
    totalViews: 6,
    totalWatchTime: 3600,
    completionRate: 80,
    firstWatched: null,
    lastWatched: null,
    usersWatched: Array.from({ length: 6 }, (_, index) => ({
      user: { id: `${name}-${index}`, name: `${name} user ${index}` },
      watchCount: 1,
      totalWatchTime: 60,
      completionRate: 80,
      firstWatched: null,
      lastWatched: null,
    })),
    watchHistory: [],
    watchCountByMonth: [],
  })

  it.each([
    { itemId: 'second', itemUrl: 'http://stats/first' },
    { itemId: 'first', itemUrl: 'http://other-stats/first' },
  ])(
    'ignores a late response after switching to $itemId at $itemUrl',
    async (next) => {
      let resolveFirst!: (value: StreamystatsItemDetails) => void
      getApiHandler
        .mockReturnValueOnce(
          new Promise<StreamystatsItemDetails>((resolve) => {
            resolveFirst = resolve
          }),
        )
        .mockResolvedValueOnce(detailsFor('Current'))
      const client = createTestQueryClient()
      const panel = (props: { itemId: string; itemUrl: string }) => (
        <QueryClientProvider client={client}>
          <StreamystatsStatsPanel {...props} />
        </QueryClientProvider>
      )
      const view = renderWithI18n(
        panel({ itemId: 'first', itemUrl: 'http://stats/first' }),
      )
      await waitFor(() => expect(getApiHandler).toHaveBeenCalledTimes(1))
      view.rerender(panel(next))
      expect(await screen.findByText('Current user 0')).toBeTruthy()
      await act(async () => resolveFirst(detailsFor('Previous')))
      expect(screen.queryByText('Previous user 0')).toBeNull()
      expect(screen.getByText('Current user 0')).toBeTruthy()
    },
  )

  it('renders aggregate stats and per-user table on a valid response', async () => {
    getApiHandler.mockResolvedValue({
      item: { id: 'abc' },
      totalViews: 12,
      totalWatchTime: 36000,
      completionRate: 92.4,
      firstWatched: '2026-02-01T00:00:00Z',
      lastWatched: '2026-05-15T00:00:00Z',
      usersWatched: [
        {
          user: { id: 'u1', name: 'alice' },
          watchCount: 5,
          totalWatchTime: 18000,
          completionRate: 95,
          firstWatched: '2026-02-01T00:00:00Z',
          lastWatched: '2026-05-15T00:00:00Z',
        },
      ],
      watchHistory: [],
      watchCountByMonth: [],
    })

    render(
      <StreamystatsStatsPanel
        itemId="abc"
        itemUrl="http://streamystats.local/servers/1/library/abc"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('12')).toBeTruthy()
    })

    expect(screen.getByText('92%')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('shows an empty-state message when no data exists for the item (404)', async () => {
    getApiHandler.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    })

    render(
      <StreamystatsStatsPanel
        itemId="abc"
        itemUrl="http://streamystats.local/servers/1/library/abc"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/no Streamystats data available/i)).toBeTruthy()
    })
  })

  it('shows an inline error message when the fetch fails for unexpected reasons', async () => {
    getApiHandler.mockRejectedValue(new Error('boom'))

    render(
      <StreamystatsStatsPanel
        itemId="abc"
        itemUrl="http://streamystats.local/servers/1/library/abc"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/failed to load streamystats/i)).toBeTruthy()
    })
  })

  it('reserves vertical space so the modal layout does not jump', () => {
    getApiHandler.mockReturnValue(new Promise(() => {}))
    const { container } = render(
      <StreamystatsStatsPanel
        itemId="abc"
        itemUrl="http://streamystats.local/servers/1/library/abc"
      />,
    )
    const panel = container.firstChild as HTMLElement
    expect(panel?.className).toMatch(/min-h-/)
  })
  it('retries unavailable data instead of calling it empty history', async () => {
    getApiHandler
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce({
        item: { id: 'abc' },
        totalViews: 0,
        totalWatchTime: 0,
        completionRate: 0,
        firstWatched: null,
        lastWatched: null,
        usersWatched: [],
        watchHistory: [],
        watchCountByMonth: [],
      })
    render(<StreamystatsStatsPanel itemId="abc" itemUrl="http://stats/item" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByText('No watch history recorded yet.'),
    ).toBeTruthy()
  })
})
