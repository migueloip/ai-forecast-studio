import type { DatasetAnalytics, ForecastMetricKey } from '../api'

function path(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

function areaPath(upper: Array<{ x: number; y: number }>, lower: Array<{ x: number; y: number }>) {
  if (!upper.length) return ''
  return `${path(upper)} ${path([...lower].reverse()).replace(/^M/, 'L')} Z`
}

function periodLabel(period: string, frequency?: DatasetAnalytics['source']['frequency']) {
  if (!/^\d{4}-\d{2}$/.test(period)) return period.replace('row-', 'P')
  const [year, month] = period.split('-').map(Number)
  if (frequency === 'quarterly') return `Q${Math.floor((month! - 1) / 3) + 1} '${String(year).slice(-2)}`
  return new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' }).format(new Date(Date.UTC(year!, month! - 1, 1)))
}

function valueLabel(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function seasonalPosition(period: string, frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly') {
  const parsed = new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`)
  if (frequency === 'daily') return parsed.getUTCDay() || 7
  if (frequency === 'weekly') return (Math.floor((parsed.getTime() - Date.UTC(parsed.getUTCFullYear(), 0, 1)) / (7 * 86_400_000)) % 52) + 1
  if (frequency === 'quarterly') return Math.floor(parsed.getUTCMonth() / 3) + 1
  return parsed.getUTCMonth() + 1
}

export function ForecastChart({ analytics, metric, horizon, showInterval = true, showAlternatives = false, showSeasonality = false, showHolidayEffects = false, large = false }: { analytics: DatasetAnalytics; metric?: ForecastMetricKey; horizon?: number; showInterval?: boolean; showAlternatives?: boolean; showSeasonality?: boolean; showHolidayEffects?: boolean; large?: boolean }) {
  const selectedMetric = metric ?? analytics.forecasts.primaryMetric
  const forecast = selectedMetric ? analytics.forecasts.metrics[selectedMetric] : null
  const source = selectedMetric
    ? analytics.series.map((point) => ({ period: point.period, value: point[selectedMetric] })).filter((point): point is { period: string; value: number } => point.value !== null).slice(large ? -18 : -10)
    : []
  if (!forecast || source.length < 2) return <div className="real-chart-empty">At least four dated periods are required to calculate and validate a forecast.</div>
  const forecastPoints = forecast.points.slice(0, Math.max(1, Math.min(horizon ?? forecast.horizon, forecast.points.length)))
  const intelligence = selectedMetric ? analytics.intelligence.forecasts[selectedMetric] : null
  const alternativeModels = showAlternatives && intelligence
    ? intelligence.models.filter((model) => model.status === 'evaluated' && model.forecast && !intelligence.strategy.selectedModels.includes(model.key)).sort((left, right) => (left.selectionScore ?? Infinity) - (right.selectionScore ?? Infinity)).slice(0, 2)
    : []
  const sourceMean = source.reduce((sum, point) => sum + point.value, 0) / source.length
  const seasonalValues = showSeasonality && intelligence?.diagnostics.seasonality.detected
    ? source.map((point) => sourceMean + (intelligence.diagnostics.seasonality.profile.find((item) => item.position === seasonalPosition(point.period, intelligence.frequency))?.effect ?? 0))
    : []

  const plot = { left: 48, right: 744, top: 34, bottom: 222 }
  const totalPoints = source.length + forecastPoints.length
  const allValues = [...source.map((point) => point.value), ...forecastPoints.flatMap((point) => showInterval ? [point.lower, point.upper] : [point.value]), ...alternativeModels.flatMap((model) => model.forecast?.slice(0, forecastPoints.length) ?? []), ...seasonalValues]
  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  const padding = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.08
  const min = rawMin - padding
  const max = rawMax + padding
  const range = max - min
  const coordinate = (value: number, index: number) => ({
    x: plot.left + (index / (totalPoints - 1)) * (plot.right - plot.left),
    y: plot.bottom - ((value - min) / range) * (plot.bottom - plot.top),
  })
  const actualPoints = source.map((point, index) => coordinate(point.value, index))
  const latest = source.at(-1)!
  const futurePoints = [coordinate(latest.value, source.length - 1), ...forecastPoints.map((point, index) => coordinate(point.value, source.length + index))]
  const upper = [coordinate(latest.value, source.length - 1), ...forecastPoints.map((point, index) => coordinate(point.upper, source.length + index))]
  const lower = [coordinate(latest.value, source.length - 1), ...forecastPoints.map((point, index) => coordinate(point.lower, source.length + index))]
  const alternativePaths = alternativeModels.map((model) => ({ model, points: [coordinate(latest.value, source.length - 1), ...(model.forecast ?? []).slice(0, forecastPoints.length).map((value, index) => coordinate(value, source.length + index))] }))
  const seasonalPath = seasonalValues.map((value, index) => coordinate(value, index))
  const latestX = actualPoints.at(-1)!.x
  const gradientId = `forecast-area-${selectedMetric}-${large ? 'large' : 'small'}`
  const labelPoints = [
    { x: actualPoints[0]!.x, period: source[0]!.period, anchor: 'start' as const },
    { x: latestX, period: latest.period, anchor: 'end' as const },
    { x: futurePoints.at(-1)!.x, period: forecastPoints.at(-1)!.period, anchor: 'end' as const },
  ]

  return <svg className={`forecast-svg real-forecast-chart ${large ? 'is-large' : ''}`} viewBox="0 0 760 260" role="img" aria-label={`${selectedMetric} history and validated statistical forecast`}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4e7f6b" stopOpacity=".18"/><stop offset="100%" stopColor="#4e7f6b" stopOpacity="0"/></linearGradient></defs>
    {[0, .25, .5, .75, 1].map((progress) => {
      const y = plot.top + progress * (plot.bottom - plot.top)
      const value = max - progress * range
      return <g key={progress}><line x1={plot.left} x2={plot.right} y1={y} y2={y} className="chart-grid"/><text x={plot.left - 7} y={y + 2.5} textAnchor="end" className="real-chart-label">{valueLabel(value)}</text></g>
    })}
    <path d={`${path(actualPoints)} L${actualPoints.at(-1)!.x},${plot.bottom} L${actualPoints[0]!.x},${plot.bottom} Z`} fill={`url(#${gradientId})`}/>
    {showInterval && <path d={areaPath(upper, lower)} className="real-confidence-band"/>}
    <path d={path(actualPoints)} className="chart-line chart-history"/>
    {seasonalPath.length > 1 && <path d={path(seasonalPath)} className="chart-line chart-seasonality"><title>Detected seasonal component overlay</title></path>}
    {alternativePaths.map(({ model, points }) => <path key={model.key} d={path(points)} className="chart-line chart-alternative"><title>Alternative: {model.name}</title></path>)}
    <path d={path(futurePoints)} className="chart-line chart-future"/>
    <line x1={latestX} x2={latestX} y1={plot.top} y2={plot.bottom} className="chart-today"/>
    {showHolidayEffects && intelligence?.diagnostics.holidayEffects.flatMap((effect) => forecastPoints.map((point, index) => ({ effect, point, index })).filter(({ point }) => new Date(`${point.period.length === 7 ? `${point.period}-01` : point.period}T00:00:00Z`).getUTCMonth() + 1 === effect.month)).map(({ effect, point, index }) => <g key={`calendar-${effect.month}-${point.period}`}><line x1={futurePoints[index + 1]!.x} x2={futurePoints[index + 1]!.x} y1={plot.top + 15} y2={plot.bottom} className="chart-event-line"/><text x={futurePoints[index + 1]!.x + 4} y={plot.top + 12} className="chart-event-label">CALENDAR {effect.direction.toUpperCase()}</text></g>)}
    {forecastPoints.map((point, index) => <circle key={point.period} cx={futurePoints[index + 1]!.x} cy={futurePoints[index + 1]!.y} r={index === forecastPoints.length - 1 ? 4 : 2.4} className="chart-dot"><title>{showInterval ? `${periodLabel(point.period, analytics.source.frequency)}: ${valueLabel(point.value)} · 95% range ${valueLabel(point.lower)}–${valueLabel(point.upper)}` : `${periodLabel(point.period, analytics.source.frequency)}: ${valueLabel(point.value)}`}</title></circle>)}
    {intelligence?.diagnostics.anomalies.filter((anomaly) => source.some((point) => point.period === anomaly.period)).map((anomaly) => { const index = source.findIndex((point) => point.period === anomaly.period); const point = actualPoints[index]!; return <circle key={`risk-${anomaly.period}`} cx={point.x} cy={point.y} r="6" className="chart-risk"><title>Risk indicator · anomaly z-score {anomaly.zScore.toFixed(2)}</title></circle> })}
    {labelPoints.map((label) => <text key={label.period} x={label.x} y="248" textAnchor={label.anchor} className="real-chart-label">{periodLabel(label.period, analytics.source.frequency)}</text>)}
    <text x={latestX - 5} y="27" textAnchor="end" className="real-chart-today">LATEST ACTUAL</text>
    <text x={latestX + 6} y="27" textAnchor="start" className="real-chart-today">{showInterval ? 'FORECAST · 95% INTERVAL' : 'FORECAST'}</text>
  </svg>
}
