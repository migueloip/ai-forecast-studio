import multer from 'multer'
import type { Response } from 'express'
import { ConfigurationError } from '../db.js'

export const ErrorCatalog = {
  VALIDATION_ERROR: { status: 400, message: 'Review the information provided and try again.' },
  AUTH_REQUIRED: { status: 401, message: 'Your session has expired. Sign in again to continue.' },
  AUTH_INVALID: { status: 401, message: 'The email or password is incorrect.' },
  TURNSTILE_FAILED: { status: 400, message: 'Complete the security verification and try again.' },
  TURNSTILE_UNAVAILABLE: { status: 503, message: 'Security verification is temporarily unavailable. Please try again shortly.' },
  FORBIDDEN: { status: 403, message: 'This request is not allowed from the current origin.' },
  ACCOUNT_EXISTS: { status: 409, message: 'An account with this email already exists.' },
  NOT_FOUND: { status: 404, message: 'The requested resource could not be found.' },
  ROUTE_NOT_FOUND: { status: 404, message: 'This API operation is not available.' },
  UPLOAD_REQUIRED: { status: 400, message: 'Choose a CSV, Excel, or JSON file to continue.' },
  UPLOAD_TOO_LARGE: { status: 413, message: 'The uploaded file or dataset exceeds the allowed size.' },
  DATASET_INVALID: { status: 400, message: 'We could not read this dataset. Check its format and contents.' },
  ANALYSIS_REQUIRED: { status: 409, message: 'Complete an AI analysis before using this feature.' },
  ANALYSIS_IN_PROGRESS: { status: 409, message: 'This analysis is already running.' },
  MEETING_IN_PROGRESS: { status: 409, message: 'This conversation already has a response in progress.' },
  ANALYSIS_INTERRUPTED: { status: 503, message: 'The analysis was interrupted before it finished. Resume it from the last completed step.' },
  CONFIGURATION_REQUIRED: { status: 503, message: 'This service is not configured yet. Contact the workspace administrator.' },
  AI_TIMEOUT: { status: 504, message: 'The AI Team took too long to respond. Please try again.' },
  AI_INVALID_RESPONSE: { status: 502, message: 'The AI provider returned an invalid response. Resume to try this stage again.' },
  AI_UNAVAILABLE: { status: 503, message: 'The AI Team is temporarily unavailable. Please try again shortly.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Wait a moment before trying again.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'A required service is temporarily unavailable. Please try again.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong while processing your request.' },
} as const

export type ErrorCode = keyof typeof ErrorCatalog

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly publicMessage: string

  constructor(code: ErrorCode, options?: { message?: string; cause?: unknown }) {
    const definition = ErrorCatalog[code]
    super(options?.message ?? definition.message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = definition.status
    this.publicMessage = options?.message ?? definition.message
  }
}

export function appError(code: ErrorCode, options?: { message?: string; cause?: unknown }) {
  return new AppError(code, options)
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : ''
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof ConfigurationError) return appError('CONFIGURATION_REQUIRED', { cause: error })
  if (error instanceof multer.MulterError) {
    return appError(error.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_TOO_LARGE' : 'DATASET_INVALID', { cause: error })
  }
  if (error instanceof SyntaxError && typeof error === 'object' && error !== null && 'body' in error) {
    return appError('VALIDATION_ERROR', { message: 'The request body is not valid JSON.', cause: error })
  }

  const message = messageOf(error)
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : ''

  if (/already exists|duplicate|unique/i.test(message)) return appError('ACCOUNT_EXISTS', { cause: error })
  if (/authentication required|session/i.test(message)) return appError('AUTH_REQUIRED', { cause: error })
  if (/not found/i.test(message)) return appError('NOT_FOUND', { cause: error })
  if (/complete an analysis/i.test(message)) return appError('ANALYSIS_REQUIRED', { cause: error })
  if (/unsupported format|must contain|every json row|does not contain any records|parse|invalid csv|workbook/i.test(message)) return appError('DATASET_INVALID', { cause: error })
  if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(`${message} ${code}`)) return appError('AI_TIMEOUT', { cause: error })
  if (status === 429) return appError('RATE_LIMITED', { cause: error })
  if (status !== null && status >= 500 && /openai|model|completion|inference|nvidia/i.test(message)) return appError('AI_UNAVAILABLE', { cause: error })
  if (/model response did not|model returned an empty|invalid structured output|schema validation/i.test(message)) return appError('AI_INVALID_RESPONSE', { cause: error })
  if (/model returned|structured output|completion|openai|inference/i.test(message)) return appError('AI_UNAVAILABLE', { cause: error })
  if (/database|postgres|neon|ECONNREFUSED|connection/i.test(`${message} ${code}`)) return appError('SERVICE_UNAVAILABLE', { cause: error })
  return appError('INTERNAL_ERROR', { cause: error })
}

export function sendErrorResponse(response: Response, error: AppError, requestId?: string) {
  response.status(error.status).json({
    error: {
      code: error.code,
      message: error.publicMessage,
      requestId: requestId ?? null,
    },
  })
}
