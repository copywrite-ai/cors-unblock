import { createSignal, createEffect } from 'solid-js'
import { getAllowedInfo, requestHosts } from 'cors-unblock'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { useMutation } from '@tanstack/solid-query'
import { toast, Toaster } from 'solid-toast'

function App() {
  const [url, setUrl] = createSignal('')
  let inputRef: HTMLInputElement | undefined
  const [hasExtracted, setHasExtracted] = createSignal(false)
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied'>('idle')

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  })

  // Check for 'p' parameter on initial load
  createEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const targetUrl = params.get('p')
    if (targetUrl && isValidUrl(targetUrl)) {
      setUrl(targetUrl)
      if (inputRef) {
        inputRef.value = targetUrl
      }
      extractMutation.mutate(targetUrl)
    }
  })

  // Helper function to validate URL
  const isValidUrl = (urlString: string) => {
    try {
      new URL(urlString)
      return true
    } catch {
      return false
    }
  }

  createEffect(() => {
    if (extractMutation.data) {
      setHasExtracted(true)
    }
  })

  const extractMutation = useMutation(() => ({
    mutationFn: async (targetUrl: string) => {
      if (!targetUrl) {
        throw new Error('URL is required')
      }

      // Installation check removed as per user request

      const allowedInfo = await getAllowedInfo()
      const hostname = new URL(targetUrl).hostname

      if (
        !allowedInfo.enabled ||
        (allowedInfo.type === 'specific' &&
          !allowedInfo.hosts?.includes(hostname))
      ) {
        const result = await requestHosts({
          hosts: [hostname],
        })
        if (result !== 'accept') {
          throw new Error(`Please allow CORS Unblock to access ${hostname}`)
        }
      }

      const response = await fetch(targetUrl)
      const html = await response.text()

      const doc = new DOMParser().parseFromString(html, 'text/html')

      const base = doc.createElement('base')
      base.href = targetUrl
      doc.head.insertBefore(base, doc.head.firstChild)

      const reader = new Readability(doc)
      const article = reader.parse()

      if (!article) {
        throw new Error('Failed to extract content')
      }

      const markdownContent = service.turndown(article.content || '')
      return `# ${article.title || 'Untitled'}\n\n${markdownContent}`
    },
    onError: (error) => {
      toast.error(error.message)
    },
  }))

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    extractMutation.mutate(inputRef?.value ?? '')
  }

  const handleCopy = async () => {
    if (!extractMutation.data) return
    await navigator.clipboard.writeText(extractMutation.data)
    setCopyStatus('copied')
    setTimeout(() => setCopyStatus('idle'), 2000)
  }

  return (
    <div class="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <div
        class={`w-full bg-white dark:bg-gray-800 transition-all duration-300 ${hasExtracted()
          ? 'sticky top-0 z-10 shadow-sm'
          : 'flex-1 flex items-center'
          }`}
      >
        {!hasExtracted() ? (
          <div class="w-full -mt-24 sm:-mt-48">
            <div class="flex flex-col items-center justify-center max-w-4xl mx-auto w-full px-4 py-6">
              <h1 class="text-3xl sm:text-4xl font-bold mb-6 sm:mb-8 text-center text-gray-900 dark:text-white">
                Web Content Extractor
              </h1>
              <form
                onSubmit={handleSubmit}
                class="w-full flex flex-col sm:flex-row gap-3"
              >
                <input
                  type="url"
                  ref={inputRef}
                  value={url()}
                  onInput={(e) => setUrl(e.currentTarget.value)}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                  placeholder="Enter URL to extract content..."
                  class="flex-1 px-4 py-3 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:placeholder-gray-400"
                  required
                />
                <button
                  type="submit"
                  disabled={extractMutation.isPending}
                  class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-base font-medium transition-colors duration-200"
                >
                  {extractMutation.isPending ? 'Extracting...' : 'Extract'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div class="max-w-4xl mx-auto p-4 w-full">
            <h1 class="text-2xl sm:text-3xl font-bold mb-4 text-center text-gray-900 dark:text-white">
              Web Content Extractor
            </h1>
            <form
              onSubmit={handleSubmit}
              class="flex flex-col sm:flex-row gap-3"
            >
              <input
                type="url"
                ref={inputRef}
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                onChange={(e) => setUrl(e.currentTarget.value)}
                placeholder="Enter URL to extract content..."
                class="flex-1 px-4 py-2 border dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:placeholder-gray-400"
                required
              />
              <button
                type="submit"
                disabled={extractMutation.isPending}
                class="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-base font-medium transition-colors duration-200"
              >
                {extractMutation.isPending ? 'Extracting...' : 'Extract'}
              </button>
            </form>
          </div>
        )}
      </div>

      {extractMutation.data && (
        <div class="flex-1 max-w-4xl mx-auto w-full p-4">
          <div class="mt-4 bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow-sm">
            <div class="flex justify-end mb-4">
              <button
                onClick={handleCopy}
                class="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {copyStatus() === 'copied' ? (
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  ) : (
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                    />
                  )}
                </svg>
                {copyStatus() === 'copied' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre class="whitespace-pre-wrap font-mono text-sm text-gray-900 dark:text-gray-100 overflow-x-auto">
              {extractMutation.data}
            </pre>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  )
}

export default App
