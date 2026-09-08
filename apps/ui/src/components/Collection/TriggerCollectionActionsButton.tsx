import { t as globalT } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { toast } from 'react-toastify'
import { triggerCollectionActions } from '../../api/collections'
import { useTaskStatusContext } from '../../contexts/taskstatus-context'
import ExecuteButton from '../Common/ExecuteButton'
import type { ICollection } from './index'

const mutationKey = ['collections', 'trigger-actions']

interface TriggerCollectionActionsButtonProps {
  collection?: Pick<ICollection, 'id' | 'title' | 'isActive'>
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
          ? globalT`Initiated rule actions for due items in ${collectionTitle} in the background.`
          : globalT`Initiated rule actions for due items in all active collections in the background.`,
      )
    },
    onError: (error) => {
      toast.error(
        isAxiosError(error) && error.response?.status === 409
          ? globalT`Collection handling is already running.`
          : globalT`Failed to initiate rule actions.`,
      )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['taskstatus_collectionhandler'],
      })
    },
  })

  return (
    <ExecuteButton
      className={`mx-0 ${className ?? ''}`}
      text={t`Trigger Rule Actions`}
      ariaLabel={
        collection
          ? t`Trigger rule actions for due items in ${collectionTitle}`
          : t`Trigger rule actions for due items in all active collections`
      }
      title={
        invalidScope
          ? t`Save this collection before triggering rule actions.`
          : inactive
            ? t`This collection is inactive. Activate it to trigger rule actions.`
            : collection
              ? t`Runs configured rule actions only on due items in ${collectionTitle}, respecting countdowns, exclusions, and active playback protection.`
              : t`Runs configured rule actions only on due items in all active collections, respecting countdowns, exclusions, and active playback protection.`
      }
      executing={pending || collectionHandlerRunning}
      disabled={invalidScope || inactive || pending || collectionHandlerRunning}
      onClick={() => {
        // Read the shared mutation cache as well as render state so adjacent
        // buttons cannot submit twice before React paints the pending state.
        if (
          invalidScope ||
          inactive ||
          collectionHandlerRunning ||
          queryClient.isMutating({ mutationKey })
        )
          return
        mutation.mutate()
      }}
    />
  )
}

export default TriggerCollectionActionsButton
