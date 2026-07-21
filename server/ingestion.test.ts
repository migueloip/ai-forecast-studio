import assert from 'node:assert/strict'
import test from 'node:test'
import { createSampleDataset, parseDataset, profileDataset } from './ingestion.js'

test('parses CSV records and infers business roles', async () => {
  const csv = Buffer.from('order_date,net_sales,quantity,stock_on_hand\n2026-01-01,120.5,3,18\n2026-01-02,200,4,14\n')
  const rows = await parseDataset('sales.csv', csv)
  const profile = profileDataset(rows)

  assert.equal(rows.length, 2)
  assert.equal(profile.rowCount, 2)
  assert.equal(profile.columns.find((column) => column.name === 'order_date')?.role, 'date')
  assert.equal(profile.columns.find((column) => column.name === 'net_sales')?.role, 'revenue')
  assert.deepEqual(profile.dateRange, {
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T00:00:00.000Z',
  })
})

test('redacts sensitive columns from the OpenAI sample', () => {
  const profile = profileDataset([
    { order_date: '2026-01-01', customer_email: 'person@example.com', revenue: 100 },
  ])
  assert.deepEqual(profile.redactedColumns, ['customer_email'])
  assert.equal('customer_email' in profile.sampleRows[0]!, false)
})

test('creates a useful retail sample dataset', () => {
  const records = createSampleDataset()
  const profile = profileDataset(records)
  assert.ok(records.length > 2_000)
  assert.ok(profile.timeSeries.length >= 24)
  assert.ok(profile.keyMetrics.includes('net_sales'))
})

