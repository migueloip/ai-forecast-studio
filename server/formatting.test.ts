import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPercent, frequencyLabel, metricChangeSentence } from '../src/format.js'

test('percentages are rounded and signed consistently', () => {
  assert.equal(formatPercent(56.461705), '+56.5%')
  assert.equal(formatPercent(-4), '−4.0%')
  assert.equal(formatPercent(0), '0.0%')
  assert.equal(formatPercent(null), '—')
})

test('missing scenario metrics produce grammatical copy', () => {
  assert.equal(metricChangeSentence('Revenue', 1.94), 'Revenue is projected to increase by 1.9%.')
  assert.equal(metricChangeSentence('Demand', -2), 'Demand is projected to decrease by 2.0%.')
  assert.equal(metricChangeSentence('Profit', null, 'cost data is missing'), 'Profit impact is unavailable because cost data is missing.')
})

test('frequency labels preserve the actual aggregation', () => {
  assert.equal(frequencyLabel('weekly', 156), '156 weekly periods')
  assert.equal(frequencyLabel('monthly', 1), '1 month')
})
