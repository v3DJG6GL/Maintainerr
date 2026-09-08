import type {
  MediaAnalyticsSource,
  MediaPlaybackDetails,
} from '@maintainerr/contracts'
import { i18n } from '@lingui/core'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
  within,
} from '../../../../test-utils/render'
import { createTestQueryClient } from '../../../../test-utils/queryClient'
import { createDeferred } from '../../../../test-utils/createDeferred'
import MediaAnalyticsPanel from './MediaAnalyticsPanel'

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
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status },
  })
const details = (
  source: MediaAnalyticsSource,
  overrides: Partial<MediaPlaybackDetails> = {},
): MediaPlaybackDetails => ({
  source,
  playCount: 3,
  totalWatchTimeMs: 90_000,
  lastPlayedAt: '2026-01-02T12:00:00Z',
  averageCompletionPercent: 80,
  externalUrl: null,
  users: [],
  episodes: null,
  ...overrides,
})

beforeEach(() => {
  getApiHandler.mockReset()
})
afterEach(() => {
  act(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })
})

describe.each(['tracearr', 'streamystats'] as const)(
  'MediaAnalyticsPanel (%s)',
  (source) => {
    const sourceName = source === 'tracearr' ? 'Tracearr' : 'Streamystats'
    const panel = (itemId = 'item', sourceKey = 'server') => (
      <MediaAnalyticsPanel
        source={source}
        itemId={itemId}
        sourceKey={sourceKey}
        itemUrl="https://analytics.test/base"
      />
    )

    it.each([
      [0, '0 min'],
      [500, '1 sec'],
      [20_000, '20 sec'],
      [90_000, '1 min 30 sec'],
      [3_661_000, '1 hr 1 min 1 sec'],
    ] as const)(
      'preserves precision for %s milliseconds',
      async (milliseconds, expected) => {
        getApiHandler.mockResolvedValue(
          details(source, { totalWatchTimeMs: milliseconds }),
        )
        render(panel())
        await screen.findByText(expected)
        expect(screen.getByText(sourceName)).toBeTruthy()
        expect(screen.getByText('Average completion')).toBeTruthy()
        expect(screen.getByText('Last played')).toBeTruthy()
        expect(
          screen.getByText('Includes recorded plays that were not completed.'),
        ).toBeTruthy()
        expect(getApiHandler).toHaveBeenCalledWith(
          `/media-analytics/items/item/details?source=${source}`,
        )
      },
    )

    it('keeps unknown metrics distinct from confirmed zero history', async () => {
      getApiHandler.mockResolvedValueOnce(
        details(source, {
          playCount: null,
          totalWatchTimeMs: null,
          averageCompletionPercent: null,
          lastPlayedAt: null,
          users: null,
        }),
      )
      const view = render(panel('unknown'))
      await screen.findByText('User statistics unavailable.')
      expect(screen.getAllByText('-')).toHaveLength(4)
      expect(screen.queryByText('No watch history recorded yet.')).toBeNull()
      getApiHandler.mockResolvedValueOnce(
        details(source, { playCount: 0, totalWatchTimeMs: 0 }),
      )
      view.rerender(panel('zero'))
      await screen.findByText('No watch history recorded yet.')
      expect(screen.getByText('0 min')).toBeTruthy()
    })

    it('distinguishes 404 from 503 and retries only the selected source', async () => {
      getApiHandler.mockRejectedValueOnce(httpError(404))
      const view = render(panel('missing'))
      await screen.findByText(`No ${sourceName} data available for this item.`)
      getApiHandler
        .mockRejectedValueOnce(httpError(503))
        .mockResolvedValueOnce(details(source))
      view.rerender(panel('unavailable'))
      await screen.findByText(`Failed to load ${sourceName} data`)
      expect(screen.queryByText('No watch history recorded yet.')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await screen.findByText('1 min 30 sec')
      expect(getApiHandler).toHaveBeenLastCalledWith(
        `/media-analytics/items/unavailable/details?source=${source}`,
      )
    })

    it('prefers a safe deep link and retains the configured link through errors', async () => {
      getApiHandler.mockResolvedValueOnce(
        details(source, { externalUrl: 'https://analytics.test/media/123' }),
      )
      const view = render(panel())
      await screen.findByText('1 min 30 sec')
      expect(screen.getByRole('link').getAttribute('href')).toBe(
        'https://analytics.test/media/123',
      )
      getApiHandler.mockResolvedValueOnce(
        details(source, { externalUrl: 'javascript:alert(1)' }),
      )
      view.rerender(panel('unsafe'))
      await screen.findByText('1 min 30 sec')
      expect(screen.getByRole('link').getAttribute('href')).toBe(
        'https://analytics.test/base',
      )
      getApiHandler.mockRejectedValueOnce(httpError(503))
      view.rerender(panel('failure'))
      await screen.findByText(`Failed to load ${sourceName} data`)
      expect(
        screen
          .getByRole('link', { name: `View on ${sourceName} →` })
          .getAttribute('href'),
      ).toBe('https://analytics.test/base')
    })

    it('does not expose an unsafe configured fallback link', async () => {
      getApiHandler.mockRejectedValue(httpError(503))
      render(
        <MediaAnalyticsPanel
          source={source}
          itemId="item"
          sourceKey="server"
          itemUrl="javascript:alert(1)"
        />,
      )
      await screen.findByText(`Failed to load ${sourceName} data`)
      expect(screen.queryByRole('link')).toBeNull()
    })

    it('uses identical aggregate and user duration formatting and discloses all users', async () => {
      const users = Array.from({ length: 6 }, (_, index) => ({
        id: `user-${index}`,
        name: `User ${index}`,
        playCount: index ? 1 : null,
        totalWatchTimeMs: 20_000,
        lastPlayedAt: null,
      }))
      getApiHandler.mockResolvedValue(
        details(source, { totalWatchTimeMs: 20_000, users }),
      )
      render(panel())
      await screen.findByRole('table')
      expect(screen.queryByText('User 5')).toBeNull()
      expect(screen.getAllByText('20 sec')).toHaveLength(6)
      const row = screen.getByText('User 0').closest('tr')!
      expect(within(row).getAllByText('-')).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: 'Show all 6 users' }))
      expect(screen.getByText('User 5')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Show fewer users' }))
      expect(screen.queryByText('User 5')).toBeNull()
    })

    it('orders displayed user names consistently without mutating cached results', async () => {
      const user = (id: string, name: string | null) => ({
        id,
        name,
        playCount: id === 'a' ? 2 : 1,
        totalWatchTimeMs: 0,
        lastPlayedAt: null,
      })
      const users = [
        user('z', ' Zeta '),
        user('b', 'Alpha'),
        user('Fallback', '   '),
        user('a', 'Alpha'),
      ]
      const response = details(source, { users })
      getApiHandler.mockResolvedValue(response)
      render(panel())
      const table = await screen.findByRole('table')
      const rows = within(table).getAllByRole('row').slice(1)
      expect(
        rows.map((row) => within(row).getAllByRole('cell')[0].textContent),
      ).toEqual(['Alpha', 'Alpha', 'Fallback', 'Zeta'])
      expect(within(rows[0]).getAllByRole('cell')[1].textContent).toBe('2')
      expect(response.users).toBe(users)
      expect(users.map((row) => row.id)).toEqual(['z', 'b', 'Fallback', 'a'])
      expect(users[0].name).toBe(' Zeta ')
    })

    it.each(['item', 'sourceKey', 'source'] as const)(
      'resets expanded users when %s changes',
      async (change) => {
        const users = Array.from({ length: 6 }, (_, index) => ({
          id: `user-${index}`,
          name: `User ${index}`,
          playCount: 1,
          totalWatchTimeMs: 0,
          lastPlayedAt: null,
        }))
        getApiHandler.mockResolvedValueOnce(details(source, { users }))
        const view = render(panel())
        fireEvent.click(
          await screen.findByRole('button', { name: 'Show all 6 users' }),
        )
        const next = createDeferred<MediaPlaybackDetails>()
        getApiHandler.mockReturnValueOnce(next.promise)
        const nextSource =
          change === 'source'
            ? source === 'tracearr'
              ? 'streamystats'
              : 'tracearr'
            : source
        view.rerender(
          <MediaAnalyticsPanel
            source={nextSource}
            itemId={change === 'item' ? 'next' : 'item'}
            sourceKey={change === 'sourceKey' ? 'next' : 'server'}
            itemUrl="https://analytics.test/base"
          />,
        )
        expect(screen.queryByText('User 5')).toBeNull()
        next.resolve(details(nextSource, { users }))
        await screen.findByRole('button', { name: 'Show all 6 users' })
        expect(screen.queryByText('User 5')).toBeNull()
      },
    )

    it('ignores a late response after changing item', async () => {
      const previous = createDeferred<MediaPlaybackDetails>()
      getApiHandler
        .mockReturnValueOnce(previous.promise)
        .mockResolvedValueOnce(details(source, { playCount: 77 }))
      const view = render(panel('old'))
      await waitFor(() => expect(getApiHandler).toHaveBeenCalledTimes(1))
      view.rerender(panel('new'))
      await screen.findByText('77')
      await act(async () => {
        previous.resolve(details(source, { playCount: 88 }))
      })
      expect(screen.queryByText('88')).toBeNull()
    })

    it('shows episode counts without inventing a denominator or season completion', async () => {
      getApiHandler.mockResolvedValueOnce(
        details(source, {
          episodes: {
            playedEpisodes: 5,
            totalEpisodes: null,
            seasonsWithPlayback: 2,
          },
        }),
      )
      const view = render(panel())
      await screen.findByText('5 episodes played')
      expect(screen.getByText('2 seasons with playback')).toBeTruthy()
      getApiHandler.mockResolvedValueOnce(
        details(source, {
          episodes: {
            playedEpisodes: 5,
            totalEpisodes: 10,
            seasonsWithPlayback: null,
          },
        }),
      )
      view.rerender(panel('ratio'))
      await screen.findByText('5/10 episodes played')
      expect(screen.queryByText('2 seasons with playback')).toBeNull()
      expect(
        screen.getByTitle('Average completion of recorded playback sessions.'),
      ).toBeTruthy()
    })

    it('formats counts, dates and percentages using the active locale without refetching', async () => {
      getApiHandler.mockResolvedValue(details(source, { playCount: 1234 }))
      render(panel())
      await screen.findByText('1,234')
      act(() => {
        i18n.loadAndActivate({ locale: 'de', messages: {} })
      })
      expect(screen.getByText('1.234')).toBeTruthy()
      expect(screen.getByText('2.1.2026')).toBeTruthy()
      expect(screen.getByText('80 %')).toBeTruthy()
      expect(getApiHandler).toHaveBeenCalledTimes(1)
    })
  },
)
