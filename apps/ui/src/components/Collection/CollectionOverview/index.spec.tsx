import type { MediaLibrary } from '@maintainerr/contracts'
import { fireEvent, render, screen } from '../../../test-utils/render'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaServerLibraries } from '../../../api/media-server'
import { useTaskStatusContext } from '../../../contexts/taskstatus-context'
import { buildQuerySuccessResult } from '../../../test-utils/queryResults'
import CollectionOverview from './index'

vi.mock('../../../api/media-server', () => ({
  useMediaServerLibraries: vi.fn(),
}))

vi.mock('../../../contexts/taskstatus-context', () => ({
  useTaskStatusContext: vi.fn(),
}))

vi.mock('../../Common/LibrarySwitcher', () => ({
  default: () => <div data-testid="library-switcher" />,
}))

vi.mock('../TriggerCollectionActionsButton', () => ({
  default: ({ collection }: { collection?: { id: number } }) => (
    <button type="button" data-collection-id={collection?.id}>
      Trigger Rule Actions
    </button>
  ),
}))

vi.mock('../../Common/LoadingSpinner', () => ({
  default: () => <div data-testid="loading-spinner" />,
  SmallLoadingSpinner: ({ className }: { className?: string }) => (
    <div data-testid="small-loading-spinner" className={className} />
  ),
}))

vi.mock('../CollectionItem', () => ({
  default: ({
    collection,
    onClick,
  }: {
    collection: { title: string }
    onClick: () => void
  }) => (
    <a href="#detail" onClick={onClick}>
      {collection.title}
    </a>
  ),
}))

describe('CollectionOverview', () => {
  const librariesHookMock = vi.mocked(useMediaServerLibraries)
  const taskStatusHookMock = vi.mocked(useTaskStatusContext)

  beforeEach(() => {
    librariesHookMock.mockReturnValue(
      buildQuerySuccessResult<MediaLibrary[]>([]),
    )
    taskStatusHookMock.mockReturnValue({
      collectionHandlerRunning: false,
    })
  })

  it('keeps rendered collections visible while a refresh is in flight', () => {
    render(
      <CollectionOverview
        collections={[
          {
            id: 1,
            title: 'Action',
          } as any,
        ]}
        onSwitchLibrary={vi.fn()}
        selectedLibraryId="all"
        isLoading={true}
        openDetail={vi.fn()}
      />,
    )

    expect(screen.getByText('Action')).toBeTruthy()
    expect(screen.getAllByTestId('small-loading-spinner')).toHaveLength(1)
    expect(screen.queryByText('No collections found for this library.')).toBe(
      null,
    )
  })

  it('places the scoped action outside the collection link', () => {
    const openDetail = vi.fn()
    render(
      <CollectionOverview
        collections={[{ id: 42, title: 'Sample Collection' } as any]}
        onSwitchLibrary={vi.fn()}
        isLoading={false}
        openDetail={openDetail}
      />,
    )
    const buttons = screen.getAllByRole('button', {
      name: 'Trigger Rule Actions',
    })
    const scoped = buttons.find(
      (button) => button.getAttribute('data-collection-id') === '42',
    )!
    expect(scoped.closest('a')).toBe(null)
    fireEvent.click(scoped)
    expect(openDetail).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Sample Collection' }))
    expect(openDetail).toHaveBeenCalledTimes(1)
  })

  it('shows an inline loading placeholder before the first collection batch arrives', () => {
    render(
      <CollectionOverview
        collections={[]}
        onSwitchLibrary={vi.fn()}
        selectedLibraryId="all"
        isLoading={true}
        openDetail={vi.fn()}
      />,
    )

    expect(screen.getByTestId('loading-spinner')).toBeTruthy()
    expect(screen.queryByTestId('small-loading-spinner')).toBe(null)
    expect(screen.queryByText('No collections found for this library.')).toBe(
      null,
    )
  })
})
