import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { Request } from 'express'
import { config } from './config.js'
import { AppError } from './errors/index.js'
import { requireTurnstile } from './turnstile.js'

const originalFetch = globalThis.fetch
const originalSecret = config.turnstileSecretKey

function requestWith(token: string) {
  return { body: { turnstileToken: token }, ip: '203.0.113.4' } as Request
}

beforeEach(() => {
  config.turnstileSecretKey = 'test-secret'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  config.turnstileSecretKey = originalSecret
})

test('accepts a successful Turnstile token for the expected action', async () => {
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, string>
    assert.deepEqual(payload, { secret: 'test-secret', response: 'valid-token', remoteip: '203.0.113.4' })
    return Response.json({ success: true, action: 'login' })
  }

  await requireTurnstile(requestWith('valid-token'), 'login')
})

test('rejects a token issued for a different form action', async () => {
  globalThis.fetch = async () => Response.json({ success: true, action: 'register' })

  await assert.rejects(
    requireTurnstile(requestWith('valid-token'), 'login'),
    (error: unknown) => error instanceof AppError && error.code === 'TURNSTILE_FAILED',
  )
})

test('fails safely when Siteverify is unavailable', async () => {
  globalThis.fetch = async () => { throw new Error('network unavailable') }

  await assert.rejects(
    requireTurnstile(requestWith('valid-token'), 'register'),
    (error: unknown) => error instanceof AppError && error.code === 'TURNSTILE_UNAVAILABLE',
  )
})
