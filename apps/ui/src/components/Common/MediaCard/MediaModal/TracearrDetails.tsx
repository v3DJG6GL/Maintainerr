import { Trans, useLingui } from '@lingui/react/macro'
import { useMediaPlaybackSummary } from '../../../../api/media-analytics'
import { SmallLoadingSpinner } from '../../LoadingSpinner'

interface TracearrDetailsProps {
  itemId: string
  sourceKey: string
}

const formatWatchTime = (
  milliseconds: number | null,
  locale: string,
): string => {
  if (
    milliseconds == null ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  )
    return '-'
  // Preserve short sessions rather than rounding them to zero minutes.
  const seconds =
    milliseconds > 0 ? Math.max(1, Math.round(milliseconds / 1000)) : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  const unit = (value: number, name: string) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'short',
    }).format(value)
  return [
    hours ? unit(hours, 'hour') : '',
    minutes ? unit(minutes, 'minute') : '',
    remainder || seconds === 0 ? unit(remainder, 'second') : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export default function TracearrDetails({
  itemId,
  sourceKey,
}: TracearrDetailsProps) {
  const { i18n } = useLingui()
  const query = useMediaPlaybackSummary(itemId, 'tracearr', sourceKey)
  const data = query.data
  const lastPlayed = data?.lastPlayedAt ? new Date(data.lastPlayedAt) : null
  const lastPlayedLabel =
    lastPlayed && !Number.isNaN(lastPlayed.getTime())
      ? lastPlayed.toLocaleDateString(i18n.locale)
      : '-'

  return (
    <section className="mt-4 min-h-30 rounded-xl bg-zinc-900/70 p-3 text-sm">
      <h3 className="font-semibold text-white">Tracearr</h3>
      {query.isPending ? (
        <div className="mt-3 flex h-16 items-center">
          <SmallLoadingSpinner className="h-6 w-6" />
        </div>
      ) : query.isError ? (
        <div className="mt-2 text-error-400">
          <p>
            <Trans>Failed to load Tracearr data</Trans>
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
          <Trans>No Tracearr data available for this item.</Trans>
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {data.playCount === 0 ? (
            <p className="text-zinc-100/80">
              <Trans>No watch history recorded yet.</Trans>
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Plays</Trans>
              </dt>
              <dd>
                {data.playCount == null
                  ? '-'
                  : new Intl.NumberFormat(i18n.locale).format(data.playCount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Total watch time</Trans>
              </dt>
              <dd>{formatWatchTime(data.totalWatchTimeMs, i18n.locale)}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-zinc-100/60 uppercase">
                <Trans>Last played</Trans>
              </dt>
              <dd>{lastPlayedLabel}</dd>
            </div>
          </dl>
          <p className="text-xs text-zinc-100/60">
            <Trans>Includes recorded plays that were not completed.</Trans>
          </p>
        </div>
      )}
    </section>
  )
}
