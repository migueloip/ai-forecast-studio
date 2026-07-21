import assert from 'node:assert/strict'
import test from 'node:test'
import { completedStageCount, isActiveMeetingStatus, meetingCancellationOutcome, meetingDependencyGraph, resumableStages } from './reliability.js'

test('meeting specialists share persisted evidence and Atlas waits for all specialists', () => {
  assert.equal(meetingDependencyGraph.parallelSpecialists.length, 5)
  assert.deepEqual(meetingDependencyGraph.synthesisDependsOn, meetingDependencyGraph.parallelSpecialists)
  assert.equal(meetingDependencyGraph.finalSynthesis, 'team_lead')
})

test('persistent meeting jobs expose recoverable active and terminal states', () => {
  for (const state of ['queued', 'preparing', 'running', 'synthesizing']) assert.equal(isActiveMeetingStatus(state), true)
  for (const state of ['completed', 'failed', 'cancelled', 'timed_out']) assert.equal(isActiveMeetingStatus(state), false)
})

test('analysis retry preserves successful specialists and resumes incomplete stages', () => {
  const runs = [
    { agent_key: 'data_engineer', status: 'completed' },
    { agent_key: 'data_scientist', status: 'completed' },
    { agent_key: 'forecast_specialist', status: 'failed' },
    { agent_key: 'risk_analyst', status: 'queued' },
    { agent_key: 'team_lead', status: 'queued' },
  ]
  assert.equal(completedStageCount(runs), 2)
  assert.deepEqual(resumableStages(runs), ['forecast_specialist', 'risk_analyst', 'team_lead'])
})

test('cancelling an active meeting terminates queued work and preserves completed specialists', () => {
  assert.deepEqual(meetingCancellationOutcome('queued', []), { status: 'cancelled', stage: 'cancelled', completedAgents: [] })
  assert.deepEqual(meetingCancellationOutcome('running', ['data_engineer', 'risk_analyst']), {
    status: 'running', stage: 'cancellation_requested', completedAgents: ['data_engineer', 'risk_analyst'],
  })
})
