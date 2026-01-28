import { describe, expect, it } from 'vitest'
import {
  arrayBufferToBinaryString,
  deserializeRequest,
  binaryStringToArrayBuffer,
  serializeRequest,
  serializeResponse,
  deserializeResponse,
} from '../serialize'

describe('request', () => {
  it('url request', async () => {
    const request = new Request('https://example.com')
    const serialized = await serializeRequest(request)
    expect(serialized.url).toBe('https://example.com/')
    const deserialized = await deserializeRequest(serialized)
    expect(deserialized.url).eq('https://example.com/')
  })
  it('text request', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      body: 'Hello, world!',
    })
    const serialized = await serializeRequest(request)
    const deserialized = await deserializeRequest(serialized)
    expect(await deserialized.text()).eq('Hello, world!')
  })
  it('json request', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'John' }),
    })
    const serialized = await serializeRequest(request)
    const deserialized = await deserializeRequest(serialized)
    expect(deserialized.url).eq('https://example.com/')
    expect(deserialized.headers.get('content-type')).eq('application/json')
    expect(await deserialized.json()).toEqual({ name: 'John' })
  })
  it('form data request', async () => {
    const fd = new FormData()
    fd.append('name', 'John')
    fd.append('age', '20')
    const request = new Request('https://example.com', {
      method: 'POST',
      body: fd,
    })
    const serialized = await serializeRequest(request)
    const deserialized = await deserializeRequest(serialized)
    expect(deserialized.headers.get('content-type')).include(
      'multipart/form-data',
    )
    const fd2 = await deserialized.formData()
    expect(Object.fromEntries(fd2)).toEqual({
      name: 'John',
      age: '20',
    })
  })
  it('array buffer request', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      body: binaryStringToArrayBuffer(JSON.stringify({ name: 'John' })),
    })
    const serialized = await serializeRequest(request.clone())
    const deserialized = await deserializeRequest(serialized)
    expect(arrayBufferToBinaryString(await deserialized.arrayBuffer())).toEqual(
      arrayBufferToBinaryString(await request.arrayBuffer()),
    )
  })
  it('stream request', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          const a = 'Hello, world!'.split('')
          for (const char of a) {
            controller.enqueue(char)
          }
          controller.close()
        },
      }).pipeThrough(new TextEncoderStream()),
      // @ts-expect-error
      duplex: 'half',
    })
    const serialized = await serializeRequest(request)
    const deserialized = await deserializeRequest(serialized)
    expect(arrayBufferToBinaryString(await deserialized.arrayBuffer())).toEqual(
      'Hello, world!',
    )
  })
})

describe('response', () => {
  it('text response', async () => {
    const response = new Response('Hello, world!', {
      headers: {
        'Content-Type': 'text/plain',
      },
    })
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    expect(await deserialized.text()).eq('Hello, world!')
  })
  it('json response', async () => {
    const response = new Response(JSON.stringify({ name: 'John' }), {
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    expect(await deserialized.json()).toEqual({ name: 'John' })
  })
  it('blob response', async () => {
    const response = new Response(new Blob(['Hello, world!']), {
      headers: {
        'Content-Type': 'text/plain',
      },
    })
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    expect(await (await deserialized.blob()).text()).toEqual('Hello, world!')
  })
  it('array buffer response', async () => {
    const response = new Response(
      binaryStringToArrayBuffer(JSON.stringify({ name: 'John' })),
      {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      },
    )
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    expect(arrayBufferToBinaryString(await deserialized.arrayBuffer()))
      .eq(arrayBufferToBinaryString(await response.arrayBuffer()))
      .eq(JSON.stringify({ name: 'John' }))
  })
  it('stream response', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          const a = 'Hello, world!'.split('')
          for (const char of a) {
            controller.enqueue(char)
          }
          controller.close()
        },
      }).pipeThrough(new TextEncoderStream()),
    )
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    const reader = deserialized
      .clone()
      .body!.pipeThrough(new TextDecoderStream())
      .getReader()

    let r = ''
    let chunk = await reader.read()
    while (!chunk?.done) {
      r += chunk.value
      chunk = await reader.read()
    }
    expect(r).eq('Hello, world!')
    expect(await deserialized.clone().text()).eq('Hello, world!')
  })
  it('error response', async () => {
    const response = new Response('Hello, world!', {
      status: 500,
    })
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    expect(deserialized.status).eq(500)
  })
  it('redirect response', async () => {
    const response = new Response('Hello, world!', {
      status: 302,
      headers: {
        Location: 'https://example.com',
      },
    })
    const serialized = await serializeResponse(response)
    const deserialized = await deserializeResponse(serialized)
    expect(deserialized.status).eq(302)
    expect(deserialized.headers.get('location')).eq('https://example.com')
  })
})
