import {
  Activity, ArrowRight, BrainCircuit, BriefcaseBusiness,
  CalendarDays, CheckCircle2, CircleDollarSign, Clock3, FlaskConical, Gauge, Layers3,
  MessageSquareText, PackageSearch, Play, ShieldAlert, Sparkles, Target, TrendingUp, Users, Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Analysis, DatasetAnalytics, ForecastMetricKey, ForecastModelEvaluation } from '../api'
import { EmptyWorkspace } from '../components/EmptyWorkspace'
import { ForecastChart } from '../components/ForecastChart'
import { formatPercent, frequencyLabel } from '../format'

const metricLabels: Record<ForecastMetricKey, string> = { revenue: 'Revenue', demand: 'Demand', cost: 'Cost', inventory: 'Inventory', profit: 'Profit', kpi: 'Business KPI' }
const agentMeta: Record<string, { name: string; role: string; initials: string }> = {
  data_engineer: { name: 'Elena', role: 'Data Engineer', initials: 'EL' },
  data_scientist: { name: 'Noah', role: 'Data Scientist', initials: 'NO' },
  forecast_specialist: { name: 'Maya', role: 'Forecast Specialist', initials: 'MA' },
  risk_analyst: { name: 'Owen', role: 'Risk Analyst', initials: 'OW' },
  strategy_lead: { name: 'Ava', role: 'Strategy Lead', initials: 'AV' },
}

function metric(value: number | null, sign = false) {
  if (value === null || !Number.isFinite(value)) return '—'
  const formatted = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  return sign && value > 0 ? `+${formatted}` : formatted
}

function percent(value: number | null, digits = 1) {
  return formatPercent(value, { digits: digits === 0 ? 0 : 1 })
}

function periodLabel(period?: string, frequency?: DatasetAnalytics['source']['frequency']) {
  if (!period) return 'Unavailable'
  const parsed = new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return period
  if (frequency === 'quarterly') return `Q${Math.floor(parsed.getUTCMonth() / 3) + 1} ${parsed.getUTCFullYear()}`
  return new Intl.DateTimeFormat('en', period.length === 7 ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
}

function conclusion(output: unknown, fallback: string) {
  if (!output || typeof output !== 'object') return fallback
  const finding = output as { headline?: unknown; summary?: unknown; recommendation?: unknown }
  return [finding.headline, finding.summary, finding.recommendation].find((value): value is string => typeof value === 'string') ?? fallback
}

function modelLabel(model?: string) {
  if (!model) return 'Unavailable'
  return model === 'naive' ? 'Last-value baseline' : model.replaceAll('_', ' ')
}

function ModelDetail({ model }: { model: ForecastModelEvaluation }) {
  return <details className={`exec-model-record status-${model.status}`}>
    <summary><span><i/>{model.name}</span><em>{model.status}</em><b>{model.metrics ? `${model.metrics.accuracyPercentage.toFixed(1)}%` : '—'}</b><small>{model.metrics ? `RMSE ${metric(model.metrics.rmse)}` : 'Why not?'}</small></summary>
    <div><p><b>Decision</b>{model.reason}</p><p><b>Best use</b>{model.requiredCharacteristics}</p><p><b>Advantage</b>{model.advantages}</p><p><b>Limitation</b>{model.disadvantages}</p>{model.metrics && <p><b>Walk-forward evidence</b>MAE {metric(model.metrics.mae)} · MAPE {model.metrics.mape === null ? '—' : `${model.metrics.mape.toFixed(1)}%`} · sMAPE {model.metrics.smape === null ? '—' : `${model.metrics.smape.toFixed(1)}%`} · R² {model.metrics.r2 === null ? '—' : model.metrics.r2.toFixed(3)} · {model.trainingTimeMs?.toFixed(0)} ms</p>}</div>
  </details>
}

export function ForecastsPage({ analysis, analytics }: { analysis: Analysis | null; analytics: DatasetAnalytics | null }) {
  const [requestedMetric, setRequestedMetric] = useState<ForecastMetricKey>('revenue')
  const [activeLayers, setActiveLayers] = useState(() => new Set(['confidence', 'risk', 'opportunities']))
  const [showAlternatives, setShowAlternatives] = useState(false)
  if (!analytics) return <><header className="app-header"><div><span>EXECUTIVE DECISION ROOM</span><h1>Forecasts</h1></div></header><EmptyWorkspace title="Connect dated business data to open the Executive Forecast Room."/></>

  const availableMetrics = (Object.keys(analytics.forecasts.metrics) as ForecastMetricKey[]).filter((key) => analytics.forecasts.metrics[key] !== null)
  const selectedMetric = availableMetrics.includes(requestedMetric) ? requestedMetric : (analytics.forecasts.primaryMetric ?? requestedMetric)
  const forecast = analytics.forecasts.metrics[selectedMetric]
  const intelligence = analytics.intelligence.forecasts[selectedMetric]
  const current = analytics.metrics[selectedMetric].current
  const endpoint = forecast?.points.at(-1) ?? null
  const forecastChange = forecast?.changePercent ?? null
  const confidence = forecast?.confidence ?? Math.round(analytics.source.completeness)
  const opportunityValue = endpoint && current !== null ? endpoint.value - current : null
  const intervalWidth = endpoint ? endpoint.upper - endpoint.lower : null
  const intervalRatio = endpoint && endpoint.value !== 0 ? ((endpoint.upper - endpoint.lower) / Math.abs(endpoint.value)) * 100 : null
  const riskLevel = analytics.health.riskLevel

  const deterministicDecision = analytics.health.components.inventory.score !== null && analytics.health.components.inventory.score < 50
    ? 'Protect inventory coverage before the forecast window'
    : forecastChange !== null && forecastChange > 2 && intelligence?.diagnostics.seasonality.detected
      ? 'Prepare the business for the next seasonal growth window'
      : forecastChange !== null && forecastChange > 0
        ? `Plan capacity for the projected ${metricLabels[selectedMetric].toLowerCase()} increase`
        : 'Reduce exposure while the outlook remains uncertain'
  const decision = analysis?.briefing?.recommendation.action ?? deterministicDecision
  const decisionReason = analysis?.briefing?.recommendation.expectedImpact
    ?? (forecast ? `${modelLabel(forecast.model)} projects ${percent(forecastChange)} by ${periodLabel(endpoint?.period, analytics.source.frequency)}, with a ${confidence}% reproducible confidence score.` : 'A validated forward baseline is not yet available.')

  const toggleLayer = (key: string) => setActiveLayers((currentLayers) => {
    const next = new Set(currentLayers)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const layers = [
    { key: 'revenue', label: 'Revenue', available: Boolean(analytics.forecasts.metrics.revenue), metric: 'revenue' as ForecastMetricKey },
    { key: 'demand', label: 'Demand', available: Boolean(analytics.forecasts.metrics.demand), metric: 'demand' as ForecastMetricKey },
    { key: 'confidence', label: 'Confidence', available: Boolean(forecast) },
    { key: 'seasonality', label: 'Seasonality', available: Boolean(intelligence?.diagnostics.seasonality.detected) },
    { key: 'inventory', label: 'Inventory', available: Boolean(analytics.forecasts.metrics.inventory), metric: 'inventory' as ForecastMetricKey },
    { key: 'growth', label: 'Growth', available: forecastChange !== null },
    { key: 'marketing', label: 'Marketing', available: Boolean(intelligence?.diagnostics.marketingImpact.length) },
    { key: 'risk', label: 'Risk', available: true },
    { key: 'holiday', label: 'Holiday effects', available: Boolean(intelligence?.diagnostics.holidayEffects.length) },
    { key: 'opportunities', label: 'Opportunities', available: opportunityValue !== null },
  ]

  const timeline = (() => {
    if (!forecast?.points.length) return []
    const points = forecast.points
    const events: Array<{ period: string; title: string; detail: string; type: string }> = [{ period: points[0]!.period, title: 'Forecast window opens', detail: `${metricLabels[selectedMetric]} enters the modeled path at ${metric(points[0]!.value)}.`, type: 'forecast' }]
    if (activeLayers.has('growth') && forecastChange !== null) events.push({ period: points[Math.floor(points.length / 2)]!.period, title: forecastChange >= 0 ? 'Growth trajectory develops' : 'Downside trajectory develops', detail: `The validated endpoint change is ${percent(forecastChange)} versus the latest actual.`, type: forecastChange >= 0 ? 'opportunity' : 'risk' })
    if (activeLayers.has('seasonality') && intelligence?.diagnostics.seasonality.detected) events.push({ period: points[Math.min(1, points.length - 1)]!.period, title: 'Recurring pattern remains active', detail: `${Math.round(intelligence.diagnostics.seasonality.strength * 100)}% seasonal strength across a ${intelligence.diagnostics.seasonality.period}-period cycle.`, type: 'seasonality' })
    if (activeLayers.has('holiday')) intelligence?.diagnostics.holidayEffects.slice(0, 2).forEach((effect) => { const matching = points.find((point) => new Date(`${point.period.length === 7 ? `${point.period}-01` : point.period}T00:00:00Z`).getUTCMonth() + 1 === effect.month); if (matching) events.push({ period: matching.period, title: `Recurring calendar ${effect.direction}`, detail: `${metric(effect.effect, true)} historical effect; the engine does not infer an event name.`, type: 'holiday' }) })
    if (activeLayers.has('marketing') && intelligence?.diagnostics.marketingImpact[0]) { const impact = intelligence.diagnostics.marketingImpact[0]; events.push({ period: points[Math.floor(points.length / 2)]!.period, title: 'Marketing relationship to monitor', detail: `${impact.feature} has ${impact.coefficient.toFixed(2)} historical correlation. This is not treated as causality.`, type: 'marketing' }) }
    if (activeLayers.has('risk') && intervalRatio !== null) events.push({ period: points.at(-1)!.period, title: `${intervalRatio >= 30 ? 'Wide' : intervalRatio >= 15 ? 'Material' : 'Contained'} uncertainty at the horizon`, detail: `The 95% interval spans ${metric(intervalWidth)} or ${intervalRatio.toFixed(1)}% of the endpoint.`, type: 'risk' })
    if (activeLayers.has('opportunities') && opportunityValue !== null && opportunityValue > 0) events.push({ period: points.at(-1)!.period, title: 'Decision opportunity', detail: `${metric(opportunityValue, true)} endpoint uplift is available if operational constraints are prepared.`, type: 'opportunity' })
    return events.sort((left, right) => left.period.localeCompare(right.period))
  })()

  const fallbackTeam = [
    { key: 'data_engineer', text: `${formatPercent(analytics.source.completeness,{sign:false})} completeness across ${frequencyLabel(analytics.source.frequency,analytics.source.periods)}.` },
    { key: 'data_scientist', text: intelligence?.diagnostics.seasonality.detected ? `Seasonality detected at ${Math.round(intelligence.diagnostics.seasonality.strength * 100)}% strength.` : `${intelligence?.diagnostics.trend.direction ?? 'Stable'} trend; no material seasonality proven.` },
    { key: 'forecast_specialist', text: forecast ? `${modelLabel(forecast.model)} won ${intelligence?.validation.folds ?? 1} temporal validation folds.` : 'More history is required for a validated forecast.' },
    { key: 'risk_analyst', text: `${intelligence?.diagnostics.volatility.level ?? 'Unknown'} volatility and ${intelligence?.diagnostics.anomalies.length ?? 0} anomalous periods.` },
    { key: 'strategy_lead', text: decision },
  ]
  const team = fallbackTeam.map((fallback) => {
    const run = analysis?.agents.find((agent) => agent.agent_key === fallback.key)
    return { ...agentMeta[fallback.key]!, key: fallback.key, status: run?.status ?? 'calculated', text: conclusion(run?.output, fallback.text) }
  })

  const opportunities = [
    { label: 'Projected change', value: percent(forecastChange), detail: `By ${periodLabel(endpoint?.period, analytics.source.frequency)}`, icon: TrendingUp, visible: forecastChange !== null },
    { label: `Potential ${metricLabels[selectedMetric].toLowerCase()} uplift`, value: metric(opportunityValue, true), detail: 'Forecast endpoint versus latest actual', icon: CircleDollarSign, visible: opportunityValue !== null && opportunityValue > 0 },
    { label: 'Growth potential', value: analytics.health.components.growthPotential.score === null ? 'N/A' : `${analytics.health.components.growthPotential.score}/100`, detail: 'Business Health component', icon: Target, visible: true },
    { label: 'Demand outlook', value: percent(analytics.forecasts.metrics.demand?.changePercent ?? null), detail: analytics.forecasts.metrics.demand ? 'Validated demand model' : 'No demand series', icon: Activity, visible: Boolean(analytics.forecasts.metrics.demand) },
    { label: 'Inventory outlook', value: percent(analytics.forecasts.metrics.inventory?.changePercent ?? null), detail: analytics.forecasts.metrics.inventory ? 'Validated inventory model' : 'No inventory series', icon: PackageSearch, visible: Boolean(analytics.forecasts.metrics.inventory) },
  ].filter((item) => item.visible)

  const risks = [
    { title: 'Forecast uncertainty', value: intervalRatio === null ? 'N/A' : `${intervalRatio.toFixed(1)}%`, detail: `95% interval width ${metric(intervalWidth)}`, tone: intervalRatio !== null && intervalRatio >= 30 ? 'high' : intervalRatio !== null && intervalRatio >= 15 ? 'medium' : 'low' },
    { title: 'Demand volatility', value: intelligence?.diagnostics.volatility.level.toUpperCase() ?? 'N/A', detail: `${intelligence?.diagnostics.anomalies.length ?? 0} anomalies detected`, tone: intelligence?.diagnostics.volatility.level ?? 'medium' },
    { title: 'Inventory exposure', value: analytics.health.components.inventory.score === null ? 'N/A' : `${analytics.health.components.inventory.score}/100`, detail: analytics.health.components.inventory.explanation, tone: (analytics.health.components.inventory.score ?? 100) < 40 ? 'high' : (analytics.health.components.inventory.score ?? 100) < 65 ? 'medium' : 'low' },
  ]

  const evaluated = intelligence?.models.filter((model) => model.status === 'evaluated').sort((left, right) => (left.selectionScore ?? Infinity) - (right.selectionScore ?? Infinity)) ?? []
  const alternatives = evaluated.filter((model) => !intelligence?.strategy.selectedModels.includes(model.key)).slice(0, 3)
  const rejected = intelligence?.models.filter((model) => model.status !== 'evaluated') ?? []
  const periodUnit = analytics.source.frequency === 'daily' ? 'DAY' : analytics.source.frequency === 'weekly' ? 'WEEK' : analytics.source.frequency === 'quarterly' ? 'QUARTER' : 'MONTH'

  return <>
    <header className="app-header exec-page-header"><div><span>EXECUTIVE DECISION ROOM · LIVE MODEL</span><h1>Forecast Intelligence</h1></div><div className="forecast-metric-switch" role="group" aria-label="Forecast metric">{availableMetrics.map((key) => <button key={key} className={key === selectedMetric ? 'active' : ''} onClick={() => setRequestedMetric(key)}>{metricLabels[key]}</button>)}</div></header>

    <section className={`exec-decision risk-${riskLevel.toLowerCase()}`}>
      <div className="exec-decision-signal"><span><Sparkles size={14}/> AI TEAM DECISION</span><i>{analytics.intelligence.status === 'ready' ? 'Scientific engine verified' : 'Validated fallback'}</i></div>
      <div className="exec-decision-main"><div><small>{riskLevel} RISK · {confidence}% CONFIDENCE</small><h2>{decision}</h2><p>{decisionReason}</p></div><div className="exec-decision-score"><strong>{percent(forecastChange)}</strong><span>{metricLabels[selectedMetric]}<br/>forecast change</span></div></div>
      <div className="exec-decision-footer"><div><span>Expected endpoint</span><b>{metric(endpoint?.value ?? null)}</b><small>{periodLabel(endpoint?.period, analytics.source.frequency)}</small></div><div><span>95% decision range</span><b>{endpoint ? `${metric(endpoint.lower)}–${metric(endpoint.upper)}` : '—'}</b><small>Conformal uncertainty</small></div><div><span>Selected strategy</span><b>{modelLabel(forecast?.model)}</b><small>{intelligence?.strategy.type ?? 'fallback'} model</small></div><div className="exec-decision-actions"><Link to="/app/simulator"><Play size={13} fill="currentColor"/> Present decision</Link><Link to="/app/meetings"><MessageSquareText size={13}/> Ask the team</Link></div></div>
    </section>

    <section className="exec-workbench">
      <aside className="exec-layers panel"><header><Layers3 size={15}/><div><span>FORECAST LAYERS</span><h3>Build your business view</h3></div></header><div>{layers.map((layer) => <button key={layer.key} disabled={!layer.available} className={(layer.metric ? selectedMetric === layer.metric : activeLayers.has(layer.key)) ? 'active' : ''} onClick={() => { if (layer.metric) setRequestedMetric(layer.metric); else toggleLayer(layer.key) }}><i/><span>{layer.label}</span><small>{layer.available ? 'available' : 'no evidence'}</small></button>)}</div></aside>
      <article className="exec-chart panel">
        <header><div><span>{metricLabels[selectedMetric].toUpperCase()} · {forecast?.horizon ?? 6}-{periodUnit} OUTLOOK</span><h3>The modeled path forward</h3><p>{forecast ? `${frequencyLabel(analytics.source.frequency,forecast.trainingPeriods)} of actual history · ${intelligence?.validation.folds ?? 1} walk-forward folds · no random split` : 'Waiting for a validated forecast.'}</p></div><div className="exec-chart-actions"><button className={showAlternatives ? 'active' : ''} onClick={() => setShowAlternatives((visible) => !visible)}>Compare models</button><span className="exec-confidence-mini"><b>{confidence}%</b><small>confidence</small></span></div></header>
        <ForecastChart analytics={analytics} metric={selectedMetric} showInterval={activeLayers.has('confidence')} showAlternatives={showAlternatives} showSeasonality={activeLayers.has('seasonality')} showHolidayEffects={activeLayers.has('holiday')} large/>
        <footer><span><i className="actual"/>Actual</span><span><i className="projected"/>Selected forecast</span>{activeLayers.has('confidence')&&<span><i className="range"/>95% interval</span>}{showAlternatives&&<span><i className="alternative"/>Alternative models</span>}{activeLayers.has('seasonality')&&<span><i className="seasonal"/>Seasonal profile</span>}<em>Latest actual separates history from model output</em></footer>
      </article>
      <aside className="exec-story panel"><header><Clock3 size={15}/><div><span>FORECAST TIMELINE</span><h3>The future, explained</h3></div></header><div className="exec-story-line">{timeline.map((event, index) => <article className={`story-${event.type}`} key={`${event.period}-${event.title}`}><i/><small>{periodLabel(event.period, analytics.source.frequency)}</small><b>{event.title}</b><p>{event.detail}</p>{index < timeline.length - 1 && <span/>}</article>)}{!timeline.length&&<p className="exec-empty">A validated timeline will appear when forecast points are available.</p>}</div></aside>
    </section>

    <section className="exec-section-head"><div><span>AI TEAM LIVE ANALYSIS</span><h2>Five specialists. One coordinated view of the future.</h2></div><Link to="/app/meetings">Open team meeting <ArrowRight size={14}/></Link></section>
    <section className="exec-team">{team.map((agent, index) => <article className="panel" key={agent.key}><header><span>{agent.initials}</span><div><b>{agent.name}</b><small>{agent.role}</small></div><em><i/>{agent.status}</em></header><p>{agent.text}</p><footer><span>0{index + 1}</span>{index < team.length - 1 && <><small>HANDOFF</small><ArrowRight size={12}/></>}</footer></article>)}</section>

    <section className="exec-opportunity-risk">
      <article className="exec-opportunities panel"><header><div><span>BUSINESS OPPORTUNITIES</span><h2>Where the forecast creates room to act</h2></div><BriefcaseBusiness size={20}/></header><div>{opportunities.map(({ label, value, detail, icon: Icon }) => <article key={label}><span><Icon size={15}/></span><p><small>{label}</small><b>{value}</b><em>{detail}</em></p></article>)}</div><p className="exec-method-note">All values are calculated from the selected model and latest actual baseline. They are not LLM estimates.</p></article>
      <article className="exec-risks panel"><header><div><span>RISK REGISTER</span><h2>What could change the outcome</h2></div><ShieldAlert size={20}/></header><div>{risks.map((risk) => <article key={risk.title}><i className={`risk-dot ${risk.tone}`}/><p><b>{risk.title}</b><small>{risk.detail}</small></p><strong>{risk.value}</strong></article>)}</div><Link to="/app/simulator"><FlaskConical size={14}/> Stress-test these assumptions <ArrowRight size={13}/></Link></article>
    </section>

    <section className="exec-simulator panel"><div><span><Zap size={16}/></span><p><small>DECISION ROOM INTEGRATION</small><b>Turn this forecast into an executive business proposal.</b><em>Present visible price, demand, cost, capacity, and inventory assumptions to the AI Team. No LLM generates the numerical outcome.</em></p></div><Link to="/app/simulator">Open Decision Room <ArrowRight size={14}/></Link></section>

    <section className="exec-science-grid">
      <article className="exec-tournament panel"><header><div><span>MODEL TOURNAMENT</span><h2>Why this strategy won</h2><p>{intelligence?.strategy.reason ?? 'The deterministic fallback remains active.'}</p></div><em><BrainCircuit size={13}/>{intelligence?.validation.method ?? 'Temporal validation'}</em></header>{intelligence ? <><div className="exec-winner"><span><CheckCircle2 size={18}/></span><div><small>SELECTED · {intelligence.strategy.type.toUpperCase()}</small><h3>{intelligence.strategy.selectedName}</h3><p>{intelligence.strategy.weights.map((weight) => `${intelligence.models.find((model) => model.key === weight.model)?.name ?? weight.model} ${(weight.weight * 100).toFixed(1)}%`).join(' + ')}</p></div><strong>{confidence}%<small>confidence</small></strong></div><div className="exec-challengers"><span>Closest validated alternatives</span>{alternatives.map((model, index) => <div key={model.key}><em>0{index + 2}</em><b>{model.name}</b><span>RMSE {metric(model.metrics?.rmse ?? null)}</span><small>{model.metrics?.accuracyPercentage.toFixed(1)}% accuracy</small></div>)}</div><details className="exec-all-models"><summary>{intelligence.models.length} model decisions · {rejected.length} rejected or unavailable</summary>{intelligence.models.map((model) => <ModelDetail model={model} key={model.key}/>)}</details></> : <p className="exec-empty">Scientific tournament detail is not available for this dataset.</p>}</article>
      <article className="exec-confidence panel"><header><div><span>CONFIDENCE BREAKDOWN</span><h2>{confidence}% is an audit, not a feeling</h2></div><Gauge size={19}/></header>{intelligence ? <><p>{intelligence.strategy.confidenceMethodology.methodology}</p><div>{Object.entries(intelligence.strategy.confidenceMethodology.components).map(([key, value]) => <article key={key}><span>{key.replace(/([A-Z])/g, ' $1')}<small>{Math.round((intelligence.strategy.confidenceMethodology.weights[key] ?? 0) * 100)}% weight</small></span><b>{Math.round(value)}</b><i><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }}/></i></article>)}</div><footer><CalendarDays size={14}/><span>{intelligence.validation.folds} expanding windows × {intelligence.validation.horizon} steps</span><b>Random split: never</b></footer></> : <p className="exec-empty">Confidence methodology becomes visible after the scientific engine completes.</p>}</article>
    </section>

    <footer className="exec-room-footer"><Users size={15}/><p><b>Executive Forecast Room</b><span>Analytics V{analytics.version} · Engine {analytics.intelligence.engineVersion} · Generated {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(analytics.generatedAt))}</span></p><em>Every numerical projection comes from the forecasting engine.</em></footer>
  </>
}
