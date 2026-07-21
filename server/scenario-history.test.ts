import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginScenarioRecalculation,
  completeScenarioRecalculation,
  editScenarioDraft,
  failScenarioRecalculation,
  initialScenarioPresentationState,
} from '../src/scenarioHistory.js'

type Proposal = { price: number; demand: number }
type Evaluation = { revenueChange: number | null; verdictLabel: string; risk: string; score: { final: number } }

const firstProposal: Proposal = { price: 8, demand: -5 }
const firstEvaluation: Evaluation = { revenueChange: 2.6, verdictLabel: 'CONDITIONALLY RECOMMENDED', risk: 'HIGH', score: { final: 53 } }
const nextProposal: Proposal = { price: 4, demand: -2 }
const nextEvaluation: Evaluation = { revenueChange: 1.9, verdictLabel: 'RECOMMENDED WITH SAFEGUARDS', risk: 'MEDIUM', score: { final: 64 } }

function presentedState() {
  const initial = initialScenarioPresentationState<Proposal, Evaluation>()
  return completeScenarioRecalculation(beginScenarioRecalculation(initial), firstProposal, firstEvaluation, '10:00')
}

test('compares two genuinely different successfully evaluated scenarios', () => {
  const changedDraft = editScenarioDraft(presentedState())
  const next = completeScenarioRecalculation(beginScenarioRecalculation(changedDraft), nextProposal, nextEvaluation, '10:05')
  assert.deepEqual(next.comparison?.previous.proposal, firstProposal)
  assert.deepEqual(next.comparison?.current.proposal, nextProposal)
  assert.equal(next.comparison?.revenueDelta, -0.7)
  assert.equal(next.comparison?.decisionScoreDelta, 11)
  assert.equal(next.comparison?.verdictChanged, true)
  assert.equal(next.comparison?.riskChanged, true)
})

test('editing a scenario preserves the last successful result', () => {
  const before = presentedState()
  const after = editScenarioDraft(before)
  assert.strictEqual(after.current, before.current)
  assert.equal(after.draftDirty, true)
})

test('a failed recalculation preserves the previous successful result and comparison', () => {
  const before = presentedState()
  const failed = failScenarioRecalculation(beginScenarioRecalculation(editScenarioDraft(before)), 'Recalculation failed.')
  assert.strictEqual(failed.current, before.current)
  assert.strictEqual(failed.comparison, before.comparison)
  assert.equal(failed.recalculating, false)
  assert.equal(failed.error, 'Recalculation failed.')
})
