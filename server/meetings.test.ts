import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalDatasetIds, isConversationContextVisible, meetingContextKey, meetingConversationUrl } from './meetings.js'

const walmart = '10000000-0000-4000-8000-000000000001'
const bakery = '10000000-0000-4000-8000-000000000002'
const tesla = '10000000-0000-4000-8000-000000000003'

test('creates an order-independent canonical business context', () => {
  assert.deepEqual(canonicalDatasetIds([bakery, walmart, bakery]), [walmart, bakery])
  assert.equal(meetingContextKey([bakery, walmart]), meetingContextKey([walmart, bakery]))
})

test('isolates a single-dataset meeting from every other business', () => {
  assert.equal(isConversationContextVisible([walmart], [walmart]), true)
  assert.equal(isConversationContextVisible([walmart], [bakery]), false)
  assert.equal(isConversationContextVisible([walmart], [walmart, bakery]), false)
})

test('comparative context loads member memories and its exact cross-dataset memory', () => {
  const active = [walmart, bakery]
  assert.equal(isConversationContextVisible(active, [walmart]), true)
  assert.equal(isConversationContextVisible(active, [bakery]), true)
  assert.equal(isConversationContextVisible(active, [bakery, walmart]), true)
  assert.equal(isConversationContextVisible(active, [tesla]), false)
  assert.equal(isConversationContextVisible(active, [walmart, tesla]), false)
})

test('conversation deep links contain the conversation and its exact analysis context', () => {
  const conversationId = '20000000-0000-4000-8000-000000000001'
  const analysisId = '30000000-0000-4000-8000-000000000001'
  assert.equal(meetingConversationUrl(conversationId, analysisId), `/app/meetings?conversation=${conversationId}&context=${analysisId}`)
})
