import { dbApi } from '@/lib/db'
import { messaging } from '@/lib/messaging'
import { findRule } from '@/lib/rules'
import { deleteByOrigin } from '@/lib/rules'
import { deserializeRequest, serializeResponse, arrayBufferToBinaryString } from '@/lib/serialize'
import { popupStore } from '@/lib/store'
import { omit, uniq } from 'es-toolkit'
import { ulid } from 'ulidx'

async function getRuleId() {
  const { ruleId } = await browser.storage.local.get<{
    ruleId: number | undefined
  }>('ruleId')
  if (!ruleId) {
    await browser.storage.local.set({ ruleId: 1 })
    return 1
  }
  await browser.storage.local.set({ ruleId: ruleId + 1 })
  return ruleId + 1
}

type RuleActionType = Browser.declarativeNetRequest.RuleActionType
type HeaderOperation = Browser.declarativeNetRequest.HeaderOperation
type ResourceType = Browser.declarativeNetRequest.ResourceType
type DomainType = Browser.declarativeNetRequest.DomainType
type EnumValues<T extends string> = `${T}`

function createRule(
  ruleId: number,
  origin: string,
  hosts?: string[],
): Browser.declarativeNetRequest.Rule {
  const condition: Browser.declarativeNetRequest.RuleCondition = {
    initiatorDomains: [new URL(origin).hostname],
    resourceTypes: [
      'xmlhttprequest' satisfies EnumValues<ResourceType> as ResourceType,
      'image' satisfies EnumValues<ResourceType> as ResourceType,
    ],
    domainType: 'thirdParty' satisfies EnumValues<DomainType> as DomainType,
  }
  if (hosts) {
    condition.requestDomains = hosts
  } else {
    condition.urlFilter = '*'
  }
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: 'modifyHeaders' satisfies EnumValues<RuleActionType> as RuleActionType,
      responseHeaders: [
        {
          header: 'Access-Control-Allow-Origin',
          operation:
            'set' satisfies EnumValues<HeaderOperation> as HeaderOperation,
          value: origin,
        },
        {
          header: 'Access-Control-Allow-Methods',
          operation:
            'set' satisfies EnumValues<HeaderOperation> as HeaderOperation,
          value: 'PUT, GET, HEAD, POST, DELETE, OPTIONS, PATCH',
        },
        {
          header: 'Access-Control-Allow-Headers',
          operation:
            'set' satisfies EnumValues<HeaderOperation> as HeaderOperation,
          value: '*',
        },
        {
          header: 'Access-Control-Allow-Credentials',
          value: 'true',
          operation:
            'set' satisfies EnumValues<HeaderOperation> as HeaderOperation,
        },
        {
          header: 'Vary',
          value: 'Origin',
          operation:
            'set' satisfies EnumValues<HeaderOperation> as HeaderOperation,
        },
      ],
      requestHeaders: [
        {
          header: 'Origin',
          operation:
            'remove' satisfies EnumValues<HeaderOperation> as HeaderOperation,
        },
        {
          header: 'Referer',
          operation:
            'remove' satisfies EnumValues<HeaderOperation> as HeaderOperation,
        },
        {
          header: 'Host',
          operation:
            'remove' satisfies EnumValues<HeaderOperation> as HeaderOperation,
        },
        {
          header: 'Content-Length',
          operation:
            'remove' satisfies EnumValues<HeaderOperation> as HeaderOperation,
        },
      ],
    },
    condition,
  }
}

async function log(msg: string) {
  // const [tab] = await browser.tabs.query({
  //   active: true,
  //   currentWindow: true,
  // })
  // if (!tab) {
  //   return
  // }
  // messaging.sendMessage('log', '[background] ' + msg, { tabId: tab.id! })
}

async function onInit() {
  console.log('[background] onInit')
  const oldRules = await browser.declarativeNetRequest.getSessionRules()
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: oldRules.map((rule) => rule.id),
  })
  const rules = await dbApi.meta.getAll()
  let ruleId = 1
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      addRules: rules.map((rule) =>
        createRule(ruleId++, rule.origin, rule.hosts),
      ),
    })
  } finally {
    await browser.storage.local.set({ ruleId })
  }
}

export default defineBackground(() => {
  browser.runtime.onStartup.addListener(onInit)
  browser.runtime.onInstalled.addListener(onInit)

  messaging.onMessage('ping', async (ev) => {
    messaging.sendMessage('log', 'ping', ev.sender.tab.id)
    return 'pong'
  })
  messaging.onMessage('getAllowedInfo', async (ev) => {
    const rule = await findRule(ev.data.origin)
    if (!rule) {
      return {
        enabled: false,
        type: 'specific' as const,
        hosts: [],
      }
    }
    return {
      enabled: true,
      type: (rule.meta.hosts ? 'specific' : 'all') as 'all' | 'specific',
      hosts: rule.meta.hosts,
    }
  })
  messaging.onMessage('requestAllHosts', async (ev) => {
    const rule = await findRule(ev.data.origin)
    if (rule) {
      console.error('Rule already exists')
      return
    }
    const ruleId = await getRuleId()
    const newRule = createRule(ruleId, ev.data.origin)
    await browser.declarativeNetRequest.updateSessionRules({
      addRules: [newRule],
    })
    await dbApi.meta.add({
      id: ulid(),
      from: 'user',
      origin: ev.data.origin,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setIcon(ev.data.origin)
  })
  messaging.onMessage('requestHosts', async (ev) => {
    await popupStore.setParams({
      ...ev.data,
      tabId: ev.sender.tab?.id,
    })
    try {
      await browser.action.openPopup()
    } catch (err) {
      console.warn('[background] Failed to open popup automatically:', err)
      // Fallback: Notify user to click the extension icon
      browser.notifications.create('request-hosts', {
        type: 'basic',
        iconUrl: '/icon/enabled.png',
        title: 'CORS Unblock Permission Required',
        message: `Please click the extension icon to allow requests to: ${ev.data.hosts.join(
          ', ',
        )}`,
        priority: 2,
      })
    }
  })
  messaging.onMessage('acceptRequestHosts', async (ev) => {
    console.log('[background] Received acceptRequestHosts for:', ev.data.origin)
    let tabId = ev.data.tabId
    if (!tabId) {
      const params = await popupStore.getParams()
      tabId = params?.tabId
    }
    console.log('[background] acceptRequestHosts, target tabId:', tabId)

    const rule = await findRule(ev.data.origin)
    try {
      if (rule) {
        console.log('[background] Updating existing rule for:', ev.data.origin)
        rule.condition.requestDomains = uniq([
          ...(rule.meta.hosts ?? []),
          ...ev.data.hosts,
        ])
        await browser.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [rule.id],
          addRules: [omit(rule, ['meta'])],
        })
        await dbApi.meta.update({
          ...rule.meta,
          hosts: rule.condition.requestDomains,
          updatedAt: new Date().toISOString(),
        })
      } else {
        console.log('[background] Creating new rule for:', ev.data.origin)
        await browser.declarativeNetRequest.updateSessionRules({
          addRules: [
            createRule(await getRuleId(), ev.data.origin, ev.data.hosts),
          ],
        })
        await dbApi.meta.add({
          id: ulid(),
          from: 'website',
          origin: ev.data.origin,
          hosts: ev.data.hosts,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (err) {
      console.error('[background] acceptRequestHosts DB/DNR error:', err)
      throw err
    }

    console.log('[background] Sending "accept" message to tabId:', tabId)
    try {
      if (tabId) {
        await messaging.sendMessage('accept', undefined, { tabId })
        console.log('[background] "accept" message sent successfully to tabId:', tabId)
      } else {
        console.warn('[background] No tabId found in store, falling back to active tab query')
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        })
        if (tab?.id) {
          await messaging.sendMessage('accept', undefined, { tabId: tab.id })
          console.log('[background] "accept" message sent successfully to active tab:', tab.id)
        } else {
          console.error('[background] Could not find any tab to send "accept" to')
        }
      }
    } catch (err) {
      console.error('[background] Failed to send "accept" message to tab:', err)
    }

    await popupStore.removeParams()
    setIcon(ev.data.origin)
  })
  messaging.onMessage('rejectRequestHosts', async (ev) => {
    console.log('[background] Received rejectRequestHosts for:', ev.data.origin)
    let tabId = ev.data.tabId
    if (!tabId) {
      const params = await popupStore.getParams()
      tabId = params?.tabId
    }
    console.log('[background] rejectRequestHosts, target tabId:', tabId)
    setIcon(ev.data.origin)
    try {
      if (tabId) {
        await messaging.sendMessage('reject', undefined, { tabId })
        console.log('[background] "reject" message sent successfully to tabId:', tabId)
      } else {
        console.warn('[background] No tabId found in store for reject, falling back to active tab query')
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        })
        if (tab?.id) {
          await messaging.sendMessage('reject', undefined, { tabId: tab.id })
          console.log('[background] "reject" message sent successfully to active tab:', tab.id)
        }
      }
    } catch (err) {
      console.error('[background] Failed to send "reject" message to tab:', err)
    }
    await popupStore.removeParams()
  })
  // TODO https://stackoverflow.com/a/15801294/8409380
  // https://issues.chromium.org/issues/41069221
  browser.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(async () => {
      console.log('[background] popup disconnected')
      const params = await popupStore.getParams()
      const tabId = params?.tabId
      console.log('[background] popup disconnected, target tabId from store:', tabId)
      try {
        if (tabId) {
          await messaging.sendMessage('reject', undefined, { tabId })
          console.log('[background] "reject" message sent successfully to tabId:', tabId)
        } else {
          console.warn('[background] No tabId found in store on disconnect, falling back to active tab query')
          const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          })
          if (tab?.id) {
            await messaging.sendMessage('reject', undefined, { tabId: tab.id })
            console.log('[background] "reject" message sent successfully to active tab:', tab.id)
          }
        }
      } catch (err) {
        console.error('[background] Failed to send "reject" message on disconnect:', err)
      }
      await popupStore.removeParams()
      console.log('[background] Popup parameters removed after disconnect.')
    })
  })
  messaging.onMessage('delete', async (ev) => {
    await deleteByOrigin(ev.data.origin)
    setIcon()
  })
  messaging.onMessage('getAllRules', async () => {
    return await dbApi.meta.getAll()
  })

  // Large response chunk storage
  const responseChunks = new Map<string, any[]>()

  messaging.onMessage('getResponseChunk', (ev) => {
    const { id, index } = ev.data
    const chunks = responseChunks.get(id)
    if (!chunks) throw new Error('Chunks not found')
    const chunk = chunks[index]
    if (index === chunks.length - 1) {
      // Clean up after last chunk
      setTimeout(() => responseChunks.delete(id), 1000)
    }
    return chunk
  })
  messaging.onMessage('request', async (ev) => {
    const origin = ev.data.origin
    const url = ev.data.url
    const rule = await findRule(origin)
    const host = new URL(url).hostname

    console.log(`[background] Incoming request from ${origin} to ${host} (URL: ${url})`)
    console.log(`[background] Rule status for ${host}:`, rule ? `Found (ID: ${rule.id})` : 'Not Found')

    if (
      !rule ||
      (rule.meta.from === 'website' && !rule.meta.hosts?.includes(host))
    ) {
      console.warn(`[background] Denying request to ${host}: NEED_PERMISSION`)
      throw new Error('NEED_PERMISSION')
    }

    try {
      const req = await deserializeRequest(ev.data)
      // Strip forbidden/dangerous headers that might cause server to reject
      const forbiddenHeaders = ['Origin', 'Referer', 'Host', 'Content-Length']
      forbiddenHeaders.forEach(h => req.headers.delete(h))

      console.log(`[background] Fetching ${url}... with method ${req.method}`)
      console.log(`[background] Custom headers:`, Object.fromEntries(req.headers.entries()))

      const resp = await fetch(req, { redirect: 'follow' })
      console.log(`[background] Fetch complete for ${url}, status: ${resp.status} ${resp.statusText}`)

      const serialized = await serializeResponse(resp)
      console.log(`[background] Response serialized for ${url}, body type: ${serialized.body?.type}`)

      // Flatten stream bodies immediately so we can accurately measure size
      let finalBody: any = serialized.body?.value;
      if (serialized.body?.type === 'readable-stream' && Array.isArray(finalBody)) {
        const totalLength = finalBody.reduce((acc: number, c: any) => acc + (c.length || 0), 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of finalBody) {
          combined.set(new Uint8Array(chunk), offset);
          offset += chunk.length;
        }
        finalBody = arrayBufferToBinaryString(combined);
        serialized.body.type = 'array-buffer';
        serialized.body.value = finalBody;
      }

      // Final consistency check: all array-buffer values should be binary strings by now
      // (from serialize.ts or the stream flattening above)
      const bodyStr = typeof finalBody === 'string' ? finalBody : '';
      const THRESHOLD = 2 * 1024 * 1024 // 2MB threshold for body chunking

      if (bodyStr.length > THRESHOLD) {
        console.log(`[background] Body too large (${bodyStr.length} bytes), chunking body...`)

        const id = ulid()
        const CHUNK_SIZE = 1 * 1024 * 1024 // 1MB string chunks to be absolutely safe
        const chunks: string[] = []

        for (let i = 0; i < bodyStr.length; i += CHUNK_SIZE) {
          chunks.push(bodyStr.substring(i, i + CHUNK_SIZE))
        }

        responseChunks.set(id, chunks)

        // Remove the large body from the initial response sent to content
        const meta = { ...serialized, body: { ...serialized.body, value: null } }
        return { type: 'multi-part' as const, id, chunkCount: chunks.length, meta }
      }

      return serialized
    } catch (err: any) {
      console.error(`[background] Fetch error for ${url}:`, err)
      throw err
    }
  })

  async function setIcon(url?: string) {
    if (!url) {
      await browser.action.setIcon({ path: '/icon/disabled.png' })
      return
    }
    const rule = await findRule(new URL(url).origin)
    await browser.action.setIcon({
      path: rule ? '/icon/enabled.png' : '/icon/disabled.png',
    })
  }
  browser.tabs.onActivated.addListener(async (tabInfo) => {
    const tab = await browser.tabs.get(tabInfo.tabId)
    setIcon(tab.url)
  })
  browser.tabs.onCreated.addListener(async (tab) => {
    setIcon(tab.url)
  })
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      setIcon(tab.url)
    }
  })
})
