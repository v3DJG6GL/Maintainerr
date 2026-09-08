import { Plural, Trans } from '@lingui/react/macro'
import { useState } from 'react'
import { useMediaStorageDetails } from '../../../../api/mediaStorage'
import { formatBytes } from '../../../../utils/formatBytes'
import { SmallLoadingSpinner } from '../../LoadingSpinner'

interface MediaStoragePanelProps {
  itemId: string
  serverId: string | null | undefined
}

const CopyPath = ({ path }: { path: string }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 text-xs break-all select-text">
        {path}
      </code>
      <button
        type="button"
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
        {state === 'error' ? <Trans>Select the path to copy it.</Trans> : null}
      </span>
    </div>
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
  const fileCount = data?.files.length ?? 0
  const size = data?.sizeBytes != null ? formatBytes(data.sizeBytes) : null

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
          {data.files.length || data.folders.length ? (
            <details key={requestKey}>
              <summary className="cursor-pointer text-maintainerr-500">
                <Plural
                  value={fileCount}
                  one="Files and folders (# file)"
                  other="Files and folders (# files)"
                />
              </summary>
              <div className="mt-3 space-y-3">
                {data.folders.map((path) => (
                  <div key={path}>
                    <p className="mb-1 text-xs text-zinc-100/60">
                      <Trans>Folder</Trans>
                    </p>
                    <CopyPath path={path} />
                  </div>
                ))}
                {data.files.map((file, index) => (
                  <div
                    key={`${file.itemId}:${file.sourceId}:${file.id ?? index}`}
                    className="space-y-1 border-t border-zinc-700/50 pt-2"
                  >
                    <p>{file.title}</p>
                    {file.path ? (
                      <CopyPath path={file.path} />
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
            </details>
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
