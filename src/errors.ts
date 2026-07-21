export type ClientErrorCode =
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'ACCOUNT_EXISTS'
  | 'NOT_FOUND'
  | 'UPLOAD_REQUIRED'
  | 'UPLOAD_TOO_LARGE'
  | 'DATASET_INVALID'
  | 'ANALYSIS_REQUIRED'
  | 'CONFIGURATION_REQUIRED'
  | 'AI_TIMEOUT'
  | 'AI_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | string

export class SafeClientError extends Error {
  readonly code: ClientErrorCode
  readonly requestId: string | null

  constructor(code: ClientErrorCode, message: string, requestId: string | null = null) {
    super(message)
    this.name = 'SafeClientError'
    this.code = code
    this.requestId = requestId
  }
}

const statusMessages: Record<number, string> = {
  400: 'Review the information provided and try again.',
  401: 'Your session has expired. Sign in again to continue.',
  403: 'You do not have access to this operation.',
  404: 'The requested resource could not be found.',
  409: 'This operation conflicts with the current workspace state.',
  413: 'The uploaded file or dataset exceeds the allowed size.',
  429: 'Too many requests. Wait a moment before trying again.',
  503: 'A required service is temporarily unavailable. Please try again.',
  504: 'The operation took too long. Please try again.',
}

interface ErrorEnvelope {
  error?: {
    code?: unknown
    message?: unknown
    requestId?: unknown
  }
}

export function errorFromResponse(body: unknown, status: number, headerRequestId: string | null) {
  const envelope = body && typeof body === 'object' ? body as ErrorEnvelope : null
  const payload = envelope?.error
  const code = typeof payload?.code === 'string' ? payload.code : `HTTP_${status}`
  const message = typeof payload?.message === 'string' && payload.message.length <= 500
    ? payload.message
    : statusMessages[status] ?? 'Something went wrong while processing your request.'
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : headerRequestId
  return new SafeClientError(code, message, requestId)
}

export function networkError() {
  return new SafeClientError('NETWORK_ERROR', 'We could not connect to the service. Check your connection and try again.')
}

export function safeErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  return error instanceof SafeClientError ? error.message : fallback
}
