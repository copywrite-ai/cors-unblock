export type SerializedRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

export function arrayBufferToBinaryString(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const CHUNK_SIZE = 0x8000 // 32KB chunks
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK_SIZE) as any,
    )
  }
  return binary
}

export function binaryStringToArrayBuffer(binary: string): ArrayBuffer {
  const buf = new ArrayBuffer(binary.length)
  const bufView = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) {
    bufView[i] = binary.charCodeAt(i)
  }
  return buf
}

function readableStream() {
  return {
    serialize: async (stream: ReadableStream) => {
      const reader = stream.getReader()
      let chunk = await reader.read()
      let result = []
      while (!chunk.done) {
        result.push(chunk.value)
        chunk = await reader.read()
      }
      return {
        type: 'readable-stream',
        value: result,
      }
    },
    deserialize: async (value: any) => {
      return new ReadableStream({
        start: (controller) => {
          for (const chunk of value) {
            controller.enqueue(chunk)
          }
          controller.close()
        },
      })
    },
  }
}

function arrayBuffer() {
  return {
    serialize: async (req: Request | Response) => {
      try {
        return {
          type: 'array-buffer',
          value: new Uint8Array(await req.clone().arrayBuffer()),
        }
      } catch {
        return req.body
      }
    },
    deserialize: async (value: any) => {
      if (value instanceof Uint8Array) return value.buffer;
      if (typeof value === 'string') return binaryStringToArrayBuffer(value);
      return value;
    },
  }
}

async function serializeBody(req: Request | Response) {
  if (req.body === null) {
    return null
  }
  const contentType = req.headers.get('Content-Type')
  if (contentType?.includes('application/json')) {
    return {
      type: 'json',
      value: await req.json(),
    }
  }
  if (contentType?.includes('text/plain')) {
    return {
      type: 'text',
      value: await req.text(),
    }
  }
  if (contentType?.includes('multipart/form-data')) {
    return {
      type: 'form-data',
      value: Object.fromEntries(await req.formData()),
    }
  }
  const b = await arrayBuffer().serialize(req);
  if (b !== null && typeof b === 'object' && 'type' in b && b.type === 'array-buffer') {
    return {
      type: 'array-buffer',
      value: arrayBufferToBinaryString((b as any).value as Uint8Array)
    };
  }
  if (req.body instanceof ReadableStream) {
    return await readableStream().serialize(req.body)
  }
  console.error('Serialize unsupported body type', req.body)
  throw new Error('Serialize unsupported body type')
}

export async function serializeRequest(
  req: Request,
): Promise<SerializedRequest> {
  return {
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body: await serializeBody(req),
  }
}

export function deserializeBody(body: any) {
  if (body === null || body === undefined) {
    return null
  }
  if (body.type === 'json') {
    return JSON.stringify(body.value)
  }
  if (body.type === 'text') {
    return body.value
  }
  if (body.type === 'form-data') {
    const fd = new FormData()
    for (const [key, value] of Object.entries(body.value)) {
      fd.append(key, value as string)
    }
    return fd
  }
  if (body.type === 'readable-stream') {
    return readableStream().deserialize(body.value)
  }
  if (body.type === 'array-buffer') {
    const value = body.value;
    if (value instanceof Uint8Array) return value.buffer;
    if (typeof value === 'string') return binaryStringToArrayBuffer(value);
    // Handle serialized object {0:..., 1:..., length:...}
    if (value && typeof value === 'object' && ('0' in value || 'length' in value)) {
      const length = value.length || Object.keys(value).length;
      const arr = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        arr[i] = value[i];
      }
      return arr.buffer;
    }
    return value;
  }
  console.error('Deserialize unsupported body type', body)
  throw new Error('Deserialize unsupported body type')
}

export async function deserializeRequest(
  req: SerializedRequest,
): Promise<Request> {
  const { url, method, headers, body } = req
  const h = new Headers(headers)
  if (h.get('content-type')?.includes('multipart/form-data')) {
    h.delete('content-type')
  }
  return new Request(url, {
    method,
    headers: h,
    body: await deserializeBody(body),
  })
}

export type SerializedResponse = {
  url: string
  status: number
  statusText: string
  headers: Record<string, string>
  body: any
}

export async function serializeResponse(
  res: Response,
): Promise<SerializedResponse> {
  return {
    url: res.url,
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    body: await serializeBody(res),
  }
}

export async function deserializeResponse(
  str: SerializedResponse,
): Promise<Response> {
  const { status, statusText, headers, body } = str
  return new Response(await deserializeBody(body), {
    status,
    statusText,
    headers: new Headers(headers),
  })
}
