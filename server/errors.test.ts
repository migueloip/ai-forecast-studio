import assert from 'node:assert/strict'
import test from 'node:test'
import { appError, normalizeError, safeRequestFailureLog } from './errors/index.js'

test('preserves explicit public application errors', () => {
  const error = normalizeError(appError('VALIDATION_ERROR'))
  assert.equal(error.code, 'VALIDATION_ERROR')
  assert.equal(error.status, 400)
})

test('never exposes an unexpected internal error message', () => {
  const error = normalizeError(new Error('password=secret database query failed at internal-host'))
  assert.equal(error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(error.publicMessage.includes('secret'), false)
  assert.equal(error.publicMessage.includes('internal-host'), false)
})

test('maps model timeouts to a safe actionable message', () => {
  const error = normalizeError(new Error('Request timed out after 120000ms with provider stack trace'))
  assert.equal(error.code, 'AI_TIMEOUT')
  assert.equal(error.status, 504)
  assert.equal(error.publicMessage, 'The AI Team took too long to respond. Please try again.')
})

test('distinguishes invalid provider output from provider timeouts', () => {
  const error = normalizeError(new Error('The model returned invalid structured output: schema validation failed'))
  assert.equal(error.code, 'AI_INVALID_RESPONSE')
  assert.equal(error.status, 502)
  assert.equal(error.publicMessage.includes('schema'), false)
})

test('server failure logs exclude raw provider errors and credentials', () => {
  const raw = new Error('Authorization: Bearer nvapi-private provider response body')
  const normalized = appError('AI_UNAVAILABLE', { cause: raw })
  const logged = safeRequestFailureLog(normalized, 'request_12345678')
  assert.deepEqual(JSON.parse(logged), {
    event: 'request_failed', requestId: 'request_12345678', code: 'AI_UNAVAILABLE', status: 503,
  })
  assert.equal(logged.includes('nvapi-private'), false)
  assert.equal(logged.includes('Authorization'), false)
  assert.equal(logged.includes('provider response'), false)
})
