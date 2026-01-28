addEventListener('fetch', e => e.respondWith(handle(e.request)))

const ok = (req, u) => {
    const q = u.searchParams
    return req.method === 'OPTIONS' ||
        (req.method === 'GET' && u.pathname.endsWith('/info/refs') &&
            ['git-upload-pack', 'git-receive-pack'].includes(q.get('service'))) ||
        (req.method === 'POST' && u.pathname.endsWith('git-upload-pack') &&
            req.headers.get('content-type') === 'application/x-git-upload-pack-request') ||
        (req.method === 'POST' && u.pathname.endsWith('git-receive-pack') &&
            req.headers.get('content-type') === 'application/x-git-receive-pack-request')
}

async function handle(req) {
    const src = new URL(req.url)
    if (!ok(req, src)) return new Response('Forbidden', { status: 403 })

    const target = 'https://' + src.pathname.slice(1) + src.search   // drop leading “/”

    if (req.method === 'OPTIONS')
        return new Response(null, { status: 200, headers: cors(req) })

    const resp = await fetch(target, {
        method: req.method,
        headers: strip(req.headers),
        body: req.body,
        redirect: 'follow'
    })
    return new Response(resp.body, {
        status: resp.status,
        headers: merge(resp.headers, cors(req))
    })
}

const cors = req => {
    const hdr = req.headers
    return {
        'Access-Control-Allow-Origin': hdr.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': hdr.get('Access-Control-Request-Headers') || '*',
        'Vary': 'Origin'
    }
}

const strip = h => {
    const out = new Headers(h)
        ;['host', 'origin', 'referer', 'content-length'].forEach(k => out.delete(k))
    return out
}
const merge = (h, x) => { const o = new Headers(h); for (const [k, v] of Object.entries(x)) o.set(k, v); return o }