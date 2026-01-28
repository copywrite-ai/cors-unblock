import { binaryStringToArrayBuffer, serializeRequest } from '@/lib/serialize'
import { messaging } from '@/lib/messaging'
import { internalMessaging } from 'cors-unblock/internal'
import { isMobile } from 'is-mobile'

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  async main() {
    document.documentElement.dataset.corsUnblock = 'true'

    internalMessaging.onMessage('getAllowedInfo', () =>
      messaging.sendMessage('getAllowedInfo', {
        origin: location.origin,
      }),
    )
    let _resolve: (action: 'accept' | 'reject') => void
    internalMessaging.onMessage('requestHosts', async (ev) => {
      if (
        // TODO: https://bugzilla.mozilla.org/show_bug.cgi?id=1864284
        import.meta.env.FIREFOX ||
        isMobile({ tablet: true })
      ) {
        const result = confirm(
          `Allow cross-origin requests to the following domains: ${ev.data.hosts.join(
            ', ',
          )}?`,
        )
        if (result) {
          await messaging.sendMessage('acceptRequestHosts', {
            origin: location.origin,
            hosts: ev.data.hosts,
          })
        }
        return result ? 'accept' : 'reject'
      }
      await messaging.sendMessage('requestHosts', {
        origin: location.origin,
        hosts: ev.data.hosts,
      })
      return new Promise<'accept' | 'reject'>((resolve) => {
        _resolve = resolve
      })
    })
    messaging.onMessage('accept', () => {
      _resolve?.('accept')
    })
    messaging.onMessage('reject', () => {
      _resolve?.('reject')
    })
    // safari debug only
    messaging.onMessage('log', (ev) => {
      console.log(ev.data)
    })
    // setInterval(async () => {
    //   const res = await messaging.sendMessage('ping', undefined)
    //   console.log('[content] ping', res)
    // }, 1000)

    if (import.meta.env.SAFARI) {
      internalMessaging.onMessage('request', async (ev) =>
        messaging.sendMessage('request', {
          ...ev.data,
          origin: location.origin,
        }),
      )
      await injectScript('/inject.js')
    }

    // Support gitbrowser-ai custom message protocol
    window.addEventListener('message', async (event) => {
      if (
        event.data?.type === 'GIT_FETCH' &&
        event.data?.source === 'cors-unblock-inject'
      ) {
        const { id, data } = event.data
        try {
          // Properly wrap the request as a Request object so it can be serialized
          const req = new Request(data.url, {
            method: data.method,
            headers: data.headers,
            body: data.body,
          })
          const serializedReq = await serializeRequest(req)

          const result = await messaging.sendMessage('request', {
            ...serializedReq,
            origin: location.origin,
          })

          // Unpack formatted binary data for gitbrowser-ai
          let responseData = result.body
          if (result.body?.type === 'array-buffer') {
            responseData = new Uint8Array(
              binaryStringToArrayBuffer(result.body.value),
            )
          } else if (result.body?.type === 'json') {
            responseData = result.body.value
          } else if (result.body?.type === 'text') {
            responseData = result.body.value
          }

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
