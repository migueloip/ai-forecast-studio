import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDatasetAnalytics } from './analytics.js'
import { profileDataset, type DatasetRecord } from './ingestion.js'

test('builds real monthly metrics and closing inventory from dataset rows', () => {
  const rows: DatasetRecord[] = [
    { date: '2026-01-01', product: 'A', revenue: 100, units: 2, cost: 60, stock: 12 },
    { date: '2026-01-31', product: 'A', revenue: 200, units: 4, cost: 120, stock: 8 },
    { date: '2026-02-28', product: 'A', revenue: 450, units: 8, cost: 250, stock: 5 },
  ]
  const analytics = buildDatasetAnalytics(rows, profileDataset(rows))
  assert.equal(analytics.metrics.revenue.total, 750)
  assert.equal(analytics.metrics.revenue.current, 450)
  assert.equal(analytics.metrics.revenue.changePercent, 50)
  assert.equal(analytics.metrics.inventory.current, 5)
  assert.equal(analytics.metrics.grossProfit, 320)
  assert.equal(analytics.segments[0]?.label, 'A')
  assert.equal(analytics.version, 5)
  assert.equal(analytics.forecasts.metrics.revenue, null)
  assert.equal(analytics.health.components.dataQuality.score, 100)
  assert.ok(analytics.health.overall >= 0 && analytics.health.overall <= 100)
})

test('forecasts future monthly values with temporal backtesting and confidence intervals', () => {
  const rows: DatasetRecord[] = Array.from({ length: 18 }, (_, index) => ({
    date: new Date(Date.UTC(2024, index, 1)).toISOString().slice(0, 10),
    revenue: 1000 + (index * 125),
    units: 50 + (index * 4),
  }))
  const analytics = buildDatasetAnalytics(rows, profileDataset(rows))
  const forecast = analytics.forecasts.metrics.revenue
  assert.ok(forecast)
  assert.equal(forecast.model, 'linear_trend')
  assert.equal(forecast.points.length, 6)
  assert.equal(forecast.points[0]?.period, '2025-07')
  assert.ok((forecast.points.at(-1)?.value ?? 0) > (analytics.metrics.revenue.current ?? 0))
  assert.ok(forecast.points.every((point) => point.lower <= point.value && point.upper >= point.value))
  assert.ok(forecast.validationPeriods > 0)
  assert.equal(forecast.accuracy.rmse, 0)
  assert.equal(analytics.health.components.forecastReliability.score, forecast.confidence)
})

test('selects a seasonal trend when recurring monthly effects improve validation', () => {
  const seasonal = [0, 500, -200, 800, -300, 400, 0, -100, 700, -400, 200, 1200]
  const rows: DatasetRecord[] = Array.from({ length: 36 }, (_, index) => ({
    date: new Date(Date.UTC(2023, index, 1)).toISOString().slice(0, 10),
    revenue: 5000 + (index * 40) + seasonal[index % 12],
  }))
  const analytics = buildDatasetAnalytics(rows, profileDataset(rows))
  const forecast = analytics.forecasts.metrics.revenue
  assert.ok(forecast)
  assert.equal(forecast.model, 'seasonal_trend')
  assert.equal(forecast.trainingPeriods, 36)
})

test('forecasts an arbitrary business KPI without requiring a known revenue role', () => {
  const rows: DatasetRecord[] = Array.from({ length: 12 }, (_, index) => ({
    date: new Date(Date.UTC(2025, index, 1)).toISOString().slice(0, 10),
    active_customers: 200 + (index * 12),
  }))
  const analytics = buildDatasetAnalytics(rows, profileDataset(rows))
  assert.equal(analytics.metrics.kpi.column, 'active_customers')
  assert.equal(analytics.forecasts.primaryMetric, 'kpi')
  assert.ok(analytics.forecasts.metrics.kpi)
  assert.equal(analytics.intelligence.status, 'fallback')
})

test('preserves daily cadence instead of collapsing every dataset to months', () => {
  const rows: DatasetRecord[] = Array.from({ length: 21 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    revenue: 500 + index * 10,
  }))
  const analytics = buildDatasetAnalytics(rows, profileDataset(rows))
  assert.equal(analytics.source.frequency, 'daily')
  assert.equal(analytics.source.periods, 21)
  assert.equal(analytics.forecasts.metrics.revenue?.points[0]?.period, '2026-01-22')
  assert.equal(analytics.health.components.growthPotential.weight, 15)
})

test('preserves quarterly cadence and advances forecasts by whole quarters', () => {
  const rows: DatasetRecord[] = Array.from({ length: 12 }, (_, index) => ({
    date: new Date(Date.UTC(2023 + Math.floor(index / 4), (index % 4) * 3, 1)).toISOString().slice(0, 10),
    revenue: 2_000 + index * 125,
  }))
  const analytics = buildDatasetAnalytics(rows, profileDataset(rows))
  assert.equal(analytics.source.frequency, 'quarterly')
  assert.equal(analytics.source.periods, 12)
  assert.equal(analytics.forecasts.metrics.revenue?.points[0]?.period, '2026-01')
  assert.equal(analytics.forecasts.metrics.revenue?.points[1]?.period, '2026-04')
})
