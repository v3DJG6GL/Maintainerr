import { Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useStreamystatsItemDetails } from '../../../../../api/streamystats'
import BrandLink from '../../../BrandLink'
import { SmallLoadingSpinner } from '../../../LoadingSpinner'

interface StreamystatsStatsPanelProps {
  itemId: string
  itemUrl: string
}

// The app locale, not the browser's - the labels beside these dates follow
// the language picker, so the date format has to follow it too.
const formatDate = (
  value: string | null | undefined,
  locale: string,
): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString(locale)
}

const formatWatchTime = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '0m'
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

const StreamystatsStatsContent = ({
  itemId,
  itemUrl,
}: StreamystatsStatsPanelProps) => {
  const { i18n } = useLingui()
  const query = useStreamystatsItemDetails(itemId, itemUrl)
  const [expanded, setExpanded] = useState(false)
  const data = query.data
  const userCount = data?.usersWatched.length ?? 0

  // Named locals so the counts reach the catalog as readable placeholders.
  const episodeStats = data?.episodeStats
  const watchedEpisodes = episodeStats?.watchedEpisodes
  const totalEpisodes = episodeStats?.totalEpisodes
  const watchedSeasons = episodeStats?.watchedSeasons
  const totalSeasons = episodeStats?.totalSeasons

  return (
    <div className="mt-4 min-h-30 rounded-xl bg-zinc-900/70 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Streamystats</p>
        <BrandLink external href={itemUrl} className="text-xs no-underline">
          <Trans>View on Streamystats</Trans> &rarr;
        </BrandLink>
      </div>

      {query.isPending ? (
        <div className="mt-3 flex h-16 items-center">
          <SmallLoadingSpinner className="h-6 w-6" />
        </div>
      ) : query.isError ? (
        <div className="mt-2 text-sm text-error-400">
          <p>
            <Trans>Failed to load Streamystats data</Trans>
          </p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => void query.refetch()}
          >
            <Trans>Retry</Trans>
          </button>
        </div>
      ) : !data ? (
        <p className="mt-2 text-sm text-zinc-100/80">
          <Trans>No Streamystats data available for this item.</Trans>
        </p>
      ) : (
        <div className="mt-2 space-y-3 text-sm text-zinc-100">
          {data.totalViews === 0 ? (
            <p className="text-zinc-100/80">
              <Trans>No watch history recorded yet.</Trans>
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Plays</Trans>
              </dt>
              <dd className="font-medium">{data.totalViews}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Total watch time</Trans>
              </dt>
              <dd className="font-medium">
                {formatWatchTime(data.totalWatchTime)}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Completion</Trans>
              </dt>
              <dd className="font-medium">
                {Math.round(data.completionRate)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Last watched</Trans>
              </dt>
              <dd className="font-medium">
                {formatDate(data.lastWatched, i18n.locale)}
              </dd>
            </div>
          </dl>

          {episodeStats ? (
            <p className="text-xs text-zinc-100/60">
              <Trans>
                {watchedEpisodes}/{totalEpisodes} episodes watched
              </Trans>{' '}
              &middot;{' '}
              <Trans>
                {watchedSeasons}/{totalSeasons} seasons complete
              </Trans>
            </p>
          ) : null}

          {data.usersWatched.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-zinc-700/50">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-800/60 text-zinc-100">
                  <tr>
                    <th className="px-2 py-1 font-medium">
                      <Trans>User</Trans>
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      <Trans>Plays</Trans>
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      <Trans>Watch time</Trans>
                    </th>
                    <th className="px-2 py-1 text-right font-medium">
                      <Trans>Last watched</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(expanded
                    ? data.usersWatched
                    : data.usersWatched.slice(0, 5)
                  ).map((row) => (
                    <tr
                      key={row.user.id}
                      className="border-t border-zinc-700/50"
                    >
                      <td className="px-2 py-1 text-zinc-100">
                        {row.user.name ?? row.user.id}
                      </td>
                      <td className="px-2 py-1 text-right">{row.watchCount}</td>
                      <td className="px-2 py-1 text-right">
                        {formatWatchTime(row.totalWatchTime)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {formatDate(row.lastWatched, i18n.locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {userCount > 5 ? (
                <button
                  type="button"
                  className="w-full border-t border-zinc-700/50 px-2 py-2 text-left underline"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? (
                    <Trans>Show fewer users</Trans>
                  ) : (
                    <Trans>Show all {userCount} users</Trans>
                  )}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

const StreamystatsStatsPanel = (props: StreamystatsStatsPanelProps) => (
  <StreamystatsStatsContent
    key={`${props.itemUrl}:${props.itemId}`}
    {...props}
  />
)

export default StreamystatsStatsPanel
