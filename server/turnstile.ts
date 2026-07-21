import type { Request } from 'express'
import { config } from './config.js'
import { AppError, appError } from './errors/index.js'

const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

interface SiteverifyResponse {
  success?: boolean
  action?: string
}

export async function requireTurnstile(request: Request, expectedAction: 'login' | 'register') {
  if (!config.turnstileSecretKey) throw appError('CONFIGURATION_REQUIRED')

  const token = typeof request.body?.turnstileToken === 'string' ? request.body.turnstileToken.trim() : ''
  if (!token || token.length > 2_048) throw appError('TURNSTILE_FAILED')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.turnstileTimeoutMs)

  try {
    const verification = await fetch(siteverifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: config.turnstileSecretKey,
        response: token,
        remoteip: request.ip,
      }),
      signal: controller.signal,
    })

    if (!verification.ok) throw appError('TURNSTILE_UNAVAILABLE')

    const result = await verification.json() as SiteverifyResponse
    if (!result.success || result.action !== expectedAction) throw appError('TURNSTILE_FAILED')
  } catch (error) {
    if (error instanceof AppError) throw error
    throw appError('TURNSTILE_UNAVAILABLE', { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}
