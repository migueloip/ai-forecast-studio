import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMeetingWorkspaceContext } from '../src/meetingDeepLink.js'

test('opening a conversation-only URL resolves its persisted dataset context', async () => {
  const calls: string[] = []
  const resolved = await resolveMeetingWorkspaceContext('?conversation=conversation-1', 'unrelated-analysis', async (conversationId) => {
    calls.push(conversationId)
    return { analysisId: 'conversation-analysis' }
  })
  assert.equal(resolved, 'conversation-analysis')
  assert.deepEqual(calls, ['conversation-1'])
})

test('an explicit compatible deep-link context is preserved for comparative meeting history', async () => {
  let resolverCalled = false
  const resolved = await resolveMeetingWorkspaceContext('?conversation=conversation-1&context=comparative-analysis', null, async () => {
    resolverCalled = true
    return { analysisId: 'single-analysis' }
  })
  assert.equal(resolved, 'comparative-analysis')
  assert.equal(resolverCalled, false)
})
