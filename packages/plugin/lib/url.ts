export function transformUrl(u: string, currentOrigin: string): string {
    let newUrl = u.replace('https://cors.isomorphic-git.org', 'https://still-glade-5ccb.mymobilebookmark.workers.dev')
    try {
        const urlObj = new URL(newUrl, currentOrigin)
        // Only add token to cross-origin requests to avoid breaking local ones or extension internals
        if (urlObj.origin !== currentOrigin && !urlObj.protocol.startsWith('chrome')) {
            urlObj.searchParams.set('token', 'godymho')
        }
        return urlObj.toString()
    } catch {
        return newUrl
    }
}
