import { t as globalT } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import {
  compareMediaItemsBySort,
  isMediaAnalyticsSort,
  getMediaAnalyticsSortSource,
  type MediaAnalyticsSortField,
  type MediaAnalyticsSource,
  type CollectionMediaSortParams,
  type MediaItem,
  type MediaLibrary,
  type MediaLibrarySortKey,
  type MediaLibrarySortParams,
  type MediaSortOrder,
} from '@maintainerr/contracts'
import { useState } from 'react'
import type { AnalyticsBrowseFeedback } from '../../hooks/useMediaAnalyticsBrowse'
import { Select } from '../Forms/Select'
import { SmallLoadingSpinner } from './LoadingSpinner'

const defaultSortValue = ''
const defaultOverviewSortValue: MediaLibrarySortKey = 'title.asc'
// Functions, not constants: a label resolved at module load would be stuck in
// whichever locale was active on first import.
const titleAscendingSortLabel = () => globalT`Title (A-Z) Ascending`

type SortParams = {
  sort: string
  sortOrder: MediaSortOrder
}

export interface AnalyticsBrowseSortParams {
  sort: MediaAnalyticsSortField
  sortOrder: MediaSortOrder
}
export type BrowseLibrarySortParams =
  MediaLibrarySortParams | AnalyticsBrowseSortParams
export type BrowseSortParams =
  CollectionMediaSortParams | AnalyticsBrowseSortParams
export const isAnalyticsBrowseSort = (
  params: SortParams | undefined,
): params is AnalyticsBrowseSortParams =>
  params !== undefined && isMediaAnalyticsSort(params.sort)

const analyticsOptions = (
  sources: readonly MediaAnalyticsSource[],
): SortOption<AnalyticsBrowseSortParams>[] =>
  sources.flatMap((source) => {
    const labels =
      source === 'tracearr'
        ? [
            globalT`Tracearr - Most played`,
            globalT`Tracearr - Least played`,
            globalT`Tracearr - Longest watch time`,
            globalT`Tracearr - Shortest watch time`,
          ]
        : [
            globalT`Streamystats - Most played`,
            globalT`Streamystats - Least played`,
            globalT`Streamystats - Longest watch time`,
            globalT`Streamystats - Shortest watch time`,
          ]
    const playCount: MediaAnalyticsSortField =
      source === 'tracearr' ? 'tracearrPlayCount' : 'streamystatsPlayCount'
    const watchTime: MediaAnalyticsSortField =
      source === 'tracearr' ? 'tracearrWatchTime' : 'streamystatsWatchTime'
    return (
      [
        { sort: playCount, sortOrder: 'desc' },
        { sort: playCount, sortOrder: 'asc' },
        { sort: watchTime, sortOrder: 'desc' },
        { sort: watchTime, sortOrder: 'asc' },
      ] satisfies AnalyticsBrowseSortParams[]
    ).map((sortParams, index) => ({
      value: `${sortParams.sort}.${sortParams.sortOrder}`,
      label: labels[index]!,
      sortParams,
    }))
  })

interface SortOption<TSortParams extends SortParams = MediaLibrarySortParams> {
  value: string
  label: string
  sortParams?: TSortParams
}

interface SortConfig<TSortParams extends SortParams = MediaLibrarySortParams> {
  defaultValue: string
  options: SortOption<TSortParams>[]
}

const createMediaLibrarySortOption = (
  value: MediaLibrarySortKey,
  label: string,
): SortOption<MediaLibrarySortParams> => {
  const [sort, sortOrder] = value.split('.') as [
    MediaLibrarySortParams['sort'],
    MediaSortOrder,
  ]

  return {
    value,
    label,
    sortParams: {
      sort,
      sortOrder,
    },
  }
}

const getSortOptionByValue = <TSortParams extends SortParams>(
  options: ReadonlyArray<SortOption<TSortParams>>,
  value: string,
) => {
  return options.find((option) => option.value === value)
}

const getResolvedSortOption = <TSortParams extends SortParams>(
  options: ReadonlyArray<SortOption<TSortParams>>,
  value: string,
  defaultValue: string,
): SortOption<TSortParams> => {
  return (
    getSortOptionByValue(options, value) ??
    getSortOptionByValue(options, defaultValue) ??
    options[0]!
  )
}

const getMediaLibrarySortOptions = (
  libraryType?: MediaLibrary['type'],
  {
    includeTitleAscending = true,
    includeStudioSort = false,
  }: {
    includeTitleAscending?: boolean
    includeStudioSort?: boolean
  } = {},
): Array<SortOption<MediaLibrarySortParams>> => {
  const options: Array<SortOption<MediaLibrarySortParams>> = []

  if (includeTitleAscending) {
    options.push(
      createMediaLibrarySortOption('title.asc', titleAscendingSortLabel()),
    )
  }

  options.push(
    createMediaLibrarySortOption('title.desc', globalT`Title (Z-A) Descending`),
  )

  if (includeStudioSort) {
    options.push(
      createMediaLibrarySortOption(
        'studio.asc',
        globalT`Studio (A-Z) Ascending`,
      ),
      createMediaLibrarySortOption(
        'studio.desc',
        globalT`Studio (Z-A) Descending`,
      ),
    )
  }

  // The air-date pair is spelled out per library type rather than composed
  // from a shared noun, so each reads naturally once translated.
  options.push(
    createMediaLibrarySortOption(
      'airDate.desc',
      libraryType === 'show'
        ? globalT`First Air Date Descending`
        : globalT`Release Date Descending`,
    ),
    createMediaLibrarySortOption(
      'airDate.asc',
      libraryType === 'show'
        ? globalT`First Air Date Ascending`
        : globalT`Release Date Ascending`,
    ),
    createMediaLibrarySortOption('rating.desc', globalT`Rating Descending`),
    createMediaLibrarySortOption('rating.asc', globalT`Rating Ascending`),
    createMediaLibrarySortOption(
      'watchCount.desc',
      globalT`Media server - Most played`,
    ),
    createMediaLibrarySortOption(
      'watchCount.asc',
      globalT`Media server - Least played`,
    ),
  )

  return options
}

export const getMediaLibrarySortConfig = (
  libraryType?: MediaLibrary['type'],
  includeStudioSort: boolean = false,
  sources: readonly MediaAnalyticsSource[] = [],
): SortConfig<BrowseLibrarySortParams> => {
  return {
    defaultValue: defaultOverviewSortValue,
    options: [
      createMediaLibrarySortOption(
        defaultOverviewSortValue,
        titleAscendingSortLabel(),
      ),
      ...getMediaLibrarySortOptions(libraryType, {
        includeTitleAscending: false,
        includeStudioSort,
      }),
      createMediaLibrarySortOption('manual.desc', globalT`Manual Added First`),
      createMediaLibrarySortOption('excluded.desc', globalT`Excluded First`),
      ...analyticsOptions(sources),
    ],
  }
}

export const getCollectionSortConfig = (
  libraryType?: MediaLibrary['type'],
  defaultLabel?: string,
  includeStudioSort: boolean = false,
  sources: readonly MediaAnalyticsSource[] = [],
): SortConfig<BrowseLibrarySortParams> => {
  return {
    defaultValue: defaultSortValue,
    options: [
      {
        value: defaultSortValue,
        label: defaultLabel ?? globalT`Recently Excluded`,
      },
      ...getMediaLibrarySortOptions(libraryType, { includeStudioSort }),
      ...analyticsOptions(sources),
    ],
  }
}

const collectionDeleteSoonestSortOption =
  (): SortOption<CollectionMediaSortParams> => ({
    value: 'deleteSoonest.asc',
    label: globalT`Delete Soonest`,
    sortParams: { sort: 'deleteSoonest', sortOrder: 'asc' },
  })

const collectionDeleteLatestSortOption =
  (): SortOption<CollectionMediaSortParams> => ({
    value: 'deleteSoonest.desc',
    label: globalT`Delete Latest`,
    sortParams: { sort: 'deleteSoonest', sortOrder: 'desc' },
  })

export const getCollectionMediaSortConfig = (
  libraryType?: MediaLibrary['type'],
  includeDeleteSoonest: boolean = false,
  includeStudioSort: boolean = false,
  includeStatusSorts: boolean = false,
  sources: readonly MediaAnalyticsSource[] = [],
): SortConfig<BrowseSortParams> => {
  const options = getCollectionSortConfig(
    libraryType,
    globalT`Recently Added`,
    includeStudioSort,
    sources,
  )
    .options.map((option) => ({
      value: option.value,
      label: option.label,
      sortParams: option.sortParams
        ? {
            sort: option.sortParams.sort,
            sortOrder: option.sortParams.sortOrder,
          }
        : undefined,
    }))
    // When Delete Soonest/Latest are present they replace the empty-string
    // fallback, which would otherwise surface as a meaningless duplicate.
    .filter(
      (option) => !includeDeleteSoonest || option.value !== defaultSortValue,
    )

  const resolvedOptions = includeDeleteSoonest
    ? [
        collectionDeleteSoonestSortOption(),
        collectionDeleteLatestSortOption(),
        ...options,
      ]
    : options

  return {
    defaultValue: includeDeleteSoonest
      ? collectionDeleteSoonestSortOption().value
      : defaultSortValue,
    // Opt-in, and only the collection media page opts in. The rule group form
    // persists its selection as the order pushed to the media server, which is
    // resolved without Maintainerr state, and the exclusions tab shares the
    // config this builds on while listing nothing but exclusions.
    options: includeStatusSorts
      ? [
          ...resolvedOptions,
          createMediaLibrarySortOption(
            'manual.desc',
            globalT`Manual Added First`,
          ),
          createMediaLibrarySortOption(
            'excluded.desc',
            globalT`Excluded First`,
          ),
        ]
      : resolvedOptions,
  }
}

export const sortMediaItems = (
  items: MediaItem[],
  sortParams?: MediaLibrarySortParams,
): MediaItem[] => {
  const resolvedSortParams: MediaLibrarySortParams = sortParams ?? {
    sort: 'title',
    sortOrder: 'asc',
  }

  return [...items].sort((leftItem, rightItem) =>
    compareMediaItemsBySort(
      leftItem,
      rightItem,
      resolvedSortParams.sort,
      resolvedSortParams.sortOrder,
    ),
  )
}

interface MediaLibrarySortControlProps {
  ariaLabel: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  onSortChange: (value: string) => void
  isLoading?: boolean
  analyticsFeedback?: AnalyticsBrowseFeedback
  onRetry?: () => void
}

export const useMediaLibrarySort = <TSortParams extends SortParams>(
  config: SortConfig<TSortParams>,
) => {
  const [sortValue, setSortValue] = useState(config.defaultValue)
  const [retainedAnalyticsOption, setRetainedAnalyticsOption] =
    useState<SortOption<TSortParams>>()
  const sortUnavailable = Boolean(
    retainedAnalyticsOption &&
    retainedAnalyticsOption.value === sortValue &&
    !config.options.some((option) => option.value === sortValue),
  )
  const retainedLabel =
    retainedAnalyticsOption &&
    isAnalyticsBrowseSort(retainedAnalyticsOption.sortParams)
      ? (analyticsOptions([
          getMediaAnalyticsSortSource(retainedAnalyticsOption.sortParams.sort),
        ]).find((option) => option.value === retainedAnalyticsOption.value)
          ?.label ?? retainedAnalyticsOption.label)
      : ''
  const options =
    sortUnavailable && retainedAnalyticsOption
      ? [
          ...config.options,
          {
            ...retainedAnalyticsOption,
            label: globalT`${retainedLabel} (unavailable)`,
          },
        ]
      : config.options
  const resolvedSortOption = getResolvedSortOption(
    options,
    sortValue,
    config.defaultValue,
  )

  const onSortChange = (nextValue: string) => {
    const nextSortOption = getSortOptionByValue(options, nextValue)
    if (!nextSortOption || nextSortOption.value === resolvedSortOption.value) {
      return undefined
    }

    setRetainedAnalyticsOption(
      isAnalyticsBrowseSort(nextSortOption.sortParams)
        ? nextSortOption
        : undefined,
    )
    setSortValue((currentValue) =>
      currentValue === nextSortOption.value
        ? currentValue
        : nextSortOption.value,
    )

    return nextSortOption
  }

  return {
    options,
    sortUnavailable,
    sortValue: resolvedSortOption.value,
    sortParams: resolvedSortOption.sortParams,
    onSortChange,
  }
}

export const MediaLibrarySortControl = ({
  ariaLabel,
  options,
  value,
  onSortChange,
  isLoading = false,
  analyticsFeedback,
  onRetry,
}: MediaLibrarySortControlProps) => {
  const { t, i18n } = useLingui()
  const activeFeedback = isMediaAnalyticsSort(value.split('.')[0] ?? '')
    ? analyticsFeedback
    : undefined
  const updatedAt =
    activeFeedback?.status === 'ready'
      ? new Date(activeFeedback.updatedAt)
      : undefined
  const updatedDate =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? new Intl.DateTimeFormat(i18n.locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(updatedAt)
      : undefined

  return (
    <div className="relative w-full">
      <Select
        aria-label={ariaLabel}
        name="sort"
        value={value}
        onChange={(event) => onSortChange(event.target.value)}
        className={isLoading ? 'pr-14' : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {activeFeedback?.status === 'preparing' &&
      value.startsWith('streamystats') ? (
        <p className="mt-1 text-xs text-zinc-400">{t`Preparing cached Streamystats statistics. The first use may take a while.`}</p>
      ) : null}
      {updatedDate ? (
        <p className="mt-1 text-xs text-zinc-400">{t`Statistics updated ${updatedDate}`}</p>
      ) : null}
      {activeFeedback?.status === 'preparing' ? (
        <p role="status" className="mt-1 text-xs text-zinc-300">
          {activeFeedback.total == null
            ? t`Preparing analytics sort...`
            : t`Preparing analytics sort: ${activeFeedback.completed} of ${activeFeedback.total}`}
        </p>
      ) : null}
      {activeFeedback?.status === 'error' ? (
        <div role="alert" className="mt-1 text-xs text-error-400">
          {activeFeedback.message}{' '}
          {onRetry ? (
            <button
              type="button"
              className="underline"
              onClick={onRetry}
            >{t`Retry`}</button>
          ) : null}
        </div>
      ) : null}
      {isLoading && !activeFeedback ? (
        <div
          role="status"
          aria-label={t`Loading sorted items`}
          className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2"
        >
          <SmallLoadingSpinner className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  )
}
