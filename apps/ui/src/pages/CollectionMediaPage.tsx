import { useLingui } from '@lingui/react/macro'
import {
  MediaServerFeature,
  supportsFeature,
  type MediaItem,
} from '@maintainerr/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import type { ICollectionMedia } from '../components/Collection'
import { invalidateMaintainerrStatusDetails } from '../components/Common/MediaCard/maintainerrStatus'
import MediaSelectionActions from '../components/Common/MediaSelectionActions'
import type { MediaActionOutcome } from '../components/Common/MediaActionModal'
import {
  getCollectionMediaSortConfig,
  MediaLibrarySortControl,
  useMediaLibrarySort,
  isAnalyticsBrowseSort,
} from '../components/Common/MediaLibrarySortControl'
import PageControlRow from '../components/Common/PageControlRow'
import OverviewContent from '../components/Overview/Content'
import useInfinitePaginatedList from '../hooks/useInfinitePaginatedList'
import useMediaSelection from '../hooks/useMediaSelection'
import { useMediaServerType } from '../hooks/useMediaServerType'
import { reportBulkOutcome } from '../utils/bulkOutcome'
import type { CollectionDetailOutletContext } from './CollectionDetailPage'
import GetApiHandler from '../utils/ApiHandler'
import { useMediaAnalyticsBrowse } from '../hooks/useMediaAnalyticsBrowse'
import { useMediaAnalyticsCapabilities } from '../api/media-analytics'

export const mapCollectionMediaItemsToMediaData = (
  items: ICollectionMedia[],
) => {
  return items.map((item) => {
    if (!item.mediaData) {
      return {} as MediaItem
    }

    return {
      ...item.mediaData,
      maintainerrIsManual: item.isManual ?? false,
    }
  })
}

const CollectionMediaPage = () => {
  const { t } = useLingui()
  const { collection } = useOutletContext<CollectionDetailOutletContext>()
  const { id } = useParams<{ id: string }>()
  const [media, setMedia] = useState<ICollectionMedia[]>([])
  const { mediaServerType } = useMediaServerType()
  const {
    selectionMode,
    selectedIds,
    toggleSelection,
    toggleSelectionMode,
    applyBulkOutcome,
    resetSelection,
  } = useMediaSelection()
  const browseScopeKey = `${mediaServerType}:${id}`
  const previousBrowseScope = useRef(browseScopeKey)
  const analytics = useMediaAnalyticsBrowse(browseScopeKey)
  const capabilities = useMediaAnalyticsCapabilities(
    mediaServerType ?? 'active',
  )
  const fetchAmount = 30
  const mediaRef = useRef<ICollectionMedia[]>([])
  const libraryType = collection.type === 'movie' ? 'movie' : 'show'
  const sortConfig = getCollectionMediaSortConfig(
    libraryType,
    collection.deleteAfterDays != null,
    supportsFeature(mediaServerType, MediaServerFeature.LIBRARY_STUDIO_SORT),
    true,
    capabilities.data?.sources,
  )
  const {
    sortValue,
    sortParams,
    onSortChange,
    options: sortOptions,
    sortUnavailable,
  } = useMediaLibrarySort(sortConfig)
  const analyticsFeedback = sortUnavailable
    ? {
        status: 'error' as const,
        message: t`The selected analytics source is unavailable. Choose another sort or reconnect the source.`,
      }
    : analytics.feedback
  useEffect(() => {
    if (sortUnavailable) analytics.cancel('unavailable')
  }, [sortUnavailable, analytics.cancel])

  const appendMediaPage = useCallback((items: ICollectionMedia[]) => {
    const nextMedia = [...mediaRef.current, ...items]
    mediaRef.current = nextMedia
    setMedia(nextMedia)
  }, [])

  const updateMedia = useCallback(
    (updater: (currentMedia: ICollectionMedia[]) => ICollectionMedia[]) => {
      const nextMedia = updater(mediaRef.current)
      mediaRef.current = nextMedia
      setMedia(nextMedia)
    },
    [],
  )

  const resetMedia = useCallback(() => {
    mediaRef.current = []
    setMedia([])
  }, [])

  const mapCollectionMediaItems = useCallback(
    (items: ICollectionMedia[]) => mapCollectionMediaItemsToMediaData(items),
    [],
  )

  const fetchCollectionMediaPage = useCallback(
    async (page: number, requestSortParams = sortParams) => {
      if (isAnalyticsBrowseSort(requestSortParams)) {
        try {
          return await analytics.fetchPage<ICollectionMedia>({
            scope: 'collection',
            id: String(id),
            ...requestSortParams,
            offset: (page - 1) * fetchAmount,
            limit: fetchAmount,
          })
        } catch {
          return { totalSize: 0, items: [] }
        }
      }
      const query = new URLSearchParams({
        size: `${fetchAmount}`,
        ...(requestSortParams ?? {}),
      })

      return await GetApiHandler<{
        totalSize: number
        items: ICollectionMedia[]
      }>(`/collections/media/${id}/content/${page}?${query.toString()}`)
    },
    [fetchAmount, id, sortParams, analytics.fetchPage],
  )

  const fetchPage = useCallback(
    async (page: number) => {
      return await fetchCollectionMediaPage(page)
    },
    [fetchCollectionMediaPage],
  )

  const {
    data,
    hasMoreData,
    isLoading,
    isLoadingExtra,
    resetAndLoad,
    updateData,
  } = useInfinitePaginatedList<ICollectionMedia, MediaItem>({
    fetchAmount,
    fetchPage,
    mapPageItems: mapCollectionMediaItems,
    onAppendPageItems: appendMediaPage,
    onReset: resetMedia,
  })

  useEffect(() => {
    if (previousBrowseScope.current === browseScopeKey) return
    previousBrowseScope.current = browseScopeKey
    resetSelection()
    resetAndLoad()
  }, [browseScopeKey, resetSelection, resetAndLoad])

  const handleSortChange = (nextSortValue: string) => {
    const nextSortState = onSortChange(nextSortValue)
    if (!nextSortState) {
      return
    }

    // A selection made against the previous item set must never survive into
    // the next one - same contract as the Overview sync.
    analytics.cancel()
    resetSelection()
    resetAndLoad({
      fetchPage: (page) =>
        fetchCollectionMediaPage(page, nextSortState.sortParams),
    })
  }

  const removeMediaItem = (mediaServerId: string) => {
    updateData((currentData) =>
      currentData.filter((item) => item.id !== mediaServerId),
    )
    updateMedia((currentMedia) =>
      currentMedia.filter((item) => item.mediaServerId !== mediaServerId),
    )
  }

  const handleBulkOutcome = (outcome: MediaActionOutcome) => {
    const { action, collectionId, succeededIds, failedIds } = outcome
    applyBulkOutcome(new Set(failedIds))

    for (const mediaServerId of succeededIds) {
      invalidateMaintainerrStatusDetails(mediaServerId)
    }

    // Removing and excluding both drop membership, but only from the collection
    // they were aimed at: an undefined id means every collection, so it reaches
    // this one too. Aimed elsewhere, this grid is unchanged.
    const leavesThisCollection =
      (action === 'exclusion-add' || action === 'collection-remove') &&
      (collectionId === undefined || collectionId === collection.id)

    if (leavesThisCollection) {
      for (const mediaServerId of succeededIds) {
        removeMediaItem(mediaServerId)
      }
    }

    reportBulkOutcome(outcome)
  }

  const showRefreshing = isLoading && data.length > 0

  return (
    <div className="w-full">
      <PageControlRow
        sticky
        actionsClassName="justify-center sm:justify-start"
        actions={
          <MediaSelectionActions
            selectionMode={selectionMode}
            onToggleSelectionMode={toggleSelectionMode}
            selectedIds={selectedIds}
            items={data}
            libraryId={collection.libraryId}
            defaultCollectionId={collection.id}
            onSubmitted={handleBulkOutcome}
          />
        }
        controls={
          <MediaLibrarySortControl
            ariaLabel={t`Sort collection items`}
            options={sortOptions}
            value={sortValue}
            onSortChange={handleSortChange}
            isLoading={showRefreshing}
            analyticsFeedback={analyticsFeedback}
            onRetry={() => {
              analytics.cancel()
              resetSelection()
              resetAndLoad()
            }}
          />
        }
      />

      {analyticsFeedback?.status !== 'error' ? (
        <OverviewContent
          dataFinished={true}
          fetchData={() => {}}
          loading={isLoading}
          data={data}
          collection={collection}
          collectionPage={true}
          extrasLoading={isLoadingExtra && !isLoading && hasMoreData}
          selectionMode={selectionMode}
          selectedMediaIds={selectedIds}
          onToggleSelection={toggleSelection}
          onRemove={removeMediaItem}
          onItemPostponed={(id: string, addDate: string) => {
            // Patch the local addDate so the "days left" badge reflects the new
            // deletion date immediately, without refetching the page.
            updateMedia((currentMedia) =>
              currentMedia.map((item) =>
                item.mediaServerId === id
                  ? { ...item, addDate: new Date(addDate) }
                  : item,
              ),
            )
          }}
          collectionInfo={media}
        />
      ) : null}
    </div>
  )
}

export default CollectionMediaPage
