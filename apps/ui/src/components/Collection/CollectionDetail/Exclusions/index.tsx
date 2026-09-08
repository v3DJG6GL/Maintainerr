import { useLingui } from '@lingui/react/macro'
import {
  MediaServerFeature,
  supportsFeature,
  type MediaItem,
} from '@maintainerr/contracts'
import { useCallback, useEffect, useRef } from 'react'
import { ICollection } from '../..'
import useInfinitePaginatedList from '../../../../hooks/useInfinitePaginatedList'
import useMediaSelection from '../../../../hooks/useMediaSelection'
import { useMediaServerType } from '../../../../hooks/useMediaServerType'
import GetApiHandler from '../../../../utils/ApiHandler'
import { reportBulkOutcome } from '../../../../utils/bulkOutcome'
import { invalidateMaintainerrStatusDetails } from '../../../Common/MediaCard/maintainerrStatus'
import MediaSelectionActions from '../../../Common/MediaSelectionActions'
import type { MediaActionOutcome } from '../../../Common/MediaActionModal'
import {
  getCollectionSortConfig,
  MediaLibrarySortControl,
  useMediaLibrarySort,
  isAnalyticsBrowseSort,
} from '../../../Common/MediaLibrarySortControl'
import PageControlRow from '../../../Common/PageControlRow'
import OverviewContent from '../../../Overview/Content'
import { useMediaAnalyticsBrowse } from '../../../../hooks/useMediaAnalyticsBrowse'
import { useMediaAnalyticsCapabilities } from '../../../../api/media-analytics'

interface ICollectionExclusions {
  collection: ICollection
}

export interface IExclusionMedia {
  id: number
  mediaServerId: string
  ruleGroupId: number
  parent: number
  type: number
  /** Server-agnostic media metadata */
  mediaData?: MediaItem
}

const CollectionExcludions = (props: ICollectionExclusions) => {
  const { t } = useLingui()
  const fetchAmount = 30
  const { mediaServerType } = useMediaServerType()
  const {
    selectionMode,
    selectedIds,
    toggleSelection,
    toggleSelectionMode,
    applyBulkOutcome,
    resetSelection,
  } = useMediaSelection()
  const browseScopeKey = `${mediaServerType}:${props.collection.id}`
  const previousBrowseScope = useRef(browseScopeKey)
  const analytics = useMediaAnalyticsBrowse(browseScopeKey)
  const capabilities = useMediaAnalyticsCapabilities(
    mediaServerType ?? 'active',
  )
  const libraryType = props.collection.type === 'movie' ? 'movie' : 'show'
  const sortConfig = getCollectionSortConfig(
    libraryType,
    undefined,
    supportsFeature(mediaServerType, MediaServerFeature.LIBRARY_STUDIO_SORT),
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

  const mapExclusionItems = useCallback((items: IExclusionMedia[]) => {
    return items.map((item) => {
      if (item.mediaData) {
        item.mediaData.maintainerrExclusionId = item.id
        item.mediaData.maintainerrExclusionType = item.ruleGroupId
          ? 'specific'
          : 'global'
      }

      return item.mediaData ? item.mediaData : ({} as MediaItem)
    })
  }, [])

  const fetchExclusionsPage = useCallback(
    async (page: number, requestSortParams = sortParams) => {
      if (isAnalyticsBrowseSort(requestSortParams)) {
        try {
          return await analytics.fetchPage<IExclusionMedia>({
            scope: 'exclusions',
            id: String(props.collection.id),
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
        items: IExclusionMedia[]
      }>(
        `/collections/exclusions/${props.collection.id}/content/${page}?${query.toString()}`,
      )
    },
    [fetchAmount, props.collection.id, sortParams, analytics.fetchPage],
  )

  const fetchPage = useCallback(
    async (page: number) => {
      return await fetchExclusionsPage(page)
    },
    [fetchExclusionsPage],
  )

  const {
    data,
    hasMoreData,
    isLoading,
    isLoadingExtra,
    resetAndLoad,
    updateData,
  } = useInfinitePaginatedList<IExclusionMedia, MediaItem>({
    fetchAmount,
    fetchPage,
    mapPageItems: mapExclusionItems,
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
      fetchPage: (page) => fetchExclusionsPage(page, nextSortState.sortParams),
    })
  }

  const handleBulkOutcome = (outcome: MediaActionOutcome) => {
    const { action, collectionId, succeededIds, failedIds } = outcome
    applyBulkOutcome(new Set(failedIds))

    for (const mediaServerId of succeededIds) {
      invalidateMaintainerrStatusDetails(mediaServerId)
    }

    // This list is the collection's exclusions, so only an un-exclude empties
    // it, and only when it reached this collection: an undefined id means every
    // exclusion the items carry, which includes these.
    if (
      action === 'exclusion-remove' &&
      (collectionId === undefined || collectionId === props.collection.id)
    ) {
      const removedIds = new Set(succeededIds)
      updateData((currentData) =>
        currentData.filter((item) => !removedIds.has(item.id)),
      )
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
            libraryId={props.collection.libraryId}
            defaultCollectionId={props.collection.id}
            onSubmitted={handleBulkOutcome}
          />
        }
        controls={
          <MediaLibrarySortControl
            ariaLabel={t`Sort collection exclusions`}
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
          collectionPage={true}
          collectionId={props.collection.id}
          extrasLoading={isLoadingExtra && !isLoading && hasMoreData}
          selectionMode={selectionMode}
          selectedMediaIds={selectedIds}
          onToggleSelection={toggleSelection}
          onRemove={(id: string) =>
            updateData((currentData) =>
              currentData.filter((item) => item.id !== id),
            )
          }
        />
      ) : null}
    </div>
  )
}

export default CollectionExcludions
