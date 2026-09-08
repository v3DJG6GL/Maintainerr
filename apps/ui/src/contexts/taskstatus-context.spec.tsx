import { MaintainerrEvent, type TaskStatusDto } from '@maintainerr/contracts'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '../test-utils/render'
import { createTestQueryClient } from '../test-utils/queryClient'
import GetApiHandler from '../utils/ApiHandler'
import { TaskStatusProvider, useTaskStatusContext } from './taskstatus-context'

const listeners = new Map<MaintainerrEvent, (event: TaskStatusDto) => void>()
vi.mock('./events-context', () => ({
  useEvent: (
    type: MaintainerrEvent,
    listener?: (event: TaskStatusDto) => void,
  ) => {
    if (listener) listeners.set(type, listener)
  },
}))
vi.mock('../api/rules', () => ({
  useRuleHandlerStatus: () => ({ data: undefined }),
}))
vi.mock('../utils/ApiHandler', () => ({ default: vi.fn() }))

const Status = () => {
  const { collectionHandlerRunning } = useTaskStatusContext()
  return <div>{collectionHandlerRunning ? 'running' : 'idle'}</div>
}

beforeEach(() => {
  listeners.clear()
  vi.clearAllMocks()
})

describe('collection task status', () => {
  it('uses fresh query status after a missed start event and invalidates data only on completion', async () => {
    const client = createTestQueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    vi.mocked(GetApiHandler).mockResolvedValue({
      running: false,
      time: '2026-01-01T00:00:00Z',
    })
    render(
      <QueryClientProvider client={client}>
        <TaskStatusProvider>
          <Status />
        </TaskStatusProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(GetApiHandler).toHaveBeenCalled())
    act(() =>
      listeners.get(MaintainerrEvent.CollectionHandler_Started)?.({
        running: true,
        time: new Date('2026-01-01T00:00:01Z'),
      }),
    )
    expect(screen.getByText('running')).toBeTruthy()
    expect(invalidate).not.toHaveBeenCalled()
    act(() =>
      listeners.get(MaintainerrEvent.CollectionHandler_Finished)?.({
        running: false,
        time: new Date('2026-01-01T00:00:02Z'),
      }),
    )
    expect(screen.getByText('idle')).toBeTruthy()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['collections'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calendar'] })
    act(() =>
      client.setQueryData(['taskstatus_collectionhandler'], {
        running: true,
        time: '2026-01-01T00:00:03Z',
      }),
    )
    await waitFor(() => expect(screen.getByText('running')).toBeTruthy())
    act(() =>
      listeners.get(MaintainerrEvent.CollectionHandler_Finished)?.({
        running: false,
        time: new Date('2026-01-01T00:00:02Z'),
      }),
    )
    expect(screen.getByText('running')).toBeTruthy()
  })
})
