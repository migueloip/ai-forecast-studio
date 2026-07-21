import type { ColumnProfile, DatasetProfile, DatasetRecord } from './ingestion.js'

export interface MetricSnapshot {
  column: string | null
  current: number | null
  previous: number | null
  total: number | null
  changePercent: number | null
}

export type ForecastMetricKey = 'revenue' | 'demand' | 'cost' | 'inventory' | 'profit' | 'kpi'
export type ForecastModel = string

export interface ForecastPoint {
  period: string
  value: number
  lower: number
  upper: number
}

export interface MetricForecast {
  metric: ForecastMetricKey
  column: string
  model: ForecastModel
  horizon: number
  trainingPeriods: number
  validationPeriods: number
  confidenceLevel: 95
  confidence: number
  accuracy: {
    mae: number
    rmse: number
    mape: number | null
  }
  changePercent: number | null
  points: ForecastPoint[]
}

export interface HealthComponent {
  score: number | null
  weight: number
  explanation: string
}

interface SeriesPoint {
  period: string
  revenue: number | null
  demand: number | null
  cost: number | null
  inventory: number | null
  profit: number | null
  kpi: number | null
}

export interface ForecastModelEvaluation {
  key: string
  name: string
  family: 'statistical' | 'machine_learning' | 'deep_learning'
  status: 'evaluated' | 'rejected' | 'unavailable' | 'failed'
  reason: string
  advantages: string
  disadvantages: string
  requiredCharacteristics: string
  trainingTimeMs: number | null
  selectionScore: number | null
  stability: number | null
  confidence: number | null
  metrics: { mae: number; mse: number; rmse: number; mape: number | null; smape: number | null; mase: number | null; r2: number | null; normalizedRmse: number; accuracyPercentage: number } | null
  forecast: number[] | null
}

export interface MetricForecastIntelligence {
  metric: ForecastMetricKey
  column: string
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  validation: { method: string; folds: number; horizon: number; origins: number[]; randomSplit: false }
  diagnostics: {
    trend: { detected: boolean; direction: 'growth' | 'decline' | 'stable'; strength: number; slopePerPeriod: number }
    seasonality: { detected: boolean; period: number | null; strength: number; profile: Array<{ position: number; effect: number }> }
    regularity: number
    volatility: { coefficient: number; level: 'low' | 'medium' | 'high' }
    anomalies: Array<{ period: string; value: number; zScore: number }>
    correlations: Array<{ feature: string; coefficient: number }>
    holidayEffects: Array<{ month: number; effect: number; direction: 'spike' | 'dip'; reason: string }>
    marketingImpact: Array<{ feature: string; coefficient: number }>
    growthPattern: { compoundRatePerPeriod: number | null; direction: 'growth' | 'decline' | 'stable' }
    cyclicBehavior: boolean
  }
  models: ForecastModelEvaluation[]
  strategy: {
    type: 'single' | 'ensemble'
    selectedModels: string[]
    selectedName: string
    weights: Array<{ model: string; weight: number }>
    reason: string
    confidence: number
    confidenceMethodology: { score: number; components: Record<string, number>; weights: Record<string, number>; methodology: string }
    accuracyPercentage: number
    intervalMethod: string
    confidenceLevel: 95
  }
}

export interface DatasetAnalytics {
  version: 5
  generatedAt: string
  source: {
    rowCount: number
    completeness: number
    dateRange: DatasetProfile['dateRange']
    periods: number
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular'
  }
  metrics: {
    revenue: MetricSnapshot
    demand: MetricSnapshot
    cost: MetricSnapshot
    inventory: MetricSnapshot
    profit: MetricSnapshot
    kpi: MetricSnapshot
    grossProfit: number | null
    grossMarginPercent: number | null
  }
  series: SeriesPoint[]
  forecasts: {
    horizon: number
    primaryMetric: ForecastMetricKey | null
    metrics: Record<ForecastMetricKey, MetricForecast | null>
  }
  intelligence: {
    status: 'ready' | 'fallback'
    engine: string
    engineVersion: string
    generatedAt: string
    datasetProfile: { type: string; problem: string; frequency: string; forecastableMetrics: ForecastMetricKey[] } | null
    forecasts: Record<ForecastMetricKey, MetricForecastIntelligence | null>
    message: string | null
  }
  health: {
    overall: number
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    components: {
      revenue: HealthComponent
      forecastReliability: HealthComponent
      demandStability: HealthComponent
      inventory: HealthComponent
      growthPotential: HealthComponent
      dataQuality: HealthComponent
    }
  }
  segments: Array<{ label: string; value: number; sharePercent: number }>
  segmentColumn: string | null
  primaryMetricColumn: string | null
}

interface PeriodBucket {
  revenue: number
  demand: number
  cost: number
  inventory: number
  kpi: number
  inventoryDate: string
  hasRevenue: boolean
  hasDemand: boolean
  hasCost: boolean
  hasInventory: boolean
  hasKpi: boolean
}

function numericValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/[$€£¥,%\s]/g, '').replace(/,/g, '')
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function dateValue(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function columnFor(columns: ColumnProfile[], role: ColumnProfile['role']) {
  return columns.find((column) => column.role === role)?.name ?? null
}

function changePercent(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null
  return Math.round((((current - previous) / Math.abs(previous)) * 100) * 10) / 10
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

interface Observation {
  period: string
  value: number
}

function periodIndex(period: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const timestamp = Date.parse(`${period}T00:00:00Z`)
    return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 86_400_000)
  }
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return year * 12 + month - 1
}

type SeriesFrequency = DatasetAnalytics['source']['frequency']

function seasonPosition(period: string, frequency: SeriesFrequency) {
  const parsed = new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return 0
  if (frequency === 'daily') return parsed.getUTCDay()
  if (frequency === 'weekly') return Math.floor((parsed.getTime() - Date.UTC(parsed.getUTCFullYear(), 0, 1)) / (7 * 86_400_000)) % 52
  if (frequency === 'quarterly') return Math.floor(parsed.getUTCMonth() / 3)
  return parsed.getUTCMonth()
}

function futurePeriod(period: string, steps: number, frequency: SeriesFrequency) {
  const parsed = new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`)
  if (frequency === 'daily') parsed.setUTCDate(parsed.getUTCDate() + steps)
  else if (frequency === 'weekly') parsed.setUTCDate(parsed.getUTCDate() + (steps * 7))
  else if (frequency === 'quarterly') parsed.setUTCMonth(parsed.getUTCMonth() + (steps * 3))
  else parsed.setUTCMonth(parsed.getUTCMonth() + steps)
  return frequency === 'monthly' || frequency === 'quarterly' || frequency === 'irregular' ? parsed.toISOString().slice(0, 7) : parsed.toISOString().slice(0, 10)
}

function detectFrequency(records: DatasetRecord[], dateColumn: string | null): SeriesFrequency {
  if (!dateColumn) return 'irregular'
  const timestamps = [...new Set(records.map((record) => dateValue(record[dateColumn])).filter((value): value is string => Boolean(value)).map((value) => Date.parse(value)))].sort((a, b) => a - b)
  const gaps = timestamps.slice(1).map((value, index) => (value - timestamps[index]!) / 86_400_000).filter((value) => value > 0)
  if (!gaps.length) return 'irregular'
  const ordered = [...gaps].sort((a, b) => a - b)
  const median = ordered[Math.floor(ordered.length / 2)]!
  return median <= 2 ? 'daily' : median <= 10 ? 'weekly' : median <= 45 ? 'monthly' : median <= 120 ? 'quarterly' : 'irregular'
}

function periodForDate(isoDate: string, frequency: SeriesFrequency) {
  if (frequency === 'daily') return isoDate.slice(0, 10)
  if (frequency === 'weekly') {
    const parsed = new Date(isoDate)
    const day = parsed.getUTCDay() || 7
    parsed.setUTCDate(parsed.getUTCDate() - day + 1)
    return parsed.toISOString().slice(0, 10)
  }
  if (frequency === 'quarterly') {
    const parsed = new Date(isoDate)
    parsed.setUTCMonth(Math.floor(parsed.getUTCMonth() / 3) * 3, 1)
    return parsed.toISOString().slice(0, 7)
  }
  return isoDate.slice(0, 7)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function rootMeanSquare(values: number[]) {
  return values.length ? Math.sqrt(mean(values.map((value) => value ** 2))) : 0
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function fitLine(observations: Observation[]) {
  const origin = periodIndex(observations[0]?.period ?? '') ?? 0
  const points = observations.map((observation, index) => ({
    x: (periodIndex(observation.period) ?? origin + index) - origin,
    y: observation.value,
  }))
  const xMean = mean(points.map((point) => point.x))
  const yMean = mean(points.map((point) => point.y))
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  const slope = denominator === 0 ? 0 : points.reduce((sum, point) => sum + ((point.x - xMean) * (point.y - yMean)), 0) / denominator
  return { origin, intercept: yMean - slope * xMean, slope }
}

function predictor(observations: Observation[], model: ForecastModel, frequency: SeriesFrequency) {
  if (model === 'naive') {
    const latest = observations.at(-1)?.value ?? 0
    return () => latest
  }
  const line = fitLine(observations)
  const seasonal = new Map<number, number>()
  if (model === 'seasonal_trend') {
    const residuals = new Map<number, number[]>()
    observations.forEach((observation) => {
      const absolute = periodIndex(observation.period)
      if (absolute === null) return
      const expected = line.intercept + line.slope * (absolute - line.origin)
      const position = seasonPosition(observation.period, frequency)
      residuals.set(position, [...(residuals.get(position) ?? []), observation.value - expected])
    })
    for (const [month, values] of residuals) seasonal.set(month, mean(values))
  }
  return (period: string) => {
    const absolute = periodIndex(period)
    if (absolute === null) return observations.at(-1)?.value ?? 0
    return line.intercept + line.slope * (absolute - line.origin) + (seasonal.get(seasonPosition(period, frequency)) ?? 0)
  }
}

function availableModels(observations: Observation[], validationPeriods: number, frequency: SeriesFrequency): ForecastModel[] {
  const minimumTrainingSize = observations.length - validationPeriods
  const models: ForecastModel[] = ['naive']
  if (minimumTrainingSize >= 3) models.push('linear_trend')
  const season = frequency === 'daily' ? 7 : frequency === 'weekly' ? 52 : frequency === 'quarterly' ? 4 : 12
  const positions = new Set(observations.slice(0, minimumTrainingSize).map((observation) => seasonPosition(observation.period, frequency)))
  if (minimumTrainingSize >= season * 2 && positions.size >= Math.min(season, 7)) models.push('seasonal_trend')
  return models
}

function backtest(observations: Observation[], model: ForecastModel, validationPeriods: number, frequency: SeriesFrequency) {
  const errors: number[] = []
  const percentageErrors: number[] = []
  const start = observations.length - validationPeriods
  for (let index = start; index < observations.length; index += 1) {
    const actual = observations[index]!
    const predicted = predictor(observations.slice(0, index), model, frequency)(actual.period)
    const error = predicted - actual.value
    errors.push(error)
    if (Math.abs(actual.value) > 0.000001) percentageErrors.push(Math.abs(error / actual.value) * 100)
  }
  return {
    errors,
    mae: mean(errors.map(Math.abs)),
    rmse: rootMeanSquare(errors),
    mape: percentageErrors.length ? mean(percentageErrors) : null,
  }
}

function buildMetricForecast(metric: ForecastMetricKey, column: string | null, series: SeriesPoint[], completeness: number, frequency: SeriesFrequency, horizon = 6): MetricForecast | null {
  if (!column) return null
  const observations = series
    .filter((point) => periodIndex(point.period) !== null && point[metric] !== null)
    .map((point) => ({ period: point.period, value: point[metric] as number }))
  if (observations.length < 4) return null

  const validationPeriods = Math.min(6, Math.max(1, Math.floor(observations.length * 0.25)))
  const candidates = availableModels(observations, validationPeriods, frequency)
  const evaluated = candidates.map((model) => ({ model, result: backtest(observations, model, validationPeriods, frequency) }))
  const selected = evaluated.reduce((best, candidate) => candidate.result.rmse < best.result.rmse ? candidate : best)
  const predict = predictor(observations, selected.model, frequency)
  const last = observations.at(-1)!
  const nonNegative = observations.every((observation) => observation.value >= 0)
  const fitted = predictor(observations, selected.model, frequency)
  const residualScale = Math.max(
    selected.result.rmse,
    standardDeviation(observations.map((observation) => observation.value - fitted(observation.period))),
    Math.abs(mean(observations.map((observation) => observation.value))) * 0.01,
  )
  const points: ForecastPoint[] = Array.from({ length: horizon }, (_, index) => {
    const period = futurePeriod(last.period, index + 1, frequency)
    const rawValue = predict(period)
    const value = nonNegative ? Math.max(0, rawValue) : rawValue
    const margin = 1.96 * residualScale * Math.sqrt(1 + ((index + 1) * 0.25))
    return {
      period,
      value: round(value),
      lower: round(nonNegative ? Math.max(0, value - margin) : value - margin),
      upper: round(value + margin),
    }
  })
  const relativeError = selected.result.rmse / Math.max(Math.abs(mean(observations.map((observation) => observation.value))), 0.000001)
  const historyPenalty = Math.max(0, 24 - observations.length) * 0.8
  const completenessPenalty = (100 - completeness) * 0.15
  const confidence = Math.round(clamp(100 - (relativeError * 100) - historyPenalty - completenessPenalty, 20, 95))

  return {
    metric,
    column,
    model: selected.model,
    horizon,
    trainingPeriods: observations.length,
    validationPeriods,
    confidenceLevel: 95,
    confidence,
    accuracy: {
      mae: round(selected.result.mae),
      rmse: round(selected.result.rmse),
      mape: selected.result.mape === null ? null : round(selected.result.mape),
    },
    changePercent: changePercent(points.at(-1)?.value ?? null, last.value),
    points,
  }
}

function periodChanges(values: number[]) {
  const changes: number[] = []
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!
    if (previous !== 0) changes.push(((values[index]! - previous) / Math.abs(previous)) * 100)
  }
  return changes
}

function scoreToneValue(value: number) {
  return Math.round(clamp(value, 0, 100))
}

function buildBusinessHealth(series: SeriesPoint[], forecasts: DatasetAnalytics['forecasts']['metrics'], completeness: number): DatasetAnalytics['health'] {
  const revenueValues = series.map((point) => point.revenue).filter((value): value is number => value !== null).slice(-12)
  const demandValues = series.map((point) => point.demand).filter((value): value is number => value !== null).slice(-12)
  const latestInventory = series.map((point) => point.inventory).filter((value): value is number => value !== null).at(-1) ?? null
  const latestDemand = demandValues.at(-1) ?? null

  let revenueScore: number | null = null
  let revenueExplanation = 'Revenue health requires at least two dated revenue periods.'
  if (revenueValues.length >= 2 && revenueValues[0] !== 0) {
    const growth = ((revenueValues.at(-1)! - revenueValues[0]!) / Math.abs(revenueValues[0]!)) * 100
    const volatility = standardDeviation(periodChanges(revenueValues))
    revenueScore = scoreToneValue((scoreToneValue(50 + growth * 1.5) * .6) + (scoreToneValue(100 - volatility * 2) * .4))
    revenueExplanation = `${round(growth)}% change across ${revenueValues.length} periods with ${round(volatility)} percentage points of period-to-period volatility.`
  }

  let demandScore: number | null = null
  let demandExplanation = 'Demand stability requires at least three dated demand periods.'
  if (demandValues.length >= 3) {
    const volatility = standardDeviation(periodChanges(demandValues))
    demandScore = scoreToneValue(100 - volatility * 2.5)
    demandExplanation = `${round(volatility)} percentage points of period-to-period demand volatility across ${demandValues.length} periods; lower volatility scores higher.`
  }

  const primaryForecast = forecasts.revenue ?? forecasts.demand ?? forecasts.profit ?? forecasts.cost ?? forecasts.inventory ?? forecasts.kpi
  const forecastScore = primaryForecast?.confidence ?? null
  const forecastExplanation = primaryForecast
    ? `${primaryForecast.model.replaceAll('_', ' ')} validated on ${primaryForecast.validationPeriods} held-out period${primaryForecast.validationPeriods === 1 ? '' : 's'} with RMSE ${primaryForecast.accuracy.rmse}${primaryForecast.accuracy.mape === null ? '' : ` and MAPE ${primaryForecast.accuracy.mape}%`}.`
    : 'Forecast reliability requires at least four dated periods for a forecastable metric.'

  let inventoryScore: number | null = null
  let inventoryExplanation = 'Inventory health requires both closing inventory and demand in compatible units.'
  if (latestInventory !== null && latestDemand !== null && latestDemand > 0) {
    const coverage = latestInventory / latestDemand
    inventoryScore = scoreToneValue(
      coverage < .5 ? 20 + coverage * 80
        : coverage <= 2 ? 60 + ((coverage - .5) / 1.5) * 40
          : coverage <= 4 ? 100 - ((coverage - 2) / 2) * 30
            : 70 - (coverage - 4) * 15,
    )
    inventoryExplanation = `${round(coverage)} months of demand coverage. The scoring target is between 1 and 2 months; shortages and excess stock reduce the score.`
  }

  const observedRevenueGrowth = revenueValues.length >= 2 && revenueValues[0] !== 0
    ? ((revenueValues.at(-1)! - revenueValues[0]!) / Math.abs(revenueValues[0]!)) * 100
    : null
  const projectedGrowth = forecasts.revenue?.changePercent ?? primaryForecast?.changePercent ?? observedRevenueGrowth
  const growthScore = projectedGrowth === null
    ? null
    : scoreToneValue((scoreToneValue(50 + projectedGrowth * 2) * .65) + ((primaryForecast?.confidence ?? 50) * .35))
  const growthExplanation = projectedGrowth === null
    ? 'Growth potential requires either observed revenue change or a validated forecast.'
    : `${round(projectedGrowth)}% ${forecasts.revenue?.changePercent !== null && forecasts.revenue?.changePercent !== undefined ? 'validated forecast change' : 'observed change'} combined with ${primaryForecast?.confidence ?? 50}% forecast reliability.`

  const components: DatasetAnalytics['health']['components'] = {
    revenue: { score: revenueScore, weight: 20, explanation: revenueExplanation },
    forecastReliability: { score: forecastScore, weight: 25, explanation: forecastExplanation },
    demandStability: { score: demandScore, weight: 10, explanation: demandExplanation },
    inventory: { score: inventoryScore, weight: 15, explanation: inventoryExplanation },
    growthPotential: { score: growthScore, weight: 15, explanation: growthExplanation },
    dataQuality: { score: scoreToneValue(completeness), weight: 15, explanation: `${round(completeness)}% of source cells are populated. Completeness is measured directly during ingestion.` },
  }
  const available = Object.values(components).filter((component): component is HealthComponent & { score: number } => component.score !== null)
  const totalWeight = available.reduce((sum, component) => sum + component.weight, 0)
  const overall = totalWeight ? Math.round(available.reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight) : 0
  const weakest = available.length ? Math.min(...available.map((component) => component.score)) : 0
  const riskLevel = overall < 50 || weakest < 35 ? 'HIGH' : overall < 70 || weakest < 60 ? 'MEDIUM' : 'LOW'
  return { overall, riskLevel, components }
}

export function recalculateBusinessHealth(analytics: DatasetAnalytics) {
  return buildBusinessHealth(analytics.series, analytics.forecasts.metrics, analytics.source.completeness)
}

function snapshot(column: string | null, values: Array<number | null>, total: number | null): MetricSnapshot {
  const populated = values.filter((value): value is number => value !== null)
  const current = populated.at(-1) ?? null
  const previous = populated.at(-2) ?? null
  return { column, current, previous, total: total === null ? null : round(total), changePercent: changePercent(current, previous) }
}

export function buildDatasetAnalytics(records: DatasetRecord[], profile: DatasetProfile): DatasetAnalytics {
  const dateColumn = columnFor(profile.columns, 'date')
  const frequency = detectFrequency(records, dateColumn)
  const revenueColumn = columnFor(profile.columns, 'revenue')
  const demandColumn = columnFor(profile.columns, 'demand')
  const costColumn = columnFor(profile.columns, 'cost')
  const inventoryColumn = columnFor(profile.columns, 'inventory')
  const kpiColumn = profile.columns.find((column) => column.role === 'metric')?.name ?? null
  const profitColumn = revenueColumn && costColumn ? `${revenueColumn} − ${costColumn}` : null
  const primaryMetricColumn = revenueColumn ?? demandColumn ?? costColumn ?? inventoryColumn ?? kpiColumn
  const dimension = profile.columns.find((column) => column.role === 'dimension' && column.uniqueCount > 0 && column.uniqueCount <= 100)?.name ?? null
  const periods = new Map<string, PeriodBucket>()
  const segmentTotals = new Map<string, number>()
  let revenueTotal = 0
  let demandTotal = 0
  let costTotal = 0
  let kpiTotal = 0
  let hasRevenueTotal = false
  let hasDemandTotal = false
  let hasCostTotal = false
  let hasKpiTotal = false

  for (const [index, record] of records.entries()) {
    const date = dateColumn ? dateValue(record[dateColumn]) : null
    const period = date ? periodForDate(date, frequency) : dateColumn ? null : `row-${Math.floor(index / Math.max(1, Math.ceil(records.length / 12))) + 1}`
    const revenue = revenueColumn ? numericValue(record[revenueColumn]) : null
    const demand = demandColumn ? numericValue(record[demandColumn]) : null
    const cost = costColumn ? numericValue(record[costColumn]) : null
    const inventory = inventoryColumn ? numericValue(record[inventoryColumn]) : null
    const kpi = kpiColumn ? numericValue(record[kpiColumn]) : null
    if (revenue !== null) { revenueTotal += revenue; hasRevenueTotal = true }
    if (demand !== null) { demandTotal += demand; hasDemandTotal = true }
    if (cost !== null) { costTotal += cost; hasCostTotal = true }
    if (kpi !== null) { kpiTotal += kpi; hasKpiTotal = true }

    if (dimension && primaryMetricColumn) {
      const labelValue = record[dimension]
      const metric = numericValue(record[primaryMetricColumn])
      if (labelValue !== null && labelValue !== undefined && metric !== null) {
        const label = String(labelValue).trim().slice(0, 80) || 'Unspecified'
        segmentTotals.set(label, (segmentTotals.get(label) ?? 0) + metric)
      }
    }
    if (!period) continue
    const bucket = periods.get(period) ?? { revenue: 0, demand: 0, cost: 0, inventory: 0, kpi: 0, inventoryDate: '', hasRevenue: false, hasDemand: false, hasCost: false, hasInventory: false, hasKpi: false }
    if (revenue !== null) { bucket.revenue += revenue; bucket.hasRevenue = true }
    if (demand !== null) { bucket.demand += demand; bucket.hasDemand = true }
    if (cost !== null) { bucket.cost += cost; bucket.hasCost = true }
    if (kpi !== null) { bucket.kpi += kpi; bucket.hasKpi = true }
    if (inventory !== null) {
      const observation = date ?? String(index).padStart(12, '0')
      if (observation > bucket.inventoryDate) {
        bucket.inventoryDate = observation
        bucket.inventory = inventory
      } else if (observation === bucket.inventoryDate) bucket.inventory += inventory
      bucket.hasInventory = true
    }
    periods.set(period, bucket)
  }

  const historyLimit = frequency === 'daily' ? 2_000 : frequency === 'weekly' ? 1_040 : frequency === 'quarterly' ? 120 : 360
  const series = [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-historyLimit).map(([period, bucket]) => ({
    period,
    revenue: bucket.hasRevenue ? round(bucket.revenue) : null,
    demand: bucket.hasDemand ? round(bucket.demand) : null,
    cost: bucket.hasCost ? round(bucket.cost) : null,
    inventory: bucket.hasInventory ? round(bucket.inventory) : null,
    profit: bucket.hasRevenue && bucket.hasCost ? round(bucket.revenue - bucket.cost) : null,
    kpi: bucket.hasKpi ? round(bucket.kpi) : null,
  }))
  const segmentGrandTotal = [...segmentTotals.values()].reduce((sum, value) => sum + value, 0)
  const segments = [...segmentTotals.entries()].sort(([, a], [, b]) => b - a).slice(0, 6).map(([label, value]) => ({
    label,
    value: round(value),
    sharePercent: segmentGrandTotal ? Math.round((value / segmentGrandTotal) * 1_000) / 10 : 0,
  }))
  const grossProfit = hasRevenueTotal && hasCostTotal ? revenueTotal - costTotal : null
  const forecasts: DatasetAnalytics['forecasts']['metrics'] = {
    revenue: buildMetricForecast('revenue', revenueColumn, series, profile.completeness, frequency),
    demand: buildMetricForecast('demand', demandColumn, series, profile.completeness, frequency),
    cost: buildMetricForecast('cost', costColumn, series, profile.completeness, frequency),
    inventory: buildMetricForecast('inventory', inventoryColumn, series, profile.completeness, frequency),
    profit: buildMetricForecast('profit', profitColumn, series, profile.completeness, frequency),
    kpi: buildMetricForecast('kpi', kpiColumn, series, profile.completeness, frequency),
  }
  const primaryMetric = (['revenue', 'demand', 'profit', 'cost', 'inventory', 'kpi'] as const).find((metric) => forecasts[metric] !== null) ?? null
  const health = buildBusinessHealth(series, forecasts, profile.completeness)

  return {
    version: 5,
    generatedAt: new Date().toISOString(),
    source: { rowCount: records.length, completeness: profile.completeness, dateRange: profile.dateRange, periods: series.length, frequency },
    metrics: {
      revenue: snapshot(revenueColumn, series.map((point) => point.revenue), hasRevenueTotal ? revenueTotal : null),
      demand: snapshot(demandColumn, series.map((point) => point.demand), hasDemandTotal ? demandTotal : null),
      cost: snapshot(costColumn, series.map((point) => point.cost), hasCostTotal ? costTotal : null),
      inventory: snapshot(inventoryColumn, series.map((point) => point.inventory), null),
      profit: snapshot(profitColumn, series.map((point) => point.profit), grossProfit),
      kpi: snapshot(kpiColumn, series.map((point) => point.kpi), hasKpiTotal ? kpiTotal : null),
      grossProfit: grossProfit === null ? null : round(grossProfit),
      grossMarginPercent: grossProfit === null || revenueTotal === 0 ? null : Math.round((grossProfit / revenueTotal) * 1_000) / 10,
    },
    series,
    forecasts: { horizon: 6, primaryMetric, metrics: forecasts },
    intelligence: {
      status: 'fallback',
      engine: 'Forecast Intelligence Engine',
      engineVersion: '2.0',
      generatedAt: new Date().toISOString(),
      datasetProfile: null,
      forecasts: { revenue: null, demand: null, cost: null, inventory: null, profit: null, kpi: null },
      message: 'Scientific model tournament has not run; deterministic temporal validation is active.',
    },
    health,
    segments,
    segmentColumn: dimension,
    primaryMetricColumn,
  }
}
