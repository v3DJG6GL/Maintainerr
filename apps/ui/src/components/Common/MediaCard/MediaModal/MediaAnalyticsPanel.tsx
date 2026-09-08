import type { MediaAnalyticsSource } from '@maintainerr/contracts'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useMediaPlaybackDetails } from '../../../../api/media-analytics'
import BrandLink from '../../BrandLink'
import { SmallLoadingSpinner } from '../../LoadingSpinner'

interface MediaAnalyticsPanelProps {
  source: MediaAnalyticsSource
  itemId: string
  sourceKey: string
  itemUrl: string
}

const sourceNames = {
  tracearr: 'Tracearr',
  streamystats: 'Streamystats',
} as const
const knownNumber = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0

const formatDuration = (
  milliseconds: number | null,
  locale: string,
): string => {
  if (!knownNumber(milliseconds)) return '-'
  const unit = (value: number, name: string) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'short',
    }).format(value)
  if (milliseconds === 0) return unit(0, 'minute')
  const seconds = Math.max(1, Math.round(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [
    hours ? unit(hours, 'hour') : '',
    minutes ? unit(minutes, 'minute') : '',
    remainder ? unit(remainder, 'second') : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const formatDate = (value: string | null, locale: string): string => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString(locale)
}

const safeExternalUrl = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

const MediaAnalyticsContent = ({
  source,
  itemId,
  sourceKey,
  itemUrl,
}: MediaAnalyticsPanelProps) => {
  const { i18n, t } = useLingui()
  const query = useMediaPlaybackDetails(itemId, source, sourceKey)
  const [expanded, setExpanded] = useState(false)
  const data = query.data
  const sourceName = sourceNames[source]
  const externalUrl =
    safeExternalUrl(data?.externalUrl) ?? safeExternalUrl(itemUrl)
  const count = (value: number | null) =>
    knownNumber(value) ? new Intl.NumberFormat(i18n.locale).format(value) : '-'
  const collator = new Intl.Collator(i18n.locale)
  const users = data?.users
    ?.map((user) => ({ ...user, displayName: user.name?.trim() || user.id }))
    .sort(
      (left, right) =>
        collator.compare(left.displayName, right.displayName) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
  const userCount = users?.length ?? 0
  const playedEpisodes = data?.episodes?.playedEpisodes
  const totalEpisodes = data?.episodes?.totalEpisodes
  const seasonsWithPlayback = data?.episodes?.seasonsWithPlayback

  return (
    <section className="mt-4 min-h-30 rounded-xl bg-zinc-900/70 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-white">{sourceName}</h3>
        {externalUrl ? (
          <BrandLink
            external
            href={externalUrl}
            className="text-xs no-underline"
          >
            <Trans>View on {sourceName}</Trans> &rarr;
          </BrandLink>
        ) : null}
      </div>
      {query.isPending ? (
        <div className="mt-3 flex h-16 items-center">
          <SmallLoadingSpinner className="h-6 w-6" />
        </div>
      ) : query.isError ? (
        <div className="mt-2 text-error-400">
          <p>
            <Trans>Failed to load {sourceName} data</Trans>
          </p>
          <button
            type="button"
            className="mt-2 underline"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch()
            }}
          >
            <Trans>Retry</Trans>
          </button>
        </div>
      ) : !data ? (
        <p className="mt-2 text-zinc-100/80">
          <Trans>No {sourceName} data available for this item.</Trans>
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {data.playCount === 0 ? (
            <p className="text-zinc-100/80">
              <Trans>No watch history recorded yet.</Trans>
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Plays</Trans>
              </dt>
              <dd className="font-medium">{count(data.playCount)}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Total watch time</Trans>
              </dt>
              <dd className="font-medium">
                {formatDuration(data.totalWatchTimeMs, i18n.locale)}
              </dd>
            </div>
            <div>
              <dt
                className="text-xs tracking-wide text-zinc-100/60 uppercase"
                title={t`Average completion of recorded playback sessions.`}
              >
                <Trans>Average completion</Trans>
              </dt>
              <dd className="font-medium">
                {knownNumber(data.averageCompletionPercent)
                  ? new Intl.NumberFormat(i18n.locale, {
                      style: 'percent',
                      maximumFractionDigits: 0,
                    }).format(data.averageCompletionPercent / 100)
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Last played</Trans>
              </dt>
              <dd className="font-medium">
                {formatDate(data.lastPlayedAt, i18n.locale)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-zinc-100/60">
            <Trans>Includes recorded plays that were not completed.</Trans>
          </p>
          {knownNumber(playedEpisodes) || knownNumber(seasonsWithPlayback) ? (
            <p className="text-xs text-zinc-100/60">
              {knownNumber(playedEpisodes) ? (
                <span>
                  {knownNumber(totalEpisodes) ? (
                    <Trans>
                      {playedEpisodes}/{totalEpisodes} episodes played
                    </Trans>
                  ) : (
                    <Plural
                      value={playedEpisodes}
                      one="# episode played"
                      other="# episodes played"
                    />
                  )}
                </span>
              ) : null}
              {knownNumber(playedEpisodes) && knownNumber(seasonsWithPlayback)
                ? ' · '
                : null}
              {knownNumber(seasonsWithPlayback) ? (
                <span>
                  <Plural
                    value={seasonsWithPlayback}
                    one="# season with playback"
                    other="# seasons with playback"
                  />
                </span>
              ) : null}
            </p>
          ) : null}
          {users == null ? (
            <p className="text-xs text-zinc-100/60">
              <Trans>User statistics unavailable.</Trans>
            </p>
          ) : users.length ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-700/50">
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
                      <Trans>Last played</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(expanded ? users : users.slice(0, 5)).map((row) => (
                    <tr key={row.id} className="border-t border-zinc-700/50">
                      <td className="px-2 py-1">{row.displayName}</td>
                      <td className="px-2 py-1 text-right">
                        {count(row.playCount)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {formatDuration(row.totalWatchTimeMs, i18n.locale)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {formatDate(row.lastPlayedAt, i18n.locale)}
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
    </section>
  )
}

export default function MediaAnalyticsPanel(props: MediaAnalyticsPanelProps) {
  return (
    <MediaAnalyticsContent
      key={`${props.source}:${props.sourceKey}:${props.itemId}`}
      {...props}
    />
  )
}
