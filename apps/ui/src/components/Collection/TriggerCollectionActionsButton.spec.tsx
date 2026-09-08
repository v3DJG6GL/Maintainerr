import { QueryClientProvider } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'react-toastify'
import { TaskStatusContext } from '../../contexts/taskstatus-context'
import { createTestQueryClient } from '../../test-utils/queryClient'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '../../test-utils/render'
import { PostApiHandler } from '../../utils/ApiHandler'
import TriggerCollectionActionsButton from './TriggerCollectionActionsButton'

vi.mock('../../utils/ApiHandler', () => ({ PostApiHandler: vi.fn() }))
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const collection = { id: 42, title: 'Sample Collection', isActive: true }
const scopedLabel = 'Trigger rule actions for due items in Sample Collection'
const globalLabel =
  'Trigger rule actions for due items in all active collections'

const setup = (running = false, active = true) => {
  const client = createTestQueryClient()
  render(
    <QueryClientProvider client={client}>
      <TaskStatusContext
        value={{ collectionHandlerRunning: { running, time: new Date() } }}
      >
        <TriggerCollectionActionsButton />
        <TriggerCollectionActionsButton
          collection={{ ...collection, isActive: active }}
        />
      </TaskStatusContext>
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => {
  cleanup()
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(PostApiHandler).mockResolvedValue({})
})

describe('TriggerCollectionActionsButton', () => {
  it.each([
    [globalLabel, '/collections/handle'],
    [scopedLabel, '/collections/42/handle'],
  ])('posts only the selected scope: %s', async (label, path) => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(PostApiHandler).toHaveBeenCalledWith(path, {}))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain(
      'in the background',
    )
  })

  it('blocks all buttons during acceptance and rejects duplicate clicks before rendering', async () => {
    let accept!: (value: unknown) => void
    vi.mocked(PostApiHandler).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve
        }),
    )
    setup()
    fireEvent.click(screen.getByRole('button', { name: scopedLabel }))
    fireEvent.click(screen.getByRole('button', { name: globalLabel }))
    await waitFor(() => expect(PostApiHandler).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: globalLabel })
          .hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(
      screen
        .getByRole('button', { name: scopedLabel })
        .hasAttribute('disabled'),
    ).toBe(true)
    accept({})
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: globalLabel })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
  })

  it('keeps both controls disabled while the worker is running', () => {
    setup(true)
    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('disabled')).toBe(true)
      fireEvent.click(button)
    }
    expect(PostApiHandler).not.toHaveBeenCalled()
  })

  it('disables only the inactive collection and explains why', () => {
    setup(false, false)
    expect(
      screen
        .getByRole('button', { name: scopedLabel })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByRole('button', { name: scopedLabel }).title).toContain(
      'inactive',
    )
    expect(
      screen
        .getByRole('button', { name: globalLabel })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it.each([409, 500])(
    'shows failure feedback for HTTP %s without claiming completion',
    async (status) => {
      const error = new AxiosError('Request failed')
      Object.assign(error, { response: { status } })
      vi.mocked(PostApiHandler).mockRejectedValue(error)
      setup()
      fireEvent.click(screen.getByRole('button', { name: scopedLabel }))
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          status === 409
            ? 'Collection handling is already running.'
            : 'Failed to initiate rule actions.',
        ),
      )
      expect(toast.success).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: scopedLabel })
            .hasAttribute('disabled'),
        ).toBe(false),
      )
    },
  )

  it('never treats an unsaved scoped collection as a global action', () => {
    const client = createTestQueryClient()
    render(
      <QueryClientProvider client={client}>
        <TaskStatusContext value={{}}>
          <TriggerCollectionActionsButton
            collection={{ title: 'Unsaved', isActive: true }}
          />
        </TaskStatusContext>
      </QueryClientProvider>,
    )
    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(PostApiHandler).not.toHaveBeenCalled()
  })
})
