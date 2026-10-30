export class ApiFailure extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) { super(message) }
}

export async function graphRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ApiFailure('The API could not be reached.', 0, 'NETWORK_ERROR')
  }
  const raw = await response.text()
  let body: unknown = null
  try { body = raw ? JSON.parse(raw) : null } catch { /* plain-text server error */ }
  if (!response.ok) {
    const envelope = body && typeof body === 'object' && 'error' in body
      ? (body as { error?: { code?: string; message?: string; request_id?: string } }).error : undefined
    throw new ApiFailure(
      envelope?.message || `Request failed (HTTP ${response.status}).`,
      response.status,
      envelope?.code || 'HTTP_ERROR',
      envelope?.request_id || response.headers.get('X-Request-ID') || undefined,
    )
  }
  if (!body || typeof body !== 'object') {
    throw new ApiFailure('The API returned an invalid response.', response.status, 'INVALID_RESPONSE')
  }
  return body as T
}
