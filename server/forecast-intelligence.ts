import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DatasetProfile } from './ingestion.js'
import { recalculateBusinessHealth, type DatasetAnalytics, type ForecastMetricKey, type MetricForecastIntelligence } from './analytics.js'

const metricKeys: ForecastMetricKey[] = ['revenue', 'demand', 'cost', 'inventory', 'profit', 'kpi']
const scriptPath = fileURLToPath(new URL('../forecast_engine/engine.py', import.meta.url))
const defaultPythonPath = fileURLToPath(new URL('../.venv/bin/python', import.meta.url))

interface EngineMetric extends MetricForecastIntelligence {
  trainingPeriods: number
  validationPeriods: number
  changePercent: number | null
  points: Array<{ period: string; value: number; lower: number; upper: number }>
  strategy: MetricForecastIntelligence['strategy'] & {
    metrics: { mae: number; mse: number; rmse: number; mape: number | null; r2: number | null; accuracyPercentage: number }
  }
}

interface EngineResponse {
  version: string
  engine: string
  datasetProfile: NonNullable<DatasetAnalytics['intelligence']['datasetProfile']>
  forecasts: Record<ForecastMetricKey, EngineMetric | null>
}

function pythonExecutable() {
  if (process.env.FORECAST_PYTHON_BIN) return process.env.FORECAST_PYTHON_BIN
  return existsSync(defaultPythonPath) ? defaultPythonPath : 'python3'
}

function runEngine(payload: unknown) {
  return new Promise<EngineResponse>((resolve, reject) => {
    const child = spawn(pythonExecutable(), [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    const timeoutMs = Math.max(10_000, Math.min(Number(process.env.FORECAST_ENGINE_TIMEOUT_MS ?? 180_000), 600_000))
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`Forecast engine exceeded its ${timeoutMs}ms execution budget.`))
    }, timeoutMs)

    function finish(error?: Error, result?: EngineResponse) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result!)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 12_000_000) finish(new Error('Forecast engine response exceeded the output limit.'))
    })
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_000) })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) return finish(new Error(stderr.trim() || `Forecast engine exited with code ${code}.`))
      try {
        const result = JSON.parse(stdout) as EngineResponse
        if (!result || result.engine !== 'Forecast Intelligence Engine' || !result.forecasts) throw new Error('Forecast engine returned an invalid contract.')
        finish(undefined, result)
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Forecast engine returned malformed JSON.'))
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

export async function enrichForecastIntelligence(analytics: DatasetAnalytics, profile: DatasetProfile): Promise<DatasetAnalytics> {
  if (analytics.source.periods < 6 || !analytics.series.some((point) => /^\d{4}-\d{2}$/.test(point.period))) return analytics
  const columns = {
    revenue: analytics.metrics.revenue.column,
    demand: analytics.metrics.demand.column,
    cost: analytics.metrics.cost.column,
    inventory: analytics.metrics.inventory.column,
    profit: analytics.metrics.profit.column,
    kpi: analytics.metrics.kpi.column,
  }
  try {
    const result = await runEngine({
      horizon: analytics.forecasts.horizon,
      primaryMetric: analytics.forecasts.primaryMetric,
      completeness: analytics.source.completeness,
      frequency: analytics.source.frequency === 'irregular' ? undefined : analytics.source.frequency,
      columns,
      series: analytics.series,
      contextSeries: profile.timeSeries,
    })
    const forecasts = { ...analytics.forecasts.metrics }
    const intelligenceForecasts = { ...analytics.intelligence.forecasts }
    for (const metric of metricKeys) {
      const outcome = result.forecasts[metric]
      intelligenceForecasts[metric] = outcome
      if (!outcome) continue
      forecasts[metric] = {
        metric,
        column: outcome.column,
        model: outcome.strategy.selectedName,
        horizon: outcome.points.length,
        trainingPeriods: outcome.trainingPeriods,
        validationPeriods: outcome.validationPeriods,
        confidenceLevel: 95,
        confidence: Math.round(outcome.strategy.confidence),
        accuracy: {
          mae: outcome.strategy.metrics.mae,
          rmse: outcome.strategy.metrics.rmse,
          mape: outcome.strategy.metrics.mape,
        },
        changePercent: outcome.changePercent,
        points: outcome.points,
      }
    }
    const primaryMetric = metricKeys.find((metric) => forecasts[metric] !== null) ?? null
    const enriched: DatasetAnalytics = {
      ...analytics,
      generatedAt: new Date().toISOString(),
      forecasts: { ...analytics.forecasts, primaryMetric, metrics: forecasts },
      intelligence: {
        status: 'ready',
        engine: result.engine,
        engineVersion: result.version,
        generatedAt: new Date().toISOString(),
        datasetProfile: result.datasetProfile,
        forecasts: intelligenceForecasts,
        message: null,
      },
    }
    return { ...enriched, health: recalculateBusinessHealth(enriched) }
  } catch (error) {
    console.error('[forecast-engine] Model tournament unavailable:', error instanceof Error ? error.message : error)
    return {
      ...analytics,
      intelligence: {
        ...analytics.intelligence,
        status: 'fallback',
        generatedAt: new Date().toISOString(),
        message: 'The scientific model tournament is temporarily unavailable. A validated statistical fallback is shown.',
      },
    }
  }
}
