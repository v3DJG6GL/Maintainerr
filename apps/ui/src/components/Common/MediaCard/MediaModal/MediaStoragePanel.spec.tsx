import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  render as renderComponent,
  screen,
  waitFor,
  fireEvent,
} from '../../../../test-utils/render'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MediaStorageDetails } from '@maintainerr/contracts'
import { createDeferred } from '../../../../test-utils/createDeferred'
import { createTestQueryClient } from '../../../../test-utils/queryClient'
import MediaStoragePanel from './MediaStoragePanel'

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

const getApiHandler = vi.fn()
vi.mock('../../../../utils/ApiHandler', () => ({
  default: (url: string) => getApiHandler(url),
}))

describe('MediaStoragePanel', () => {
  beforeEach(() => {
    getApiHandler.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps files collapsed and distinguishes an incomplete total and missing size', async () => {
    getApiHandler.mockResolvedValue({
      status: 'partial',
      itemType: 'show',
      sizeBytes: 1024,
      folders: ['/media/series'],
      files: [
        {
          itemId: 'a',
          title: 'Sample Episode',
          sourceId: 's',
          path: '/media/series/file.mkv',
          sizeBytes: 1024,
        },
        { itemId: 'b', title: 'Sample Episode 2', sourceId: 's2' },
      ],
    })
    const { container } = render(
      <MediaStoragePanel itemId="a" serverId="server" />,
    )
    await screen.findAllByText('At least 1.00 KB')
    expect(container.querySelector('details')?.open).toBe(false)
    expect(screen.queryByText('file.mkv')).toBeNull()
    fireEvent.click(screen.getByText('Other episodes'))
    await screen.findByText('file.mkv')
    expect(screen.getByText('Size unavailable')).toBeTruthy()
    expect(screen.getByText('Path unavailable')).toBeTruthy()
    expect(screen.queryByText('/media/series/file.mkv')).toBeNull()
  })

  it('shows movie files immediately without a disclosure', async () => {
    getApiHandler.mockResolvedValue({
      itemType: 'movie',
      status: 'complete',
      sizeBytes: 1024,
      folders: [],
      files: [
        {
          itemId: 'movie',
          title: 'Sample Movie',
          sourceId: 'main',
          path: '/movies/sample.mkv',
          sizeBytes: 1024,
        },
      ],
    })
    const { container } = render(
      <MediaStoragePanel itemId="movie" serverId="server" />,
    )
    await screen.findByText('/movies/sample.mkv')
    expect(container.querySelector('details')).toBeNull()
  })

  it('groups seasons numerically and keeps versions under one episode heading', async () => {
    const file = (
      seasonNumber: number,
      episodeNumber: number,
      path: string,
    ) => ({
      itemId: `${seasonNumber}-${episodeNumber}`,
      title: `Episode ${episodeNumber}`,
      seasonId: `s${seasonNumber}`,
      seasonNumber,
      episodeNumber,
      sourceId: path,
      path,
      sizeBytes: 1024,
    })
    getApiHandler.mockResolvedValue({
      itemType: 'show',
      status: 'complete',
      sizeBytes: 5120,
      folders: ['/series/sample'],
      files: [
        file(10, 1, '/series/sample/s10/a.mkv'),
        {
          ...file(2, 12, '/series/sample/s2/z.mkv'),
          seasonNumber: undefined,
        },
        file(2, 2, '/series/sample/s2/b.mkv'),
        file(0, 1, '/series/sample/s0/special.mkv'),
        file(2, 2, '/series/sample/s2/b-alt.mkv'),
      ],
    })
    const { container } = render(
      <MediaStoragePanel itemId="series" serverId="server" />,
    )
    await screen.findByText('/series/sample')
    const summaries = [...container.querySelectorAll('summary')]
    expect(
      summaries.map((summary) => summary.querySelector('span')?.textContent),
    ).toEqual(['Specials', 'Season 2', 'Season 10'])
    fireEvent.click(screen.getByText('Season 2'))
    await screen.findByText('b.mkv')
    expect(screen.getAllByText('Episode 2')).toHaveLength(1)
    expect(screen.getByText('b-alt.mkv')).toBeTruthy()
    expect(container.textContent!.indexOf('Episode 2')).toBeLessThan(
      container.textContent!.indexOf('Episode 12'),
    )
    expect(screen.queryByText('/series/sample/s2/b.mkv')).toBeNull()
    expect(screen.queryByText('special.mkv')).toBeNull()
  })

  it('displays Windows episode filenames and copies the full path', async () => {
    const path = 'D:\\Series\\Sample\\Season 01\\Episode ü.mkv'
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    getApiHandler.mockResolvedValue({
      itemType: 'episode',
      status: 'complete',
      sizeBytes: 0,
      folders: [],
      files: [
        {
          itemId: 'episode',
          title: 'Sample Episode',
          sourceId: 'main',
          path,
          sizeBytes: 0,
          episodeNumber: 1,
        },
      ],
    })
    render(<MediaStoragePanel itemId="episode" serverId="server" />)
    await screen.findByText('Episode ü.mkv')
    expect(screen.queryByText(path)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy full path' }))
    expect(writeText).toHaveBeenCalledWith(path)
    await screen.findByText('Copied')
  })

  it('labels season totals as incomplete when an episode could not be read', async () => {
    getApiHandler.mockResolvedValue({
      itemType: 'show',
      status: 'partial',
      sizeBytes: 1024,
      folders: [],
      files: [
        {
          itemId: 'episode',
          title: 'Reported Episode',
          sourceId: 'main',
          seasonId: 'season',
          seasonNumber: 1,
          path: '/series/reported.mkv',
          sizeBytes: 1024,
        },
      ],
    })
    render(<MediaStoragePanel itemId="series" serverId="server" />)
    const label = await screen.findByText('Season 1')
    expect(label.closest('summary')?.textContent).toContain('At least 1.00 KB')
  })

  it('does not show the previous item while the next request is pending', async () => {
    getApiHandler.mockResolvedValueOnce({
      status: 'complete',
      sizeBytes: 0,
      files: [],
      folders: [],
    })
    const { rerender } = render(
      <MediaStoragePanel itemId="a" serverId="server" />,
    )
    await screen.findByText('0 B')
    const nextRequest = createDeferred<MediaStorageDetails>()
    getApiHandler.mockReturnValue(nextRequest.promise)
    rerender(<MediaStoragePanel itemId="b" serverId="server" />)
    expect(screen.queryByText('0 B')).toBeNull()
    await waitFor(() =>
      expect(getApiHandler).toHaveBeenLastCalledWith(
        '/media-server/meta/b/storage',
      ),
    )
    nextRequest.resolve({
      status: 'complete',
      sizeBytes: 1024,
      files: [],
      folders: [],
    })
    await screen.findByText('1.00 KB')
    expect(screen.queryByText('0 B')).toBeNull()
  })

  it('renders unavailable on transport failure rather than no files', async () => {
    getApiHandler.mockRejectedValue(new Error('503'))
    render(<MediaStoragePanel itemId="a" serverId="server" />)
    await screen.findByText('File information is unavailable.')
    expect(screen.queryByText('No media files reported.')).toBeNull()
  })

  it.each(['partial', 'unavailable', 'error'])(
    'retries only file data after %s',
    async (status) => {
      if (status === 'error')
        getApiHandler.mockRejectedValueOnce(new Error('503'))
      else
        getApiHandler.mockResolvedValueOnce({
          status,
          sizeBytes: null,
          files: [],
          folders: [],
        })
      getApiHandler.mockResolvedValueOnce({
        status: 'complete',
        sizeBytes: 0,
        files: [],
        folders: [],
      })
      render(<MediaStoragePanel itemId="a" serverId="server" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
      await screen.findByText('0 B')
      expect(getApiHandler).toHaveBeenCalledTimes(2)
      expect(getApiHandler).toHaveBeenLastCalledWith(
        '/media-server/meta/a/storage',
      )
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    },
  )

  it.each([null, undefined])(
    'does not fetch or retry without a server identity (%s)',
    (serverId) => {
      render(<MediaStoragePanel itemId="a" serverId={serverId} />)
      expect(getApiHandler).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    },
  )
})
