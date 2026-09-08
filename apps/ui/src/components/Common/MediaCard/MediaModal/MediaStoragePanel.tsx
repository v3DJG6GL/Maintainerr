import type { MediaStorageFile } from '@maintainerr/contracts'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { useMediaStorageDetails } from '../../../../api/mediaStorage'
import { formatBytes } from '../../../../utils/formatBytes'
import { SmallLoadingSpinner } from '../../LoadingSpinner'

interface MediaStoragePanelProps {
  itemId: string
  serverId: string | null | undefined
}

const filename = (path: string) =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) ||
  path

const CopyPath = ({
  path,
  filenameOnly = false,
}: {
  path: string
  filenameOnly?: boolean
}) => {
  const { t } = useLingui()
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 text-xs break-all select-text">
        {filenameOnly ? filename(path) : path}
      </code>
      <button
        type="button"
        title={t`Copy full path`}
        aria-label={t`Copy full path`}
        className="shrink-0 text-xs text-maintainerr-500 hover:underline"
        onClick={() => {
          void navigator.clipboard?.writeText(path).then(
            () => setState('copied'),
            () => setState('error'),
          )
          if (!navigator.clipboard) setState('error')
        }}
      >
        <Trans>Copy</Trans>
      </button>
      <span role="status" className="text-xs">
        {state === 'copied' ? <Trans>Copied</Trans> : null}
        {state === 'error' ? (
          filenameOnly ? (
            <Trans>Copy unavailable in this browser.</Trans>
          ) : (
            <Trans>Select the path to copy it.</Trans>
          )
        ) : null}
      </span>
    </div>
  )
}

interface SeasonFiles {
  id: string
  number?: number
  title?: string
  files: MediaStorageFile[]
}

const groupSeasons = (files: MediaStorageFile[]): SeasonFiles[] => {
  const groups = new Map<string, SeasonFiles>()
  for (const file of files) {
    const id =
      file.seasonId != null
        ? `id:${file.seasonId}`
        : file.seasonNumber != null
          ? `number:${file.seasonNumber}`
          : 'unknown'
    const group: SeasonFiles = groups.get(id) ?? {
      id,
      number: file.seasonNumber,
      title: file.seasonTitle,
      files: [],
    }
    group.number ??= file.seasonNumber
    group.title ||= file.seasonTitle
    group.files.push(file)
    groups.set(id, group)
  }
  return [...groups.values()].sort(
    (a, b) =>
      (a.number ?? Infinity) - (b.number ?? Infinity) ||
      a.id.localeCompare(b.id),
  )
}

const FileRows = ({
  files,
  filenameOnly,
}: {
  files: MediaStorageFile[]
  filenameOnly: boolean
}) => {
  // Keep alternate versions and multipart files under one episode heading.
  const episodes = new Map<string, MediaStorageFile[]>()
  for (const file of files) {
    const episode = episodes.get(file.itemId) ?? []
    episode.push(file)
    episodes.set(file.itemId, episode)
  }
  const ordered = [...episodes.values()].sort(
    (a, b) =>
      (a[0].episodeNumber ?? Infinity) - (b[0].episodeNumber ?? Infinity),
  )
  return (
    <div className="divide-y divide-zinc-700/50">
      {ordered.map((episode) => (
        <div key={episode[0].itemId} className="py-3 first:pt-0 last:pb-0">
          <div className="mb-2 flex items-baseline gap-2">
            {episode[0].episodeNumber != null ? (
              <span className="shrink-0 text-xs text-zinc-100/50 tabular-nums">
                {String(episode[0].episodeNumber).padStart(2, '0')}
              </span>
            ) : null}
            <p className="min-w-0 font-medium break-words">
              {episode[0].title}
            </p>
          </div>
          <div className="space-y-3">
            {episode.map((file, index) => (
              <div
                key={`${file.sourceId}:${file.id ?? index}`}
                className="space-y-1"
              >
                {file.path ? (
                  <CopyPath path={file.path} filenameOnly={filenameOnly} />
                ) : (
                  <p className="text-xs text-zinc-100/60">
                    <Trans>Path unavailable</Trans>
                  </p>
                )}
                <p className="text-xs text-zinc-100/60">
                  {file.sizeBytes != null ? (
                    formatBytes(file.sizeBytes)
                  ) : (
                    <Trans>Size unavailable</Trans>
                  )}
                  {[
                    file.videoResolution,
                    file.videoCodec,
                    file.audioCodec,
                    file.container,
                  ]
                    .filter(Boolean)
                    .map((value, valueIndex) => (
                      <span key={valueIndex}> &middot; {value}</span>
                    ))}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const SeasonGroup = ({
  season,
  completeSnapshot,
}: {
  season: SeasonFiles
  completeSnapshot: boolean
}) => {
  const [expanded, setExpanded] = useState(false)
  const seasonNumber = season.number
  const fileCount = season.files.length
  const sizes = season.files.filter((file) => file.sizeBytes != null)
  const complete = completeSnapshot && sizes.length === fileCount
  const size = sizes.length
    ? formatBytes(sizes.reduce((sum, file) => sum + file.sizeBytes!, 0))
    : null
  return (
    <details
      className="rounded-lg border border-zinc-700/50"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer rounded-lg px-3 py-2 text-maintainerr-500 focus-visible:outline focus-visible:outline-2">
        <span className="ml-1 font-medium">
          {seasonNumber === 0 ? (
            <Trans>Specials</Trans>
          ) : seasonNumber != null ? (
            <Trans>Season {seasonNumber}</Trans>
          ) : (
            season.title || <Trans>Other episodes</Trans>
          )}
        </span>
        <span className="ml-3 text-xs font-normal text-zinc-100/60">
          <Plural value={fileCount} one="# file" other="# files" />
          {size != null ? (
            <> &middot; {complete ? size : <Trans>At least {size}</Trans>}</>
          ) : null}
        </span>
      </summary>
      {expanded ? (
        <div className="border-t border-zinc-700/50 p-3">
          <FileRows files={season.files} filenameOnly />
        </div>
      ) : null}
    </details>
  )
}

export default function MediaStoragePanel({
  itemId,
  serverId,
}: MediaStoragePanelProps) {
  const requestKey = `${serverId ?? ''}:${itemId}`
  const { data, isPending, isFetching, refetch } = useMediaStorageDetails(
    itemId,
    serverId,
  )
  const loading = isPending && serverId != null
  const size = data?.sizeBytes != null ? formatBytes(data.sizeBytes) : null
  const grouped = data?.itemType === 'show' || data?.itemType === 'season'

  return (
    <section className="mt-4 min-h-24 rounded-xl bg-zinc-900/70 p-3 text-sm">
      <h3 className="font-semibold text-white">
        <Trans>Files &amp; storage</Trans>
      </h3>
      {loading ? (
        <div className="mt-3">
          <SmallLoadingSpinner className="h-6 w-6" />
        </div>
      ) : !data ? (
        <p className="mt-2 text-zinc-100/70">
          <Trans>File information is unavailable.</Trans>
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <p>
            {size == null ? (
              <Trans>Size unavailable</Trans>
            ) : data.status === 'complete' ? (
              size
            ) : (
              <Trans>At least {size}</Trans>
            )}
          </p>
          {data.status !== 'complete' ? (
            <p className="text-xs text-zinc-100/60">
              <Trans>
                Some file information could not be read. The total may be
                incomplete.
              </Trans>
            </p>
          ) : null}
          {data.folders.length ? (
            <div className="space-y-3">
              {data.folders.map((path) => (
                <div key={path}>
                  <p className="mb-1 text-xs text-zinc-100/60">
                    <Trans>Folder</Trans>
                  </p>
                  <CopyPath path={path} />
                </div>
              ))}
            </div>
          ) : null}
          {data.files.length ? (
            grouped ? (
              <div key={requestKey} className="space-y-2 pt-1">
                {groupSeasons(data.files).map((season) => (
                  <SeasonGroup
                    key={season.id}
                    season={season}
                    completeSnapshot={data.status === 'complete'}
                  />
                ))}
              </div>
            ) : (
              <div key={requestKey} className="pt-2">
                <FileRows
                  files={data.files}
                  filenameOnly={data.itemType === 'episode'}
                />
              </div>
            )
          ) : data.status === 'complete' ? (
            <p className="text-xs text-zinc-100/60">
              <Trans>No media files reported.</Trans>
            </p>
          ) : null}
        </div>
      )}
      {!loading && serverId != null && (!data || data.status !== 'complete') ? (
        <button
          type="button"
          className="mt-2 text-xs text-maintainerr-500 hover:underline disabled:opacity-50"
          disabled={isFetching}
          onClick={() => {
            void refetch()
          }}
        >
          <Trans>Retry</Trans>
        </button>
      ) : null}
    </section>
  )
}
