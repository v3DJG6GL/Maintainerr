export type MediaAnalyticsSource = 'tracearr' | 'streamystats'

export interface MediaAnalyticsPreparation {
  status: 'preparing'
  snapshotId: string
  completed: number
  total: number | null
}

export type MediaAnalyticsPage<T> =
  | MediaAnalyticsPreparation
  | {
      status: 'ready'
      snapshotId: string
      updatedAt: string
      totalSize: number
      items: T[]
    }

export interface MediaPlaybackSummary {
  source: MediaAnalyticsSource
  playCount: number | null
  totalWatchTimeMs: number | null
  lastPlayedAt: string | null
}

export interface MediaPlaybackUser {
  id: string
  name: string | null
  playCount: number | null
  totalWatchTimeMs: number | null
  lastPlayedAt: string | null
}

/** Detailed analytics are fetched only when opening an item's details. */
export interface MediaPlaybackDetails extends MediaPlaybackSummary {
  externalUrl: string | null
  averageCompletionPercent: number | null
  users: MediaPlaybackUser[] | null
  episodes: {
    playedEpisodes: number | null
    totalEpisodes: number | null
    seasonsWithPlayback: number | null
  } | null
}

export const mediaAnalyticsSortFields = [
  'tracearrPlayCount',
  'tracearrWatchTime',
  'streamystatsPlayCount',
  'streamystatsWatchTime',
] as const

export type MediaAnalyticsSortField = (typeof mediaAnalyticsSortFields)[number]

export const isMediaAnalyticsSort = (
  value: string,
): value is MediaAnalyticsSortField =>
  mediaAnalyticsSortFields.some((field) => field === value)

export const getMediaAnalyticsSortSource = (
  sort: MediaAnalyticsSortField,
): MediaAnalyticsSource =>
  sort.startsWith('tracearr') ? 'tracearr' : 'streamystats'
