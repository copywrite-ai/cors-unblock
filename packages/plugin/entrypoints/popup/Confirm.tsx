import { useMutation } from '@/lib'
import { messaging } from '@/lib/messaging'
import { useRouter } from '../../lib/router'
import { popupStore, ConfirmState } from '@/lib/store'
import { createSignal, onMount } from 'solid-js'

export function Confirm() {
  const router = useRouter()
  const [requestHosts, setRequestHosts] = createSignal<ConfirmState>()

  onMount(async () => {
    const requestHosts = await popupStore.getParams()
    if (!requestHosts) {
      router.push('/')
    }
    setRequestHosts(requestHosts)
  })

  const acceptMutation = useMutation({
    mutationFn: async () => {
      console.log('[popup] acceptMutation starting', requestHosts())
      try {
        await messaging.sendMessage('acceptRequestHosts', {
          origin: requestHosts()!.origin,
          hosts: requestHosts()!.hosts,
          tabId: requestHosts()!.tabId,
        })
        console.log('[popup] acceptRequestHosts message sent successfully')
        window.close()
      } catch (err) {
        console.error('[popup] acceptRequestHosts failed:', err)
      }
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async () => {
      console.log('[popup] rejectMutation starting', requestHosts())
      try {
        await messaging.sendMessage('rejectRequestHosts', {
          origin: requestHosts()!.origin,
          hosts: requestHosts()!.hosts,
          tabId: requestHosts()!.tabId,
        })
        console.log('[popup] rejectRequestHosts message sent successfully')
        window.close()
      } catch (err) {
        console.error('[popup] rejectRequestHosts failed:', err)
      }
    },
  })

  onMount(() => {
    browser.runtime.connect({ name: 'popup' })
  })

  return (
    <div>
      <div class="mb-4">
        <h1 class="text-xl font-bold text-gray-800 dark:text-gray-100">
          CORS Unblock
        </h1>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Cross-origin access request
        </p>
      </div>

      <div class="mb-6">
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div>
            <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
              Requesting Website
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {requestHosts()?.origin}
            </p>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <h2 class="text-sm font-medium text-gray-700 dark:text-gray-200">
          Requested Domains
        </h2>
        <div class="space-y-2">
          {requestHosts()?.hosts.map((host) => (
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {host}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex space-x-3">
        <button
          class="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
          onClick={rejectMutation.mutate}
        >
          Reject
        </button>
        <button
          class="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
          onClick={acceptMutation.mutate}
        >
          Accept
        </button>
      </div>
    </div>
  )
}
