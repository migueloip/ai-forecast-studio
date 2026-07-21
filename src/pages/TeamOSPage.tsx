import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Code2,
  Database,
  FileCheck2,
  FileText,
  GitBranch,
  Info,
  Layers3,
  MessageSquareText,
  Network,
  Plus,
  RefreshCw,
  Route,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
} from 'lucide-react'
import {
  getAnalysis,
  getExecutiveOverview,
  recalculateForecast,
  startAnalysis,
  type AgentRun,
  type Analysis,
  type ApiDataset,
  type DatasetAnalytics,
  type ForecastModelEvaluation,
  type ExecutiveOverview,
} from '../api'
import { useAuth } from '../auth'
import { BookmarkButton } from '../components/BookmarkButton'
import { EmptyWorkspace } from '../components/EmptyWorkspace'
import { safeErrorMessage } from '../errors'

type TeamMode = 'team' | 'trace'

interface FindingOutput {
  headline?: string
  summary?: string
  severity?: 'info' | 'opportunity' | 'warning' | 'critical'
  recommendation?: string
  evidence?: Array<{ label: string; value: string; source: string }>
  metrics?: Array<{ label: string; value: string; trend: 'up' | 'down' | 'stable' | 'unknown' }>
}

interface SpecialistDefinition {
  key: string
  initials: string
  name: string
  role: string
  color: string
  completedOutcome: string
  runningOutcome: string
  method: string
}

interface EvidenceHandoff {
  id: string
  index: number
  from: AgentRun
  to: AgentRun
  fromSpecialist: SpecialistDefinition
  toSpecialist: SpecialistDefinition
  evidence: Array<{ label: string; value: string; source: string }>
  summary: string
  timestamp: string | null
}

const specialists: SpecialistDefinition[] = [
  { key: 'data_engineer', initials: 'E', name: 'Elena', role: 'Data Engineer', color: '#7b6cf6', completedOutcome: 'Data validated', runningOutcome: 'Validating data', method: 'Schema profiling, completeness review, and temporal coverage validation' },
  { key: 'data_scientist', initials: 'N', name: 'Noah', role: 'Data Scientist', color: '#ee7c58', completedOutcome: 'Patterns detected', runningOutcome: 'Detecting patterns', method: 'Trend, seasonality, anomaly, volatility, and correlation diagnostics' },
  { key: 'forecast_specialist', initials: 'M', name: 'Maya', role: 'Forecast Specialist', color: '#31a97a', completedOutcome: 'Forecast selected', runningOutcome: 'Selecting forecast', method: 'Temporal validation and objective model tournament' },
  { key: 'risk_analyst', initials: 'O', name: 'Owen', role: 'Risk Analyst', color: '#dc9f35', completedOutcome: 'Risk assessed', runningOutcome: 'Assessing risk', method: 'Forecast interval, downside exposure, and operational constraint review' },
  { key: 'strategy_lead', initials: 'A', name: 'Ava', role: 'Strategy Lead', color: '#4289e8', completedOutcome: 'Strategy delivered', runningOutcome: 'Building strategy', method: 'Evidence synthesis, prioritization, safeguards, and decision-window design' },
]

const atlas: SpecialistDefinition = {
  key: 'team_lead', initials: 'AT', name: 'Atlas', role: 'AI Chief Data Scientist', color: '#73a88f',
  completedOutcome: 'Consensus delivered', runningOutcome: 'Synthesizing consensus', method: 'Cross-specialist evidence synthesis',
}

const frequencyDictionary = {
  daily: { label: 'Daily', singular: 'day', plural: 'days', adjective: 'daily' },
  weekly: { label: 'Weekly', singular: 'week', plural: 'weeks', adjective: 'weekly' },
  monthly: { label: 'Monthly', singular: 'month', plural: 'months', adjective: 'monthly' },
  quarterly: { label: 'Quarterly', singular: 'quarter', plural: 'quarters', adjective: 'quarterly' },
} as const

function finding(output: unknown): FindingOutput {
  return output && typeof output === 'object' ? output as FindingOutput : {}
}

function formatModel(value?: string | null) {
  if (!value) return 'Unavailable'
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatValue(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function timestamp(value?: string | null) {
  if (!value) return 'Pending'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function runtime(start?: string | null, end?: string | null) {
  if (!start || !end) return 'Unavailable'
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime())
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`
}

function runOutcome(specialist: SpecialistDefinition, run?: AgentRun) {
  if (!run) return 'Not deployed'
  if (run.status === 'completed') return specialist.completedOutcome
  if (run.status === 'running') return specialist.runningOutcome
  if (run.status === 'failed') return 'Run needs attention'
  return 'Awaiting evidence'
}

function handoffSummary(run: AgentRun) {
  const output = finding(run.output)
  return output.headline ?? output.summary ?? output.recommendation ?? 'Persisted specialist finding'
}

function buildHandoffs(analysis: Analysis | null) {
  if (!analysis) return []
  const orderedRuns = analysis.agents.slice().sort((left, right) => left.sequence - right.sequence)
  const result: EvidenceHandoff[] = []
  for (let index = 0; index < orderedRuns.length - 1; index += 1) {
    const from = orderedRuns[index]!
    const to = orderedRuns[index + 1]!
    if (from.status !== 'completed' || !to.started_at) continue
    const fromSpecialist = specialists.find((item) => item.key === from.agent_key) ?? atlas
    const toSpecialist = specialists.find((item) => item.key === to.agent_key) ?? atlas
    result.push({ id: `${from.id}:${to.id}`, index, from, to, fromSpecialist, toSpecialist, evidence: finding(from.output).evidence ?? [], summary: handoffSummary(from), timestamp: to.started_at })
  }
  return result
}

function buildEvidenceTransfers(analysis: Analysis | null) {
  if (!analysis) return []
  const runs = analysis.agents.slice().sort((left, right) => left.sequence - right.sequence)
  const transfers: EvidenceHandoff[] = []
  for (let destinationIndex = 1; destinationIndex < runs.length; destinationIndex += 1) {
    const to = runs[destinationIndex]!
    if (!to.started_at) continue
    for (let sourceIndex = 0; sourceIndex < destinationIndex; sourceIndex += 1) {
      const from = runs[sourceIndex]!
      if (from.status !== 'completed') continue
      transfers.push({
        id: `${from.id}:${to.id}`, index: sourceIndex, from, to,
        fromSpecialist: specialists.find((item) => item.key === from.agent_key) ?? atlas,
        toSpecialist: specialists.find((item) => item.key === to.agent_key) ?? atlas,
        evidence: finding(from.output).evidence ?? [], summary: handoffSummary(from), timestamp: to.started_at,
      })
    }
  }
  return transfers
}

function endpointStatus(analysis: Analysis | null, analytics: DatasetAnalytics | null) {
  if (!analysis?.briefing || analysis.status !== 'completed') return { label: 'REQUIRES MORE DATA', tone: 'pending', reason: 'The final persisted briefing is not available.' }
  if (analytics?.health.riskLevel === 'HIGH') return { label: 'HIGH RISK', tone: 'risk', reason: 'Deterministic Business Health identifies material exposure.' }
  if (analysis.briefing.forecastConfidence === null) return { label: 'REQUIRES MORE DATA', tone: 'pending', reason: 'Validated forecast confidence is unavailable.' }
  return { label: 'RECOMMENDATION READY', tone: 'ready', reason: 'The evidence chain and executive recommendation are complete.' }
}

function normalizeFrequencyText(text: string, frequency: keyof typeof frequencyDictionary | null, horizon: number) {
  if (!frequency) return text
  const unit = frequencyDictionary[frequency]
  const horizonText = `${horizon} ${horizon === 1 ? unit.singular : unit.plural}`
  return text
    .replace(/\bper\s+(?:day|week|month|quarter)\b/gi, `per ${unit.singular}`)
    .replace(/\b(?:the\s+)?next\s+\d+\s+(?:days?|weeks?|months?|quarters?)\b/gi, `the next ${horizonText}`)
    .replace(/\b\d+\s+(?:days?|weeks?|months?|quarters?)\s+(?:horizon|period)\b/gi, `${horizonText} horizon`)
    .replace(/\b(daily|weekly|monthly|quarterly)\b/gi, unit.adjective)
}

function specialistLimitations(specialist: SpecialistDefinition, analytics: DatasetAnalytics | null, output: FindingOutput) {
  if (!analytics) return ['No deterministic analytics profile is available.']
  const metric = analytics.forecasts.primaryMetric
  const intelligence = metric ? analytics.intelligence.forecasts[metric] : null
  if (specialist.key === 'data_engineer') return analytics.source.completeness < 100 ? [`Completeness is ${Math.round(analytics.source.completeness)}%.`] : ['Semantic field meaning still depends on the uploaded source.']
  if (specialist.key === 'data_scientist') return [intelligence ? `${intelligence.diagnostics.anomalies.length} anomalies define the persisted diagnostic scope.` : 'Advanced diagnostics are unavailable.']
  if (specialist.key === 'forecast_specialist') {
    const rejected = intelligence?.models.filter((model) => model.status === 'rejected').slice(0, 2) ?? []
    return rejected.length ? rejected.map((model) => `${model.name}: ${model.reason}`) : ['No rejected-model limitation was persisted.']
  }
  if (specialist.key === 'risk_analyst') return [output.severity ? `Finding type: ${output.severity}. Conclusions remain conditional on the validated interval.` : 'No structured finding type was persisted.']
  return ['Implementation has not been validated through a persisted business decision.']
}

function modelAlternatives(analytics: DatasetAnalytics | null) {
  const metric = analytics?.forecasts.primaryMetric
  const intelligence = metric ? analytics?.intelligence.forecasts[metric] : null
  if (!intelligence) return []
  const selected = new Set(intelligence.strategy.selectedModels)
  return intelligence.models.filter((model) => !selected.has(model.name) && !selected.has(model.key)).slice(0, 5)
}

function modelMetric(model: ForecastModelEvaluation) {
  if (model.status === 'rejected') return 'Rejected by eligibility rules'
  if (!model.metrics) return model.status
  return `RMSE ${model.metrics.rmse.toFixed(2)} · accuracy ${model.metrics.accuracyPercentage.toFixed(1)}%`
}

function isUnvalidatedTarget(label: string, value: string) {
  return /target|goal|after enrichment|projected improvement|<=|≤/i.test(`${label} ${value}`)
}

export function TeamOSPage({ analysis, dataset, analytics }: { analysis: Analysis | null; dataset: ApiDataset | null; analytics: DatasetAnalytics | null }) {
  const { user } = useAuth()
  const [selectedKey, setSelectedKey] = useState('forecast_specialist')
  const [mode, setMode] = useState<TeamMode>('team')
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null)
  const [recalculating, setRecalculating] = useState(false)
  const [actionError, setActionError] = useState('')
  const [overview, setOverview] = useState<ExecutiveOverview | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => { cancelled.current = true }
  }, [])

  useEffect(() => {
    let active = true
    getExecutiveOverview().then((result) => { if (active) setOverview(result.overview) }).catch(() => undefined)
    return () => { active = false }
  }, [analysis?.id])

  if (!dataset && !analysis) return <><header className="app-header"><div><span>EXECUTIVE COLLABORATIVE INTELLIGENCE</span><h1>AI Team OS</h1></div></header><EmptyWorkspace /></>

  const handoffs = buildHandoffs(analysis)
  const evidenceTransfers = buildEvidenceTransfers(analysis)
  const selectedSpecialist = specialists.find((item) => item.key === selectedKey) ?? specialists[2]!
  const selectedRun = analysis?.agents.find((run) => run.agent_key === selectedSpecialist.key)
  const selectedOutput = finding(selectedRun?.output)
  const selectedHandoff = handoffs.find((handoff) => handoff.id === selectedHandoffId) ?? null
  const receivedHandoffs = evidenceTransfers.filter((handoff) => handoff.to.agent_key === selectedSpecialist.key)
  const sentHandoffs = evidenceTransfers.filter((handoff) => handoff.from.agent_key === selectedSpecialist.key)
  const context = analysis?.dataset_context?.length
    ? analysis.dataset_context
    : dataset ? [{ id: dataset.id, name: dataset.filename.replace(/\.[^.]+$/, ''), filename: dataset.filename, rowCount: dataset.row_count, periods: dataset.summary.timeSeries.length }] : []
  const contextName = context.length > 1 ? context.map((item) => item.name).join(' + ') : context[0]?.name ?? 'Business context'
  const contextRows = context.reduce((sum, item) => sum + item.rowCount, 0)
  const endpoint = endpointStatus(analysis, analytics)
  const briefing = analysis?.briefing
  const metricKey = analytics?.forecasts.primaryMetric
  const forecast = metricKey ? analytics?.forecasts.metrics[metricKey] : null
  const intelligence = metricKey ? analytics?.intelligence.forecasts[metricKey] : null
  const rawFrequency = intelligence?.frequency ?? (analytics?.source.frequency !== 'irregular' ? analytics?.source.frequency : null)
  const frequency = rawFrequency && rawFrequency in frequencyDictionary ? rawFrequency as keyof typeof frequencyDictionary : null
  const frequencyInfo = frequency ? frequencyDictionary[frequency] : null
  const horizon = forecast?.points.length ?? 0
  const horizonText = frequencyInfo && horizon ? `${horizon} ${horizon === 1 ? frequencyInfo.singular : frequencyInfo.plural}` : 'Unavailable'
  const endpointPoint = forecast?.points.at(-1)
  const strategy = intelligence?.strategy.selectedName ?? forecast?.model ?? 'Unavailable'
  const metricLabel = forecast?.column ?? metricKey?.replace(/\b\w/g, (character) => character.toUpperCase()) ?? 'Primary metric'
  const alternatives = selectedSpecialist.key === 'forecast_specialist' ? modelAlternatives(analytics) : []
  const limitations = specialistLimitations(selectedSpecialist, analytics, selectedOutput)
  const leadRun = analysis?.agents.find((run) => run.agent_key === 'team_lead')
  const readiness = forecast?.confidence ?? 0
  const driversAvailable = Boolean((intelligence?.diagnostics.correlations.length ?? 0) + (intelligence?.diagnostics.marketingImpact.length ?? 0))
  const historyStrong = (analytics?.source.periods ?? 0) >= 36
  const modelEnriched = analytics?.intelligence.status === 'ready' && readiness >= 70
  const dataValidated = analysis?.agents.some((run) => run.agent_key === 'data_engineer' && run.status === 'completed') ?? false
  const forecastSelected = Boolean(forecast && analysis?.agents.some((run) => run.agent_key === 'forecast_specialist' && run.status === 'completed'))
  const riskAssessed = analysis?.agents.some((run) => run.agent_key === 'risk_analyst' && run.status === 'completed') ?? false
  const safeSynthesis = normalizeFrequencyText(briefing?.executiveSummary ?? 'The full team synthesis is not available.', frequency, horizon)
  const safeRecommendation = normalizeFrequencyText(briefing?.recommendation.action ?? 'Awaiting strategy recommendation.', frequency, horizon)
  const executiveStats: Array<{ label: string; value: string | number; Icon: typeof Database }> = [
    { label: 'Businesses analyzed', value: overview?.stats.businessesAnalyzed ?? (dataset ? 1 : 0), Icon: Database },
    { label: 'Forecast confidence', value: overview?.stats.forecastConfidence === null || overview?.stats.forecastConfidence === undefined ? '—' : `${Math.round(overview.stats.forecastConfidence)}%`, Icon: BrainCircuit },
    { label: 'Business alerts', value: overview?.stats.businessAlerts ?? 0, Icon: Bell },
    { label: 'Pending decisions', value: overview?.stats.pendingDecisions ?? 0, Icon: Target },
    { label: 'High priority risks', value: overview?.stats.highPriorityRisks ?? 0, Icon: AlertTriangle },
    { label: 'Growth opportunities', value: overview?.stats.growthOpportunities ?? 0, Icon: TrendingUp },
  ]

  const selectHandoff = (handoff: EvidenceHandoff) => {
    setSelectedHandoffId(handoff.id)
    if (handoff.to.agent_key !== 'team_lead') setSelectedKey(handoff.to.agent_key)
  }

  const runRecalculation = async () => {
    const datasetIds = context.map((item) => item.id)
    if (!datasetIds.length || recalculating) return
    try {
      setRecalculating(true)
      setActionError('')
      await recalculateForecast(datasetIds)
      const started = await startAnalysis(datasetIds)
      for (let attempt = 0; attempt < 100 && !cancelled.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500))
        const result = await getAnalysis(started.analysisId)
        if (result.analysis.status === 'completed') {
          window.location.reload()
          return
        }
        if (result.analysis.status === 'failed') throw new Error(result.analysis.error ?? 'The recalculated analysis did not complete.')
      }
      if (!cancelled.current) throw new Error('The recalculation is still running. Refresh the workspace shortly.')
    } catch (error) {
      if (!cancelled.current) setActionError(safeErrorMessage(error, 'The forecast could not be recalculated.'))
    } finally {
      if (!cancelled.current) setRecalculating(false)
    }
  }

  return <>
    <header className="app-header osv2-page-header v4-home-header"><div><span>AI EXECUTIVE OPERATING SYSTEM</span><h1>Good morning, {user?.fullName.split(/\s+/)[0] ?? 'Executive'}.</h1><p>Your AI Executive Team {analysis?.status === 'completed' ? 'has completed the latest business analysis.' : analysis?.status === 'running' ? 'is working on the latest business analysis.' : 'is ready for its next assignment.'}</p></div><div className="osv2-header-actions"><BookmarkButton datasetId={dataset?.id} resourceType="ai_team_consensus" resourceId={analysis?.id ?? dataset?.id ?? 'workspace'} title={briefing?.headline ?? 'AI Team consensus'} actionUrl="/app"/><div className="osv2-mode-switch"><button className={mode === 'team' ? 'active' : ''} onClick={() => setMode('team')}><Network size={13} /> Team View</button><button className={mode === 'trace' ? 'active' : ''} onClick={() => setMode('trace')}><Code2 size={13} /> Trace View</button></div><Link className="button button-app" to="/onboarding"><Plus size={14} /> New analysis</Link></div></header>

    {mode === 'team' && <section className="v4-stat-grid">{executiveStats.map(({label,value,Icon}) => <article className="panel" key={label}><Icon size={14}/><span><small>{label}</small><b>{value}</b></span></article>)}</section>}

    <section className="osv2-context-bar"><span><Database size={12} /> ACTIVE DATA CONTEXT</span><strong>{contextName}</strong><div>{context.map((item) => <em key={item.id}><Database size={9} /> {item.name}</em>)}</div><small>{context.length > 1 ? 'Exact multi-dataset context' : 'Isolated business context'} · {contextRows.toLocaleString()} records</small></section>

    {mode === 'team' && context.length > 1 && overview && <section className="panel v4-comparison"><header><span>MULTI-DATASET EXECUTIVE MODE</span><h2>Comparative business health and forecast reliability</h2><p>Each value comes from the isolated persisted analytics for that business.</p></header><div>{overview.businesses.filter((business)=>context.some((item)=>item.id===business.id)).map((business)=><article key={business.id}><span><Database size={11}/><b>{business.name}</b></span><span><small>Business Health</small><b>{business.businessHealth}/100</b></span><span><small>Forecast Confidence</small><b>{business.confidence===null?'—':`${Math.round(business.confidence)}%`}</b></span><em className={`risk-${business.risk.toLowerCase()}`}>{business.risk} risk</em></article>)}</div></section>}

    {mode === 'team' && overview && <section className="v4-operating-grid">
      <article className="panel v4-team-status"><header><Activity size={13}/><div><span>AI TEAM STATUS</span><h2>Work completed while you were away</h2></div></header><div>{overview.teamStatus.slice(0,6).map((run) => <p key={`${run.agent_key}-${run.completed_at}`}><i className={`status-${run.status}`}/><span><b>{run.agent_name}</b><small>{run.status === 'completed' ? finding(run.output).headline ?? 'Specialist outcome persisted' : run.status === 'running' ? 'Working on the active business context' : run.status}</small></span><em>{timestamp(run.completed_at ?? run.started_at)}</em></p>)}</div></article>
      <article className="panel v4-executive-alerts"><header><Bell size={13}/><div><span>EXECUTIVE NOTIFICATIONS</span><h2>Changes that deserve attention</h2></div></header><div>{overview.notifications.slice(0,4).map((item) => <Link key={item.id} to={item.action_url ?? '/app'}><i className={`severity-${item.severity}`}/><span><b>{item.title}</b><small>{item.message}</small></span><ArrowRight size={11}/></Link>)}{!overview.notifications.length&&<p>The AI Team has no new exceptions to escalate.</p>}</div></article>
      <article className="panel v4-health-timeline"><header><Clock3 size={13}/><div><span>BUSINESS HEALTH TIMELINE</span><h2>How the business state changed</h2></div></header><div>{overview.timeline.slice(0,6).map((item) => <Link key={item.id} to={item.actionUrl ?? '/app'}><i/><span><b>{item.title}</b><small>{item.detail}</small></span><em>{timestamp(item.createdAt)}</em></Link>)}</div></article>
      <article className="panel v4-business-memory"><header><Database size={13}/><div><span>BUSINESS MEMORY</span><h2>The AI Team remembers</h2></div></header><div>{[['Business contexts',overview.memory.businessContexts],['Dataset history',overview.memory.datasetHistory],['Forecast history',overview.memory.forecastHistory],['Recommendations',overview.memory.recommendations],['Decision history',overview.memory.decisions],['Specialist conversations',overview.memory.specialistConversations]].map(([label,value])=><span key={String(label)}><small>{label}</small><b>{value}</b></span>)}</div></article>
    </section>}

    <section className={`v3-consensus ${endpoint.tone}`}>
      <div className="v3-consensus-lead"><span><Sparkles size={12} /> AI TEAM CONSENSUS</span><h2><small>{metricLabel} outlook</small>{endpoint.label}</h2><p>{endpointPoint && frequencyInfo ? `${metricLabel} reaches ${formatValue(endpointPoint.value)} per ${frequencyInfo.singular} at the end of the ${horizonText} forecast horizon.` : 'A validated forecast endpoint is not available.'} {intelligence?.diagnostics.volatility.level === 'high' ? 'High volatility materially limits reliability.' : endpoint.reason}</p><div><span><small>Primary risk</small><b>{briefing?.primaryRisk.title ?? 'Pending'}</b></span><span><small>Business impact</small><b>{analytics?.health.riskLevel ?? 'Unavailable'} risk</b></span></div></div>
      <div className="v3-forecast-evidence"><header><span>FORECAST EVIDENCE</span><em>{frequencyInfo?.label ?? 'Frequency unavailable'}</em></header><div><span><small>{metricLabel}</small><b>{formatValue(endpointPoint?.value)}{frequencyInfo && <em> / {frequencyInfo.singular}</em>}</b></span><span><small>Confidence</small><b>{forecast ? `${Math.round(forecast.confidence)}%` : '—'}</b></span><span><small>MAPE</small><b>{forecast?.accuracy.mape === null || forecast?.accuracy.mape === undefined ? '—' : `${forecast.accuracy.mape.toFixed(1)}%`}</b></span><span><small>Volatility</small><b>{intelligence?.diagnostics.volatility.level ?? '—'}</b></span><span><small>Selected strategy</small><b>{formatModel(strategy)}</b></span></div><footer><span>Horizon: <b>{horizonText}</b></span><span>History: <b>{analytics?.source.periods ?? 0} {frequencyInfo?.plural ?? 'periods'}</b></span></footer></div>
      <div className="v3-consensus-actions"><details><summary>Read full team synthesis <ChevronDown size={11} /></summary><p>{safeSynthesis}</p><strong>{safeRecommendation}</strong></details><div><Link to="/app/reports"><FileText size={12} /> Executive Brief</Link><Link to="/app/simulator"><Target size={12} /> Decision Room</Link></div></div>
    </section>

    {mode === 'team' && <section className="v3-executive-grid">
      <article className="panel v3-readiness"><header><div><span>FORECAST READINESS</span><h2>{Math.round(readiness)}%</h2></div><div className="v3-readiness-ring" style={{ '--readiness': `${readiness * 3.6}deg` } as CSSProperties}><span /></div></header><div>{[[dataValidated, 'Dataset validated'], [forecastSelected, 'Forecast selected'], [riskAssessed, 'Risk assessed'], [driversAvailable, driversAvailable ? 'External drivers available' : 'External drivers missing'], [historyStrong, historyStrong ? 'Historical horizon sufficient' : 'Historical horizon can improve'], [modelEnriched, modelEnriched ? 'Model enrichment validated' : 'Model enrichment recommended'], [false, 'Decision simulation pending']].map(([ready, label]) => <p key={String(label)} className={ready ? 'ready' : ''}>{ready ? <CheckCircle2 size={12} /> : <Circle size={12} />}<span>{label}</span></p>)}</div><footer>Readiness equals persisted forecast confidence; checklist items explain the remaining path.</footer></article>
      <article className="panel v3-actions"><header><span>RECOMMENDED NEXT ACTIONS</span><h2>Move from insight to execution.</h2><p>{safeRecommendation}</p></header><div><Link to="/onboarding?intent=drivers"><Layers3 size={14} /><span><b>Add external drivers</b><small>Upload business factors</small></span><ArrowRight size={12} /></Link><Link to="/onboarding?intent=recent-data"><Upload size={14} /><span><b>Upload recent data</b><small>Extend historical coverage</small></span><ArrowRight size={12} /></Link><button disabled={recalculating} onClick={() => { void runRecalculation() }}><RefreshCw className={recalculating ? 'is-spinning' : ''} size={14} /><span><b>{recalculating ? 'Recalculating forecast' : 'Re-run model tournament'}</b><small>{recalculating ? 'Specialists will refresh automatically' : 'Execute deterministic engine'}</small></span><ArrowRight size={12} /></button><Link to="/app/forecasts"><Target size={14} /><span><b>Improve confidence</b><small>Inspect forecast evidence</small></span><ArrowRight size={12} /></Link></div>{actionError && <p className="v3-action-error"><ShieldAlert size={12} /> {actionError}</p>}</article>
    </section>}

    {mode === 'trace' && <section className="osv2-provenance panel"><div><span>ANALYSIS ID</span><code>{analysis?.id ?? 'not deployed'}</code></div><div><span>PERSISTENCE</span><b>Neon · {analysis?.agents.length ?? 0} runs</b></div><div><span>ORCHESTRATION MODEL</span><b>{analysis?.model ?? 'Unavailable'}</b></div><div><span>ATLAS RESPONSE REFERENCE</span><code>{leadRun?.openai_response_id ?? 'Unavailable'}</code></div><div><span>COMPLETED</span><b>{timestamp(analysis?.completed_at)}</b></div></section>}

    {mode === 'team' && <section className="v3-story"><span>Business data</span><ArrowRight /><span>Validation</span><ArrowRight /><span>Pattern detection</span><ArrowRight /><span>Forecast selection</span><ArrowRight /><span>Risk assessment</span><ArrowRight /><span>Strategy</span><ArrowRight /><span>Atlas consensus</span><ArrowRight /><strong>Business decision</strong></section>}

    <section className={`osv2-network-shell v3-network mode-${mode}`}>
      <div className="osv2-network-head"><div><span>{mode === 'team' ? 'SPECIALIST CONTRIBUTIONS' : 'TECHNICAL EVIDENCE NETWORK'}</span><h2>{mode === 'team' ? 'Which specialist contributed what' : 'Persisted handoffs and scientific provenance'}</h2><p>{handoffs.length} ordered handoffs · Atlas is the final orchestrator</p></div>{mode === 'trace' && <div><span className="osv2-legend-line base" /> Dataset evidence <span className="osv2-legend-line flow" /> Handoff</div>}</div>
      <div className="osv2-canvas">
        <svg viewBox="0 0 900 360" preserveAspectRatio="none" aria-hidden="true"><g className="osv2-base-paths"><path d="M450 170 L110 95" /><path d="M450 170 L220 285" /><path d="M450 170 L450 315" /><path d="M450 170 L680 285" /><path d="M450 170 L790 95" /></g><g className="osv2-flow-paths"><path className={selectedHandoff?.index === 0 ? 'active' : ''} d="M110 95 Q135 230 220 285" /><path className={selectedHandoff?.index === 1 ? 'active' : ''} d="M220 285 Q335 330 450 315" /><path className={selectedHandoff?.index === 2 ? 'active' : ''} d="M450 315 Q565 330 680 285" /><path className={selectedHandoff?.index === 3 ? 'active' : ''} d="M680 285 Q765 230 790 95" /><path className={selectedHandoff?.index === 4 ? 'active' : ''} d="M790 95 Q620 15 450 28" /></g></svg>
        <div className="osv2-core"><Database size={18} /><small>BUSINESS DATA</small><b>{contextName}</b><span>{contextRows.toLocaleString()} records</span></div>
        {specialists.map((specialist, index) => { const run = analysis?.agents.find((item) => item.agent_key === specialist.key); const active = selectedHandoff && [selectedHandoff.from.agent_key, selectedHandoff.to.agent_key].includes(specialist.key); return <button key={specialist.key} className={`osv2-agent osv2-agent-${index + 1} ${selectedKey === specialist.key ? 'selected' : ''} ${active ? 'handoff-active' : ''}`} onClick={() => { setSelectedKey(specialist.key); setSelectedHandoffId(null) }}><span className="osv2-avatar" style={{ '--agent-color': specialist.color } as CSSProperties}>{specialist.initials}</span><span><b>{specialist.name}</b><small>{specialist.role}</small><em className={`status-${run?.status ?? 'idle'}`}><i /> {runOutcome(specialist, run)}</em></span>{run?.status === 'completed' && <CheckCircle2 size={13} />}</button> })}
        <button className={`osv2-endpoint ${selectedHandoff?.to.agent_key === 'team_lead' ? 'handoff-active' : ''}`} onClick={() => handoffs.at(-1) && selectHandoff(handoffs.at(-1)!)}><span className="osv2-avatar" style={{ '--agent-color': atlas.color } as CSSProperties}>AT</span><span><small>FINAL ORCHESTRATOR</small><b>Atlas</b><em>{runOutcome(atlas, leadRun)}</em></span></button>
        {handoffs.map((handoff) => <button key={handoff.id} aria-label={`Open handoff from ${handoff.fromSpecialist.name} to ${handoff.toSpecialist.name}`} className={`osv2-handoff-marker marker-${handoff.index + 1} ${selectedHandoffId === handoff.id ? 'active' : ''}`} onClick={() => selectHandoff(handoff)}><ArrowRight size={10} /></button>)}
      </div>
      {selectedHandoff && <div className="osv2-handoff-inspector"><span className="osv2-trace-number">{String(selectedHandoff.index + 1).padStart(2, '0')}</span><div><small>EVIDENCE HANDOFF</small><h3>{selectedHandoff.fromSpecialist.name} → {selectedHandoff.toSpecialist.name}</h3><p>{selectedHandoff.summary}</p></div><div className="osv2-handoff-evidence">{selectedHandoff.evidence.slice(0, 3).map((item) => <span key={`${item.label}-${item.value}`}><small>{item.label}</small><b>{item.value}</b>{mode === 'trace' && <em>{item.source}</em>}</span>)}{!selectedHandoff.evidence.length && <span><small>PERSISTED OUTPUT</small><b>{selectedHandoff.summary}</b>{mode === 'trace' && <em>Specialist run</em>}</span>}</div>{mode === 'trace' && <aside><small>TRANSFERRED</small><b>{timestamp(selectedHandoff.timestamp)}</b><code>{selectedHandoff.from.id} → {selectedHandoff.to.id}</code></aside>}</div>}
    </section>

    {mode === 'team' ? <section className="panel v3-contribution"><header><span className="osv2-avatar large" style={{ '--agent-color': selectedSpecialist.color } as CSSProperties}>{selectedSpecialist.initials}</span><div><span>SPECIALIST CONTRIBUTION</span><h2>{selectedSpecialist.name} · {runOutcome(selectedSpecialist, selectedRun)}</h2></div><Link to={`/app/meetings?target=${selectedSpecialist.key}`}><MessageSquareText size={12} /> Ask {selectedSpecialist.name}</Link></header><div><span><small>What this specialist concluded</small><b>{selectedOutput.headline ?? 'Finding pending'}</b><p>{selectedOutput.recommendation ?? selectedOutput.summary ?? 'No persisted conclusion is available.'}</p></span><span><small>Evidence flow</small><b>{receivedHandoffs.length} received · {sentHandoffs.length} sent</b><p>Select a handoff in the network to inspect the transferred evidence.</p></span><span><small>Why it matters</small><b>{selectedSpecialist.completedOutcome}</b><p>{selectedSpecialist.method}.</p></span></div></section> : <section className="osv2-workspace">
      <article className="panel osv2-dossier"><header><span className="osv2-avatar large" style={{ '--agent-color': selectedSpecialist.color } as CSSProperties}>{selectedSpecialist.initials}</span><div><span>SPECIALIST DOSSIER</span><h2>{selectedSpecialist.name}</h2><p>{selectedSpecialist.role}</p></div><em className={`dossier-status status-${selectedRun?.status ?? 'idle'}`}><i /> {runOutcome(selectedSpecialist, selectedRun)}</em><Link to={`/app/meetings?target=${selectedSpecialist.key}`}><MessageSquareText size={13} /> Ask specialist</Link></header><div className="osv2-dossier-summary"><div><span>MISSION</span><p>{analysis?.mission ?? 'No mission deployed.'}</p></div><div><span>VERIFIED FINDING</span><h3>{selectedOutput.headline ?? runOutcome(selectedSpecialist, selectedRun)}</h3><p>{selectedOutput.summary ?? 'No structured finding persisted.'}</p></div></div><div className="osv2-dossier-grid"><section><header><FileCheck2 size={13} /><span>EVIDENCE & METRICS</span></header>{selectedOutput.evidence?.map((item) => <article key={`${item.label}-${item.value}`}><span>{item.label}</span><b>{item.value}</b><small>{item.source} · persisted evidence reference</small></article>)}{selectedOutput.metrics?.map((metric) => { const target = isUnvalidatedTarget(metric.label, metric.value); return <article key={`${metric.label}-${metric.value}`}><span>{target ? 'Target after enrichment' : metric.label}</span><b>{metric.value}</b><small>{target ? 'Status: Not validated · forecast improvement target' : `${metric.trend} · persisted specialist evidence`}</small></article>})}</section><section><header><Layers3 size={13} /><span>METHOD & ALTERNATIVES</span></header><article><span>Method</span><b>{selectedSpecialist.key === 'forecast_specialist' ? formatModel(strategy) : selectedSpecialist.method}</b><small>{selectedSpecialist.key === 'forecast_specialist' ? intelligence?.validation.method ?? 'Temporal validation' : 'Operating method'}</small></article>{alternatives.map((model) => <article key={model.key}><span>{model.name}</span><b>{modelMetric(model)}</b><small>{model.reason}</small></article>)}</section><section><header><ShieldAlert size={13} /><span>LIMITATIONS</span></header>{limitations.map((item) => <p className="osv2-limitation" key={item}><Info size={11} /> {item}</p>)}</section><section><header><GitBranch size={13} /><span>CUMULATIVE HANDOFFS</span></header><article><span>Received</span><b>{receivedHandoffs.map((item) => item.fromSpecialist.name).join(', ') || 'None'}</b><small>{receivedHandoffs.length} persisted transfers</small></article><article><span>Sent</span><b>{sentHandoffs.map((item) => item.toSpecialist.name).join(', ') || 'None'}</b><small>{sentHandoffs.length} persisted transfers</small></article></section></div><div className="osv2-run-provenance"><header><Code2 size={13} /><span>TECHNICAL PROVENANCE</span></header><div><span><small>Run ID</small><code>{selectedRun?.id ?? 'Unavailable'}</code></span><span><small>Response</small><code>{selectedRun?.openai_response_id ?? 'Unavailable'}</code></span><span><small>Started</small><b>{timestamp(selectedRun?.started_at)}</b></span><span><small>Completed</small><b>{timestamp(selectedRun?.completed_at)}</b></span><span><small>Runtime</small><b>{runtime(selectedRun?.started_at, selectedRun?.completed_at)}</b></span><span><small>Sequence</small><b>{selectedRun ? selectedRun.sequence + 1 : '—'}</b></span></div><p><b>Sanitized input envelope</b>{selectedRun?.input_summary ?? 'No persisted input summary.'}</p><p><b>Mission prompt</b>{analysis?.mission ?? 'No persisted mission.'}</p></div></article>
      <article className="panel osv2-reasoning-trace"><header><div><span>TEAM REASONING TRACE</span><h2>Evidence chain</h2><p>Validation → patterns → forecast → risk → strategy → Atlas.</p></div><Route size={18} /></header><div className="osv2-trace-list">{handoffs.map((handoff) => <button key={handoff.id} className={selectedHandoffId === handoff.id ? 'active' : ''} onClick={() => selectHandoff(handoff)}><span className="osv2-trace-number">{String(handoff.index + 1).padStart(2, '0')}</span><span className="osv2-trace-line"><i />{handoff.index < handoffs.length - 1 && <em />}</span><div><small>{handoff.fromSpecialist.completedOutcome.toUpperCase()}</small><b>{handoff.fromSpecialist.name} → {handoff.toSpecialist.name}</b><p>{handoff.summary}</p><span>{timestamp(handoff.timestamp)}</span><details onClick={(event) => event.stopPropagation()}><summary>Technical details <ChevronDown size={10} /></summary><code>source_run={handoff.from.id}</code><code>destination_run={handoff.to.id}</code><code>response={handoff.from.openai_response_id ?? 'unavailable'}</code><code>runtime={runtime(handoff.from.started_at, handoff.from.completed_at)}</code></details></div><ArrowRight size={12} /></button>)}{!handoffs.length && <div className="osv2-trace-empty"><Activity size={18} /><b>No handoffs persisted yet</b></div>}</div><footer><span><Check size={11} /> Atlas synthesis</span><b>{safeRecommendation}</b><small>{timestamp(leadRun?.completed_at)}</small></footer><p className="osv2-cumulative-note"><Info size={10} /> Each destination received the cumulative set of prior findings; the trace shows the primary ordered transition.</p></article>
    </section>}
  </>
}
