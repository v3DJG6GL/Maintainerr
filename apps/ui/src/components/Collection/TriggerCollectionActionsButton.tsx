import { PlayIcon } from '@heroicons/react/solid'
import { t as globalT } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { toast } from 'react-toastify'
import { triggerCollectionActions } from '../../api/collections'
import { useTaskStatusContext } from '../../contexts/taskstatus-context'
import ConfirmActionButton from '../Common/ConfirmActionButton'
import ExecuteButton from '../Common/ExecuteButton'
import { getActionSummary } from './CollectionDetail/TriggerRuleActionButton'
import type { ICollection } from './index'

const mutationKey = ['collections', 'trigger-actions']

interface TriggerCollectionActionsButtonProps {
  collection?: Pick<
    ICollection,
    'id' | 'title' | 'isActive' | 'type' | 'arrAction' | 'sportarrSettingsId'
  >
  className?: string
}

const TriggerCollectionActionsButton = ({
  collection,
  className,
}: TriggerCollectionActionsButtonProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { collectionHandlerRunning } = useTaskStatusContext()
  const pending = useIsMutating({ mutationKey }) > 0
  const inactive = collection?.isActive === false
  const invalidScope =
    collection !== undefined &&
    (collection.id === undefined ||
      !Number.isSafeInteger(collection.id) ||
      collection.id <= 0)
  const collectionTitle = collection?.title ?? ''
  const disabled =
    invalidScope || inactive || pending || collectionHandlerRunning
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => {
      if (invalidScope) throw new Error('A saved collection is required.')
      return triggerCollectionActions(collection?.id)
    },
    retry: false,
    onSuccess: () => {
      toast.success(
        collection
          ? globalT`Initiated rule actions for ${collectionTitle} in the background, bypassing countdowns.`
          : globalT`Initiated collection handling in the background.`,
      )
    },
    onError: (error) => {
      // The scoped confirmation keeps errors in its dialog for retry.
      if (!collection)
        toast.error(
          isAxiosError(error) && error.response?.status === 409
            ? globalT`Collection handling is already running.`
            : globalT`Failed to initiate collection handling.`,
        )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['taskstatus_collectionhandler'],
      })
    },
  })

  const trigger = async () => {
    // Read shared state before submitting, including adjacent pre-render clicks.
    if (disabled || queryClient.isMutating({ mutationKey })) return
    await mutation.mutateAsync()
  }

  if (collection) {
    const actionSummary = getActionSummary(collection)
    return (
      <ConfirmActionButton
        buttonLabel={t`Trigger Rule Actions`}
        buttonIcon={<PlayIcon className="mr-2 h-4 w-4" />}
        buttonType="primary"
        buttonClassName={className}
        modalTitle={t`Trigger Rule Actions`}
        confirmLabel={t`Trigger now`}
        pendingLabel={t`Triggering...`}
        disabled={disabled}
        confirmDisabled={disabled}
        errorMessage={t`Failed to trigger rule actions for this collection.`}
        errorLogSummary="Failed to trigger rule actions for a collection"
        errorContext="TriggerCollectionActionsButton.trigger"
        onConfirm={trigger}
      >
        <p>
          <Trans>
            This will immediately run the configured action for eligible items
            in{' '}
            <span className="font-semibold text-zinc-100">
              {collectionTitle}
            </span>
            , across all pages.
          </Trans>
        </p>
        <p className="mt-3">
          <Trans>
            Action for each item:{' '}
            <span className="font-semibold text-zinc-100">{actionSummary}</span>
            .
          </Trans>
        </p>
        <p className="mt-3">
          <Trans>
            Countdowns will be ignored. Exclusions, active playback protection,
            failed rule evaluation safeguards, and the collection's active
            status will still be respected.
          </Trans>
        </p>
        <p className="mt-3">
          <Trans>
            Items whose actions succeed will be removed from the collection
            right away. Processing continues in the background.
          </Trans>
        </p>
      </ConfirmActionButton>
    )
  }

  return (
    <ExecuteButton
      className={`mx-0 ${className ?? ''}`}
      text={t`Handle Collections`}
      title={t`Runs configured rule actions only on due items in all active collections, respecting countdowns, exclusions, and active playback protection.`}
      executing={pending || collectionHandlerRunning}
      disabled={disabled}
      onClick={() => {
        void trigger().catch(() => {
          /* Reported by the mutation. */
        })
      }}
    />
  )
}

export default TriggerCollectionActionsButton
