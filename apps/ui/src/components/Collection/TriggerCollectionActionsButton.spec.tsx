import { ServarrAction } from '@maintainerr/contracts'
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
vi.mock('../../utils/ClientLogger', () => ({ logClientError: vi.fn() }))
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const collection = {
  id: 42,
  title: 'Sample Collection',
  isActive: true,
  type: 'movie' as const,
  arrAction: ServarrAction.DELETE,
}
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

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(PostApiHandler).mockResolvedValue({})
})

const openConfirmation = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Trigger Rule Actions' }))

describe('TriggerCollectionActionsButton', () => {
  it('keeps global Handle Collections on the due-item endpoint without confirmation', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Handle Collections' }))
    await waitFor(() =>
      expect(PostApiHandler).toHaveBeenCalledWith('/collections/handle', {}),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('requires confirmation and explains countdown-only override before triggering all eligible members', async () => {
    setup()
    openConfirmation()
    expect(PostApiHandler).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this movie')).toBeTruthy()
    expect(
      screen.getByText(/Countdowns will be ignored/).textContent,
    ).toContain(
      'Exclusions, active playback protection, failed rule evaluation safeguards',
    )
    expect(screen.getByText(/across all pages/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(PostApiHandler).not.toHaveBeenCalled()
    openConfirmation()
    fireEvent.click(screen.getByRole('button', { name: 'Trigger now' }))
    await waitFor(() =>
      expect(PostApiHandler).toHaveBeenCalledWith(
        '/collections/42/trigger',
        {},
      ),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(PostApiHandler).toHaveBeenCalledTimes(1)
  })

  it('blocks duplicate submissions and the global handler during acceptance', async () => {
    let accept!: (value: unknown) => void
    vi.mocked(PostApiHandler).mockImplementation(
      () =>
        new Promise((resolve) => {
          accept = resolve
        }),
    )
    setup()
    openConfirmation()
    const confirm = screen.getByRole('button', { name: 'Trigger now' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(PostApiHandler).toHaveBeenCalledTimes(1))
    expect(
      screen
        .getByText('Handle Collections')
        .closest('button')
        ?.hasAttribute('disabled'),
    ).toBe(true)
    accept({})
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
  })

  it('disables controls while the worker runs and disables inactive collection triggers', () => {
    setup(true)
    for (const button of screen.getAllByRole('button'))
      expect(button.hasAttribute('disabled')).toBe(true)
    cleanup()
    setup(false, false)
    expect(
      screen
        .getByRole('button', { name: 'Trigger Rule Actions' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Handle Collections' })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it.each([409, 500])(
    'keeps HTTP %s failures in the confirmation for review without claiming success',
    async (status) => {
      const error = new AxiosError('')
      Object.assign(error, { response: { status } })
      vi.mocked(PostApiHandler).mockRejectedValue(error)
      setup()
      openConfirmation()
      fireEvent.click(screen.getByRole('button', { name: 'Trigger now' }))
      await waitFor(() =>
        expect(
          screen.getByText(
            'Failed to trigger rule actions for this collection.',
          ),
        ).toBeTruthy(),
      )
      expect(toast.success).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeTruthy()
    },
  )

  it('never treats an unsaved scoped collection as a global action', () => {
    const client = createTestQueryClient()
    render(
      <QueryClientProvider client={client}>
        <TaskStatusContext value={{}}>
          <TriggerCollectionActionsButton
            collection={{ ...collection, id: undefined }}
          />
        </TaskStatusContext>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    expect(PostApiHandler).not.toHaveBeenCalled()
  })
})
