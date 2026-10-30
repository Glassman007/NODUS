import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiFailure, graphRequest } from '../api/graphClient'

afterEach(() => vi.unstubAllGlobals())

describe('graphRequest', () => {
  it('returns a typed JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    await expect(graphRequest<{ items: unknown[] }>('', 'token', '/search', new AbortController().signal))
      .resolves.toEqual({ items: [] })
  })

  it('keeps a structured API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'Denied', request_id: 'request-1' },
    }), { status: 403 })))
    await expect(graphRequest('', 'token', '/search', new AbortController().signal))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Denied', requestId: 'request-1' })
  })

  it('handles non-JSON failures and malformed successes', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response('not JSON', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(graphRequest('', 'token', '/search', new AbortController().signal))
      .rejects.toMatchObject({ status: 500, code: 'HTTP_ERROR' })
    await expect(graphRequest('', 'token', '/search', new AbortController().signal))
      .rejects.toMatchObject({ status: 200, code: 'INVALID_RESPONSE' })
  })

  it('distinguishes network failure from cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(graphRequest('', 'token', '/search', new AbortController().signal))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' } satisfies Partial<ApiFailure>)
    const controller = new AbortController()
    controller.abort()
    await expect(graphRequest('', 'token', '/search', controller.signal))
      .rejects.toBeInstanceOf(TypeError)
  })
})
