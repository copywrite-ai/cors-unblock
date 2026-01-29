import { binaryStringToArrayBuffer, deserializeBody, serializeRequest } from '@/lib/serialize'
import { messaging } from '@/lib/messaging'
import { internalMessaging } from 'cors-unblock/internal'
import { isMobile } from 'is-mobile'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main() {
    const allowedInfo = await messaging.sendMessage('getAllowedInfo', {
      origin: location.origin,
    })
    const isEnabled = allowedInfo.enabled

    let pendingResolvers: ((action: 'accept' | 'reject') => void)[] = []
    const requestHostsAction = async (hosts: string[]) => {
      const isFirst = pendingResolvers.length === 0
      const promise = new Promise<'accept' | 'reject'>((resolve) => {
        pendingResolvers.push(resolve)
      })

      if (isFirst) {
        if (
          // TODO: https://bugzilla.mozilla.org/show_bug.cgi?id=1864284
          import.meta.env.FIREFOX ||
          isMobile({ tablet: true })
        ) {
          const result = confirm(
            `Allow cross-origin requests to the following domains: ${hosts.join(
              ', ',
            )}?`,
          )
          if (result) {
            await messaging.sendMessage('acceptRequestHosts', {
              origin: location.origin,
              hosts: hosts,
            })
          }
          const action = result ? 'accept' : 'reject'
          const current = pendingResolvers
          pendingResolvers = []
          current.forEach((r) => r(action))
        } else {
          await messaging.sendMessage('requestHosts', {
            origin: location.origin,
            hosts: hosts,
          })
        }
      }
      return promise
    }

    messaging.onMessage('accept', () => {
      console.log(
        '[content] RECEIVED "accept" message from background. Resolving',
        pendingResolvers.length,
        'pending resolvers.',
      )
      const current = pendingResolvers
      pendingResolvers = []
      current.forEach((r) => r('accept'))
    })
    messaging.onMessage('reject', () => {
      console.log(
        '[content] RECEIVED "reject" message from background. Resolving',
        pendingResolvers.length,
        'pending resolvers.',
      )
      const current = pendingResolvers
      pendingResolvers = []
      current.forEach((r) => r('reject'))
    })

    if (isEnabled) {
      document.documentElement.dataset.corsUnblock = 'true'

      internalMessaging.onMessage('getAllowedInfo', () => {
        return messaging.sendMessage('getAllowedInfo', {
          origin: location.origin,
        })
      })

      internalMessaging.onMessage('requestHosts', (ev) => {
        if (!ev.data) return
        return requestHostsAction(ev.data.hosts)
      })

      // safari debug only
      messaging.onMessage('log', (ev) => {
        console.log(ev.data)
      })

      internalMessaging.onMessage('request', async (ev) => {
        if (!ev.data) return
        return messaging.sendMessage('request', {
          ...ev.data,
          origin: location.origin,
        })
      })
      await injectScript('/inject.js')
    }

    // Support gitbrowser-ai custom message protocol
    window.addEventListener('message', async (event) => {
      if (
        event.data?.type === 'GIT_FETCH' &&
        event.data?.source === 'cors-unblock-inject'
      ) {
        const { id, data } = event.data
        console.log('[content] Received GIT_FETCH for', data.url, 'id:', id)

        try {
          // Properly wrap the request as a Request object so it can be serialized
          const req = new Request(data.url, {
            method: data.method,
            headers: data.headers,
            body: data.body,
          })
          const serializedReq = await serializeRequest(req)

          const sendRequest = () => {
            console.log('[content] Sending serialized request to background for', data.url)
            return messaging.sendMessage('request', {
              ...serializedReq,
              origin: location.origin,
            })
          }

          let result: any
          try {
            result = await sendRequest()

            // Handle multi-part responses for large data
            if (result && result.type === 'multi-part') {
              console.log('[content] Receiving multi-part response, id:', result.id, 'chunks:', result.chunkCount)
              let fullJson = ''
              for (let i = 0; i < result.chunkCount; i++) {
                console.log('[content] Fetching chunk', i + 1, '/', result.chunkCount)
                const chunk = await messaging.sendMessage('getResponseChunk', { id: result.id, index: i })
                fullJson += chunk
              }
              result = JSON.parse(fullJson)
              console.log('[content] Reassembled multi-part response, size:', fullJson.length)
            }

            console.log('[content] Background request succeeded for', data.url, 'status:', result.status)
          } catch (error: any) {
            if (error.message === 'NEED_PERMISSION') {
              console.log('[content] Permission needed for', data.url, 'triggering UI')
              const host = new URL(data.url).hostname
              const status = await requestHostsAction([host])
              console.log('[content] Permission UI result:', status)
              if (status === 'accept') {
                result = await sendRequest()
              } else {
                throw error
              }
            } else {
              console.error('[content] Background request failed for', data.url, 'Error:', error.message)
              throw error
            }
          }

          // Unpack formatted binary data for gitbrowser-ai using robust deserializer
          let responseData: any = await deserializeBody(result.body);
          if (responseData instanceof ArrayBuffer) {
            responseData = new Uint8Array(responseData);
          }

          console.log('[content] Sending result back to page for', data.url, 'data size:', responseData?.length || responseData?.byteLength || '0')
          window.postMessage(
            {
              source: 'cors-unblock-content',
              id,
              result: {
                url: result.url || data.url,
                headers: result.headers,
                status: result.status,
                statusText: result.statusText,
                data: responseData,
              },
            },
            '*',
          )
        } catch (error: any) {
          console.error('[content] Error in GIT_FETCH flow for', data.url, error)
          window.postMessage(
            {
              source: 'cors-unblock-content',
              id,
              error: error.message,
            },
            '*',
          )
        }
      }
    })
  },
})
