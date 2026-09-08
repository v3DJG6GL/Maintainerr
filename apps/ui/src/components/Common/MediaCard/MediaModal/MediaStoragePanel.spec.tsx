import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('keeps files collapsed and distinguishes an incomplete total and missing size', async () => {
    getApiHandler.mockResolvedValue({
      status: 'partial',
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
    await screen.findByText('At least 1.00 KB')
    expect(container.querySelector('details')?.open).toBe(false)
    expect(screen.getByText('Size unavailable')).toBeTruthy()
    expect(screen.getByText('Path unavailable')).toBeTruthy()
    expect(screen.getByText('/media/series/file.mkv')).toBeTruthy()
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
