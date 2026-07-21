import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Gauge,
  Globe2,
  Lightbulb,
  Megaphone,
  PackageSearch,
  Play,
  Scale,
  ShieldAlert,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  UserPlus,
  Warehouse,
  XCircle,
  Zap,
} from 'lucide-react'
import { saveDecisionRecord, type Analysis, type ApiDataset, type DatasetAnalytics } from '../api'
import { BookmarkButton } from '../components/BookmarkButton'
import { EmptyWorkspace } from '../components/EmptyWorkspace'
import { safeErrorMessage } from '../errors'
import { formatPercent, metricChangeSentence } from '../format'
import {
  beginScenarioRecalculation,
  completeScenarioRecalculation,
  editScenarioDraft,
  failScenarioRecalculation,
  initialScenarioPresentationState,
} from '../scenarioHistory'

type ProposalKind = 'pricing' | 'marketing' | 'inventory' | 'store' | 'hiring' | 'capacity' | 'holiday' | 'market'
type RiskPolicy = 'conservative' | 'balanced' | 'aggressive'
type Verdict = 'approved' | 'rejected' | 'conditional' | 'requires_data'

interface ProposalTemplate {
  kind: ProposalKind
  label: string
  shortLabel: string
  icon: ComponentType<{ size?: number }>
  primaryLabel: string
  primaryUnit: '%' | 'units'
  primary: number
  demandChange: number
  incrementalCost: number
  inventoryChange: number
  capacityChange: number
}

interface ProposalDraft {
  kind: ProposalKind
  primary: number
  demandChange: number
  incrementalCost: number
  inventoryChange: number
  capacityChange: number
  baselineId: string
  riskPolicy: RiskPolicy
}

interface DecisionBaseline {
  id: string
  period: string
  source: 'actual' | 'forecast'
  revenue: number | null
  revenueLower: number | null
  revenueUpper: number | null
  demand: number | null
  cost: number | null
  inventory: number | null
  profit: number | null
}

interface DecisionEvaluation {
  verdict: Verdict
  verdictLabel: string
  verdictReason: string
  risk: 'LOW' | 'MEDIUM' | 'HIGH'
  impact: 'POSITIVE' | 'MIXED' | 'NEGATIVE'
  confidence: number
  baselineRevenue: number | null
  baselineDemand: number | null
  baselineCost: number | null
  baselineProfit: number | null
  projectedRevenue: number | null
  projectedRevenueLower: number | null
  projectedRevenueUpper: number | null
  projectedDemand: number | null
  projectedCost: number | null
  projectedProfit: number | null
  projectedProfitLower: number | null
  projectedInventory: number | null
  revenueChange: number | null
  demandChange: number
  profitChange: number | null
  inventoryChange: number
  score: {
    revenueImpact: number
    riskExposure: number
    operationalFeasibility: number
    forecastReliability: number
    growthPotential: number
    final: number
  }
  intervalRatio: number | null
  scenarioPenalty: number
  capacityGap: number
  costRatio: number
}

const templates: ProposalTemplate[] = [
  { kind: 'pricing', label: 'Change pricing', shortLabel: 'Pricing', icon: CircleDollarSign, primaryLabel: 'Price change', primaryUnit: '%', primary: 8, demandChange: -5, incrementalCost: 0, inventoryChange: 0, capacityChange: 0 },
  { kind: 'marketing', label: 'Increase marketing', shortLabel: 'Marketing', icon: Megaphone, primaryLabel: 'Spend increase', primaryUnit: 'units', primary: 50000, demandChange: 8, incrementalCost: 50000, inventoryChange: 0, capacityChange: 0 },
  { kind: 'inventory', label: 'Optimize inventory', shortLabel: 'Inventory', icon: PackageSearch, primaryLabel: 'Inventory change', primaryUnit: '%', primary: -15, demandChange: 0, incrementalCost: 0, inventoryChange: -15, capacityChange: 0 },
  { kind: 'store', label: 'Open a new store', shortLabel: 'New store', icon: Store, primaryLabel: 'Investment', primaryUnit: 'units', primary: 100000, demandChange: 10, incrementalCost: 100000, inventoryChange: 12, capacityChange: 15 },
  { kind: 'hiring', label: 'Hire more people', shortLabel: 'Hiring', icon: UserPlus, primaryLabel: 'People investment', primaryUnit: 'units', primary: 50000, demandChange: 3, incrementalCost: 50000, inventoryChange: 0, capacityChange: 10 },
  { kind: 'capacity', label: 'Increase capacity', shortLabel: 'Capacity', icon: Warehouse, primaryLabel: 'Capacity change', primaryUnit: '%', primary: 15, demandChange: 10, incrementalCost: 0, inventoryChange: 5, capacityChange: 15 },
  { kind: 'holiday', label: 'Prepare for holidays', shortLabel: 'Holiday', icon: CalendarRange, primaryLabel: 'Inventory preparation', primaryUnit: '%', primary: 20, demandChange: 18, incrementalCost: 0, inventoryChange: 20, capacityChange: 12 },
  { kind: 'market', label: 'Enter a new market', shortLabel: 'Expansion', icon: Globe2, primaryLabel: 'Market investment', primaryUnit: 'units', primary: 100000, demandChange: 12, incrementalCost: 100000, inventoryChange: 10, capacityChange: 12 },
]

const scoreWeights = {
  revenueImpact: 0.25,
  riskExposure: 0.25,
  operationalFeasibility: 0.2,
  forecastReliability: 0.2,
  growthPotential: 0.1,
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value))

function formatValue(value: number | null, compact = true) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0,
  }).format(value)
}

const decisionSectionOrder = ['proposal', 'review', 'briefing', 'consequences', 'score', 'confidence', 'risk', 'alternative', 'timeline'] as const

function sectionLabel(key: (typeof decisionSectionOrder)[number], title: string) {
  return `${String(decisionSectionOrder.indexOf(key) + 1).padStart(2, '0')} · ${title}`
}

function templateFor(kind: ProposalKind) {
  return templates.find((template) => template.kind === kind) ?? templates[0]!
}

function proposalFromTemplate(template: ProposalTemplate, baselineId = '', riskPolicy: RiskPolicy = 'balanced'): ProposalDraft {
  return {
    kind: template.kind,
    primary: template.primary,
    demandChange: template.demandChange,
    incrementalCost: template.incrementalCost,
    inventoryChange: template.inventoryChange,
    capacityChange: template.capacityChange,
    baselineId,
    riskPolicy,
  }
}

function buildBaselines(analytics: DatasetAnalytics): DecisionBaseline[] {
  const actuals = analytics.series
    .filter((point) => point.revenue !== null)
    .slice(-12)
    .map((point) => ({
      ...point,
      id: `actual:${point.period}`,
      source: 'actual' as const,
      revenueLower: point.revenue,
      revenueUpper: point.revenue,
    }))
  const forecasts = (analytics.forecasts.metrics.revenue?.points ?? []).map((point) => ({
    id: `forecast:${point.period}`,
    period: point.period,
    source: 'forecast' as const,
    revenue: point.value,
    revenueLower: point.lower,
    revenueUpper: point.upper,
    demand: analytics.forecasts.metrics.demand?.points.find((candidate) => candidate.period === point.period)?.value ?? null,
    cost: analytics.forecasts.metrics.cost?.points.find((candidate) => candidate.period === point.period)?.value ?? null,
    inventory: analytics.forecasts.metrics.inventory?.points.find((candidate) => candidate.period === point.period)?.value ?? null,
    profit: analytics.forecasts.metrics.profit?.points.find((candidate) => candidate.period === point.period)?.value ?? null,
  }))
  return [...forecasts, ...actuals]
}

function percentageChange(next: number | null, previous: number | null) {
  if (next === null || previous === null || Math.abs(previous) < 1e-9) return null
  return ((next - previous) / Math.abs(previous)) * 100
}

function evaluateDecision(analytics: DatasetAnalytics, proposal: ProposalDraft, baseline: DecisionBaseline | undefined): DecisionEvaluation {
  const baselineRevenue = baseline?.revenue ?? analytics.metrics.revenue.current
  const baselineDemand = baseline?.demand ?? analytics.metrics.demand.current
  const baselineCost = baseline?.cost ?? analytics.metrics.cost.current
  const explicitProfit = baseline?.profit ?? analytics.metrics.profit.current
  const baselineProfit = explicitProfit ?? (baselineRevenue !== null && baselineCost !== null ? baselineRevenue - baselineCost : null)
  const priceChange = proposal.kind === 'pricing' ? proposal.primary : 0
  const demandFactor = Math.max(0, 1 + proposal.demandChange / 100)
  const priceFactor = Math.max(0, 1 + priceChange / 100)
  const revenueFactor = demandFactor * priceFactor
  const projectedRevenue = baselineRevenue === null ? null : baselineRevenue * revenueFactor
  const projectedRevenueLower = baseline?.revenueLower === null || baseline?.revenueLower === undefined ? projectedRevenue : baseline.revenueLower * revenueFactor
  const projectedRevenueUpper = baseline?.revenueUpper === null || baseline?.revenueUpper === undefined ? projectedRevenue : baseline.revenueUpper * revenueFactor
  const projectedDemand = baselineDemand === null ? null : baselineDemand * demandFactor
  const variableCostDelta = baselineCost === null ? 0 : baselineCost * (demandFactor - 1)
  const projectedCost = baselineCost === null ? null : baselineCost + variableCostDelta + proposal.incrementalCost
  const projectedProfit = projectedRevenue !== null
    ? projectedCost !== null
      ? projectedRevenue - projectedCost
      : baselineProfit !== null && baselineRevenue !== null
        ? baselineProfit + (projectedRevenue - baselineRevenue) - proposal.incrementalCost
        : null
    : null
  const projectedProfitLower = projectedRevenueLower !== null
    ? projectedCost !== null
      ? projectedRevenueLower - projectedCost
      : baselineProfit !== null && baselineRevenue !== null
        ? baselineProfit + (projectedRevenueLower - baselineRevenue) - proposal.incrementalCost
        : null
    : null
  const baselineInventory = baseline?.inventory ?? analytics.metrics.inventory.current
  const projectedInventory = baselineInventory === null ? null : baselineInventory * Math.max(0, 1 + proposal.inventoryChange / 100)
  const revenueChange = percentageChange(projectedRevenue, baselineRevenue)
  const profitChange = percentageChange(projectedProfit, baselineProfit)
  const intervalRatio = projectedRevenue !== null && projectedRevenueLower !== null && projectedRevenueUpper !== null
    ? Math.abs(projectedRevenueUpper - projectedRevenueLower) / Math.max(Math.abs(projectedRevenue), 1)
    : null
  const costRatio = baselineRevenue === null ? 0 : Math.abs(proposal.incrementalCost) / Math.max(Math.abs(baselineRevenue), 1) * 100
  const capacityGap = Math.max(0, proposal.demandChange - proposal.capacityChange)
  const changeBurden = (Math.abs(proposal.inventoryChange) + Math.abs(proposal.capacityChange)) / 2
  const operationalFeasibility = Math.round(clamp(92 - capacityGap * 1.5 - changeBurden * 0.35 - costRatio * 0.5))
  const primaryMetric = analytics.forecasts.primaryMetric
  const primaryForecast = primaryMetric ? analytics.forecasts.metrics[primaryMetric] : null
  const baselineConfidence = baseline?.source === 'actual'
    ? analytics.source.completeness
    : primaryForecast?.confidence ?? analytics.health.components.forecastReliability.score ?? analytics.source.completeness
  const scenarioDistance = (Math.abs(priceChange) + Math.abs(proposal.demandChange) + Math.abs(proposal.inventoryChange) + Math.abs(proposal.capacityChange)) / 4
  const scenarioPenalty = Math.round(Math.min(25, scenarioDistance * 0.45 + costRatio * 0.25))
  const forecastReliability = Math.round(clamp(baselineConfidence - scenarioPenalty))
  const downsideLoss = projectedProfitLower !== null && projectedProfitLower < 0 ? 28 : 0
  const intervalPenalty = (intervalRatio ?? 0.35) * 100
  const riskExposure = Math.round(clamp(100 - intervalPenalty - downsideLoss - capacityGap * 1.2 - Math.min(20, costRatio * 0.3)))
  const revenueImpact = Math.round(clamp(50 + (revenueChange ?? 0) * 3))
  const growthBaseline = analytics.health.components.growthPotential.score ?? 50
  const growthPotential = Math.round(clamp(growthBaseline * 0.55 + clamp(50 + (revenueChange ?? 0) * 2) * 0.45))
  const final = Math.round(
    revenueImpact * scoreWeights.revenueImpact
    + riskExposure * scoreWeights.riskExposure
    + operationalFeasibility * scoreWeights.operationalFeasibility
    + forecastReliability * scoreWeights.forecastReliability
    + growthPotential * scoreWeights.growthPotential,
  )
  const confidence = Math.round(clamp(
    forecastReliability * 0.65
    + analytics.source.completeness * 0.2
    + operationalFeasibility * 0.15,
  ))
  const risk: DecisionEvaluation['risk'] = riskExposure < 45 ? 'HIGH' : riskExposure < 70 ? 'MEDIUM' : 'LOW'
  const impact: DecisionEvaluation['impact'] = (profitChange ?? revenueChange ?? 0) > 1 ? 'POSITIVE' : (profitChange ?? revenueChange ?? 0) < 0 ? 'NEGATIVE' : 'MIXED'
  const policyFloor = proposal.riskPolicy === 'conservative' ? 70 : proposal.riskPolicy === 'aggressive' ? 45 : 58
  let verdict: Verdict
  let verdictLabel: string
  let verdictReason: string
  if (baselineRevenue === null || confidence < 45) {
    verdict = 'requires_data'
    verdictLabel = 'REQUIRES MORE DATA'
    verdictReason = 'The available revenue baseline or decision confidence is not sufficient for an executive recommendation.'
  } else if (final < 50 || (projectedProfit !== null && projectedProfit < 0) || riskExposure < 35) {
    verdict = 'rejected'
    verdictLabel = 'NOT RECOMMENDED'
    verdictReason = projectedProfit !== null && projectedProfit < 0
      ? 'The expected case produces a negative modeled profit.'
      : 'The combined decision score does not compensate for the modeled exposure.'
  } else if (final >= 70 && riskExposure >= policyFloor && impact === 'POSITIVE') {
    verdict = 'approved'
    verdictLabel = 'RECOMMENDED'
    verdictReason = 'Expected value is positive and the modeled downside remains inside the selected risk policy.'
  } else {
    verdict = 'conditional'
    verdictLabel = risk === 'HIGH' ? 'CONDITIONALLY RECOMMENDED' : 'RECOMMENDED WITH SAFEGUARDS'
    verdictReason = riskExposure < policyFloor
      ? `The outcome is promising, but risk control is below the ${proposal.riskPolicy} policy threshold.`
      : 'The proposal is feasible, but its modeled impact is not yet strong enough for unconditional approval.'
  }
  return {
    verdict,
    verdictLabel,
    verdictReason,
    risk,
    impact,
    confidence,
    baselineRevenue,
    baselineDemand,
    baselineCost,
    baselineProfit,
    projectedRevenue,
    projectedRevenueLower,
    projectedRevenueUpper,
    projectedDemand,
    projectedCost,
    projectedProfit,
    projectedProfitLower,
    projectedInventory,
    revenueChange,
    demandChange: proposal.demandChange,
    profitChange,
    inventoryChange: proposal.inventoryChange,
    score: { revenueImpact, riskExposure, operationalFeasibility, forecastReliability, growthPotential, final },
    intervalRatio,
    scenarioPenalty,
    capacityGap,
    costRatio,
  }
}

function proposalStatement(proposal: ProposalDraft) {
  const magnitude = Math.abs(proposal.primary)
  switch (proposal.kind) {
    case 'pricing': return `${proposal.primary >= 0 ? 'Increase' : 'Reduce'} prices by ${magnitude}%`
    case 'marketing': return `Increase marketing investment by ${formatValue(magnitude, false)}`
    case 'inventory': return `${proposal.primary >= 0 ? 'Increase' : 'Reduce'} inventory by ${magnitude}%`
    case 'store': return `Open a new store with ${formatValue(magnitude)} investment`
    case 'hiring': return `Invest ${formatValue(magnitude)} in additional people`
    case 'capacity': return `Increase production capacity by ${magnitude}%`
    case 'holiday': return `Prepare ${magnitude}% more inventory for holiday demand`
    case 'market': return `Enter a new market with ${formatValue(magnitude)} investment`
  }
}

function scoreTone(score: number) {
  return score >= 70 ? 'good' : score >= 50 ? 'watch' : 'poor'
}

function makeAlternative(proposal: ProposalDraft, analytics: DatasetAnalytics, baseline: DecisionBaseline | undefined) {
  const candidates = [0.5, 0.625, 0.75].map((factor) => {
    const candidate: ProposalDraft = {
      ...proposal,
      primary: Number((proposal.primary * factor).toFixed(1)),
      demandChange: Number((proposal.demandChange * factor).toFixed(1)),
      incrementalCost: Number((proposal.incrementalCost * factor).toFixed(2)),
      inventoryChange: Number((proposal.inventoryChange * factor).toFixed(1)),
      capacityChange: Number((proposal.capacityChange * factor).toFixed(1)),
    }
    return { proposal: candidate, evaluation: evaluateDecision(analytics, candidate, baseline), factor }
  })
  return candidates.sort((a, b) => b.evaluation.score.final - a.evaluation.score.final)[0]!
}

function numberInput(value: number, onChange: (value: number) => void) {
  return (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    onChange(Number.isFinite(next) ? next : value)
  }
}

export function DecisionRoomPage({ analytics, dataset, analysis }: { analytics: DatasetAnalytics | null; dataset: ApiDataset | null; analysis: Analysis | null }) {
  const [draft, setDraft] = useState<ProposalDraft>(() => proposalFromTemplate(templates[0]!))
  const [applied, setApplied] = useState<ProposalDraft>(() => proposalFromTemplate(templates[0]!))
  const [scenarioState, setScenarioState] = useState(() => initialScenarioPresentationState<ProposalDraft, DecisionEvaluation>())
  const [highlighted, setHighlighted] = useState(false)
  const reviewTimer = useRef<number | null>(null)
  const highlightTimer = useRef<number | null>(null)
  const submissionInFlight = useRef(false)

  useEffect(() => () => {
    if (reviewTimer.current !== null) window.clearTimeout(reviewTimer.current)
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
  }, [])

  if (!analytics) {
    return <><header className="app-header"><div><span>AI EXECUTIVE TEAM</span><h1>Decision Room</h1></div></header><EmptyWorkspace title="A validated forecast baseline is required for executive review." /></>
  }

  const baselines = buildBaselines(analytics)
  const defaultBaseline = baselines.find((baseline) => baseline.source === 'forecast') ?? baselines[0]
  const draftBaselineId = draft.baselineId || defaultBaseline?.id || ''
  const appliedBaselineId = applied.baselineId || defaultBaseline?.id || ''
  const selectedBaseline = baselines.find((baseline) => baseline.id === appliedBaselineId) ?? defaultBaseline
  const preliminaryEvaluation = evaluateDecision(analytics, applied, selectedBaseline)
  const evaluation = scenarioState.current?.evaluation ?? preliminaryEvaluation
  const reviewing = scenarioState.recalculating
  const presented = scenarioState.current !== null
  const lastReviewed = scenarioState.current?.reviewedAt ?? ''
  const comparison = scenarioState.comparison
  const alternative = makeAlternative(applied, analytics, selectedBaseline)
  const activeTemplate = templateFor(draft.kind)
  const primaryMetric = analytics.forecasts.primaryMetric
  const primaryForecast = primaryMetric ? analytics.forecasts.metrics[primaryMetric] : null
  const primaryIntelligence = primaryMetric ? analytics.intelligence.forecasts[primaryMetric] : null
  const selectedModels = primaryIntelligence?.strategy.selectedModels ?? (primaryForecast?.model ? [primaryForecast.model] : [])
  const intervalMethod = primaryIntelligence?.strategy.intervalMethod ?? 'Validated forecast interval'
  const timelineSource = analytics.forecasts.metrics.revenue?.points ?? []
  const timelineIndexes = [0, 1, 2, 5].filter((index, position, values) => index < timelineSource.length && values.indexOf(index) === position)
  const baselineLabel = (baselineId: string) => {
    const baseline = baselines.find((candidate) => candidate.id === baselineId)
    return baseline ? `${baseline.period} ${baseline.source}` : baselineId
  }
  const priceFactor = applied.kind === 'pricing' ? 1 + applied.primary / 100 : 1
  const scenarioFactor = Math.max(0, 1 + applied.demandChange / 100) * Math.max(0, priceFactor)
  const teamReview = [
    {
      initials: 'AT', name: 'Atlas', role: 'Chief Data Scientist', tone: 'violet',
      text: selectedBaseline?.source === 'forecast'
        ? `The ${primaryForecast?.model ?? 'selected'} forecast for ${selectedBaseline.period} provides the validated baseline.`
        : `The actual period ${selectedBaseline?.period ?? 'selected'} provides the deterministic baseline.`,
      evidence: `${evaluation.score.forecastReliability}/100 reliability`,
    },
    {
      initials: 'MY', name: 'Maya', role: 'Forecast Specialist', tone: 'green',
      text: `The explicit ${formatPercent(applied.demandChange)} demand assumption produces ${formatPercent(evaluation.revenueChange)} modeled revenue impact.`,
      evidence: `${intervalMethod}`,
    },
    {
      initials: 'OW', name: 'Owen', role: 'Risk Analyst', tone: 'amber',
      text: evaluation.risk === 'HIGH'
        ? 'Downside exposure exceeds the current policy and needs a smaller commitment or stronger controls.'
        : `The forecast downside remains ${evaluation.risk.toLowerCase()} under the ${applied.riskPolicy} policy.`,
      evidence: `${evaluation.score.riskExposure}/100 risk control`,
    },
    {
      initials: 'AV', name: 'Ava', role: 'Strategy Lead', tone: 'blue',
      text: evaluation.verdict === 'approved'
        ? 'The proposal creates positive expected value without breaching the executive risk threshold.'
        : evaluation.verdictReason,
      evidence: `${evaluation.score.final}/100 decision score`,
    },
    {
      initials: 'NO', name: 'Noah', role: 'Business Analyst', tone: 'coral',
      text: evaluation.capacityGap > 0
        ? `Demand exceeds the stated capacity response by ${evaluation.capacityGap.toFixed(1)} points; execution must close that gap.`
        : 'The stated capacity response is sufficient for the expected demand change.',
      evidence: `${evaluation.score.operationalFeasibility}/100 feasibility`,
    },
  ]

  const presentProposal = () => {
    if (submissionInFlight.current || reviewing || !selectedBaseline) return
    submissionInFlight.current = true
    setScenarioState((current) => beginScenarioRecalculation(current))
    if (reviewTimer.current !== null) window.clearTimeout(reviewTimer.current)
    reviewTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const reviewed = { ...draft, baselineId: draftBaselineId }
          const reviewedBaseline = baselines.find((baseline) => baseline.id === draftBaselineId) ?? defaultBaseline
          const reviewedEvaluation = evaluateDecision(analytics, reviewed, reviewedBaseline)
          const reviewedAt = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
          if (dataset) await saveDecisionRecord({ datasetId: dataset.id, analysisId: analysis?.id, kind: reviewed.kind, title: proposalStatement(reviewed), verdict: reviewedEvaluation.verdictLabel, risk: reviewedEvaluation.risk, confidence: reviewedEvaluation.confidence, score: reviewedEvaluation.score.final, proposal: { ...reviewed }, result: { ...reviewedEvaluation } })
          setApplied(reviewed)
          setScenarioState((current) => completeScenarioRecalculation(current, reviewed, reviewedEvaluation, reviewedAt))
          setHighlighted(true)
          if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current)
          highlightTimer.current = window.setTimeout(() => setHighlighted(false), 1400)
        } catch (error) {
          setScenarioState((current) => failScenarioRecalculation(current, safeErrorMessage(error, 'The scenario could not be recalculated. Your previous successful result is still available.')))
        } finally {
          submissionInFlight.current = false
          reviewTimer.current = null
        }
      })()
    }, 950)
  }

  const selectProposal = (template: ProposalTemplate) => {
    if (reviewing) return
    setDraft(proposalFromTemplate(template, draftBaselineId, draft.riskPolicy))
    setScenarioState((current) => editScenarioDraft(current))
  }

  const updateDraft = <K extends keyof ProposalDraft>(key: K, value: ProposalDraft[K]) => {
    if (reviewing) return
    setDraft((current) => ({ ...current, [key]: value }))
    setScenarioState((current) => editScenarioDraft(current))
  }

  return <>
    <header className="app-header board-page-header">
      <div><span>AI EXECUTIVE TEAM</span><h1>Decision Room</h1></div>
      <div className="board-header-actions"><BookmarkButton datasetId={dataset?.id} resourceType="decision_simulation" resourceId={`${analysis?.id ?? dataset?.id ?? 'workspace'}:${applied.kind}`} title={proposalStatement(applied)} actionUrl="/app/simulator"/><div className="board-engine-seal"><ShieldAlert size={13} /><span><b>Deterministic engine</b><small>LLM interpretation only</small></span></div></div>
    </header>

    <section className="board-opening">
      <article className="panel board-proposal">
        <header>
          <div><span className="board-kicker">{sectionLabel('proposal', 'BUSINESS DECISION PROPOSAL')}</span><h2>Present a decision to your AI executive team.</h2><p>State the action and make every business assumption explicit before the review begins.</p></div>
          <span className="board-draft-state"><i /> {scenarioState.draftDirty && presented ? 'DRAFT CHANGES' : presented ? 'REVIEWED' : 'DRAFT'}</span>
        </header>
        <div className="board-proposal-types">
          {templates.map((template) => {
            const Icon = template.icon
            return <button key={template.kind} disabled={reviewing} className={draft.kind === template.kind ? 'active' : ''} onClick={() => selectProposal(template)}><Icon size={15} /><span>{template.shortLabel}</span></button>
          })}
        </div>
        <div className="board-statement"><Sparkles size={17} /><div><small>PROPOSAL BEFORE THE BOARD</small><strong>{proposalStatement(draft)}.</strong><p>Expected demand change: <b>{formatPercent(draft.demandChange)}</b></p></div></div>
        <div className="board-assumption-grid">
          <label><span>{activeTemplate.primaryLabel}</span><div><input disabled={reviewing} type="number" value={draft.primary} onChange={numberInput(draft.primary, (value) => updateDraft('primary', value))} /><em>{activeTemplate.primaryUnit === '%' ? '%' : 'units'}</em></div></label>
          <label><span>Expected demand change</span><div><input disabled={reviewing} type="number" value={draft.demandChange} onChange={numberInput(draft.demandChange, (value) => updateDraft('demandChange', value))} /><em>%</em></div></label>
          <label><span>Incremental cost</span><div><input disabled={reviewing} type="number" min="0" value={draft.incrementalCost} onChange={numberInput(draft.incrementalCost, (value) => updateDraft('incrementalCost', Math.max(0, value)))} /><em>units</em></div></label>
          <label><span>Inventory response</span><div><input disabled={reviewing} type="number" value={draft.inventoryChange} onChange={numberInput(draft.inventoryChange, (value) => updateDraft('inventoryChange', value))} /><em>%</em></div></label>
          <label><span>Capacity response</span><div><input disabled={reviewing} type="number" value={draft.capacityChange} onChange={numberInput(draft.capacityChange, (value) => updateDraft('capacityChange', value))} /><em>%</em></div></label>
          <label><span>Executive risk policy</span><span className="board-select"><select disabled={reviewing} value={draft.riskPolicy} onChange={(event) => updateDraft('riskPolicy', event.target.value as RiskPolicy)}><option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select><ChevronDown size={12} /></span></label>
        </div>
        <div className="board-baseline-row">
          <label><CalendarRange size={14} /><span><small>VALIDATED BASELINE</small><span className="board-select"><select disabled={reviewing} value={draftBaselineId} onChange={(event) => updateDraft('baselineId', event.target.value)}>{baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.period} · {baseline.source === 'forecast' ? 'forecast' : 'actual'} · {formatValue(baseline.revenue)}</option>)}</select><ChevronDown size={12} /></span></span></label>
          <button className="button button-app" disabled={reviewing || !baselines.length} onClick={presentProposal}>{reviewing ? <><span className="spinner" /> Recalculating scenario…</> : <><Play size={13} fill="currentColor" /> Present to AI Team</>}</button>
        </div>
        {scenarioState.error && <div className="auth-error board-recalculation-error" role="alert">{scenarioState.error}</div>}
      </article>

      <article className={`board-consensus verdict-${evaluation.verdict} ${reviewing ? 'is-reviewing' : ''} ${highlighted ? 'values-updated' : ''}`} aria-busy={reviewing}>
        <div className="board-consensus-grid" />
        <header><span><i /> {reviewing ? 'AI TEAM REVIEW IN PROGRESS' : presented ? 'TEAM CONSENSUS ACHIEVED' : 'PRELIMINARY BOARD REVIEW'}</span><small>{lastReviewed ? `Reviewed ${lastReviewed}` : 'Awaiting formal presentation'}</small></header>
        <div className="board-consensus-main">
          <span className="board-verdict-icon">{evaluation.verdict === 'approved' ? <CheckCircle2 /> : evaluation.verdict === 'rejected' ? <XCircle /> : <ShieldAlert />}</span>
          <small>EXECUTIVE DECISION</small>
          <h2>{reviewing ? 'REVIEWING PROPOSAL' : evaluation.verdictLabel}</h2>
          <p>{reviewing ? 'Atlas is validating the baseline while Maya, Owen, Ava, and Noah stress-test the business consequences.' : evaluation.verdictReason}</p>
        </div>
        <div className="board-consensus-metrics">
          <div><span>Confidence</span><b>{evaluation.confidence}%</b><small>{evaluation.confidence >= 75 ? 'Strong evidence' : evaluation.confidence >= 55 ? 'Moderate evidence' : 'More evidence needed'}</small></div>
          <div><span>Risk</span><b>{evaluation.risk}</b><small>{applied.riskPolicy} policy</small></div>
          <div><span>Business impact</span><b>{evaluation.impact}</b><small>{formatPercent(evaluation.profitChange ?? evaluation.revenueChange)}</small></div>
          <div><span>Decision score</span><b>{evaluation.score.final}/100</b><small>Reproducible score</small></div>
        </div>
        <footer><Check size={12} /><span>All displayed figures are computed from the selected forecast baseline and visible assumptions.</span></footer>
        {comparison&&!reviewing&&<div className="board-recalculation-delta" key={comparison.current.reviewedAt}>
          <span>SCENARIO COMPARISON · UPDATED {lastReviewed}</span>
          <div className="board-scenario-assumptions">
            <article><small>PREVIOUS SCENARIO</small><b>{proposalStatement(comparison.previous.proposal)}</b><p>Demand {formatPercent(comparison.previous.proposal.demandChange)} · Cost {formatValue(comparison.previous.proposal.incrementalCost)} · Inventory {formatPercent(comparison.previous.proposal.inventoryChange)} · Capacity {formatPercent(comparison.previous.proposal.capacityChange)} · {comparison.previous.proposal.riskPolicy} policy · Baseline {baselineLabel(comparison.previous.proposal.baselineId)}</p></article>
            <article><small>NEW SCENARIO</small><b>{proposalStatement(comparison.current.proposal)}</b><p>Demand {formatPercent(comparison.current.proposal.demandChange)} · Cost {formatValue(comparison.current.proposal.incrementalCost)} · Inventory {formatPercent(comparison.current.proposal.inventoryChange)} · Capacity {formatPercent(comparison.current.proposal.capacityChange)} · {comparison.current.proposal.riskPolicy} policy · Baseline {baselineLabel(comparison.current.proposal.baselineId)}</p></article>
          </div>
          <div className="board-scenario-results">
            <p><small>Revenue result</small><b>{formatPercent(comparison.previous.evaluation.revenueChange)} → {formatPercent(comparison.current.evaluation.revenueChange)}</b><em>Δ {formatPercent(comparison.revenueDelta)}</em></p>
            <p><small>Profit result</small><b>{formatPercent(comparison.previous.evaluation.profitChange)} → {formatPercent(comparison.current.evaluation.profitChange)}</b><em>Δ {formatPercent(comparison.previous.evaluation.profitChange === null || comparison.current.evaluation.profitChange === null ? null : comparison.current.evaluation.profitChange - comparison.previous.evaluation.profitChange)}</em></p>
            <p><small>Demand result</small><b>{formatPercent(comparison.previous.evaluation.demandChange)} → {formatPercent(comparison.current.evaluation.demandChange)}</b><em>Δ {formatPercent(comparison.current.evaluation.demandChange - comparison.previous.evaluation.demandChange)}</em></p>
            <p><small>Verdict</small><b>{comparison.previous.evaluation.verdictLabel} → {comparison.current.evaluation.verdictLabel}</b><em>{comparison.verdictChanged ? 'Changed' : 'Unchanged'}</em></p>
            <p><small>Risk</small><b>{comparison.previous.evaluation.risk} → {comparison.current.evaluation.risk}</b><em>{comparison.riskChanged ? 'Changed' : 'Unchanged'}</em></p>
            <p><small>Decision score</small><b>{comparison.previous.evaluation.score.final} → {comparison.current.evaluation.score.final}</b><em>Δ {comparison.decisionScoreDelta > 0 ? '+' : ''}{comparison.decisionScoreDelta}</em></p>
          </div>
        </div>}
      </article>
    </section>

    <section className="board-section-head"><div><span>{sectionLabel('review', 'AI TEAM REVIEW')}</span><h2>Five specialists. One accountable recommendation.</h2></div><Link to="/app/meetings">Challenge the team <ArrowRight size={13} /></Link></section>
    <section className={`board-team ${reviewing ? 'is-reviewing' : ''}`}>
      {teamReview.map((agent, index) => <article className="panel" key={agent.name} style={{ '--review-delay': `${index * 90}ms` } as React.CSSProperties}>
        <header><span className={`board-agent ${agent.tone}`}>{agent.initials}</span><div><b>{agent.name}</b><small>{agent.role}</small></div><em><i /> REVIEWED</em></header>
        <p>{agent.text}</p>
        <footer><span>{agent.evidence}</span><Check size={12} /></footer>
      </article>)}
    </section>

    <section className="panel board-briefing">
      <div className="board-briefing-mark"><BrainCircuit size={20} /></div>
      <div><span>{sectionLabel('briefing', 'EXECUTIVE BRIEFING')}</span><h2>{evaluation.verdict === 'approved' ? 'Recommended action' : evaluation.verdict === 'rejected' ? 'Board recommendation' : 'Recommended next step'}</h2><strong>{proposalStatement(applied)}.</strong><p>{metricChangeSentence('Revenue', evaluation.revenueChange)} {metricChangeSentence('Profit', evaluation.profitChange, 'cost data is missing')} {evaluation.verdictReason} Execute against the {selectedBaseline?.period ?? 'selected'} baseline and review results after the first operating period.</p></div>
      <aside><small>IMPLEMENTATION WINDOW</small><b>{evaluation.risk === 'LOW' ? 'Next operating period' : evaluation.risk === 'MEDIUM' ? 'Controlled pilot first' : 'Do not implement yet'}</b><span><Clock3 size={12} /> Reassess after period 1</span></aside>
    </section>

    <section className="board-impact-layout">
      <article className="panel board-impact">
        <header><div><span>{sectionLabel('consequences', 'BUSINESS CONSEQUENCES')}</span><h2>Expected case versus validated baseline</h2></div><BarChart3 size={18} /></header>
        <div className="board-impact-grid">
          <div><span>Revenue</span><strong>{formatPercent(evaluation.revenueChange)}</strong><small>{formatValue(evaluation.baselineRevenue)} → {formatValue(evaluation.projectedRevenue)}</small><i><span style={{ width: `${clamp(50 + (evaluation.revenueChange ?? 0) * 2)}%` }} /></i></div>
          <div><span>Demand</span><strong>{formatPercent(evaluation.demandChange)}</strong><small>{formatValue(evaluation.baselineDemand)} → {formatValue(evaluation.projectedDemand)}</small><i><span style={{ width: `${clamp(50 + evaluation.demandChange * 2)}%` }} /></i></div>
          <div><span>Profitability</span><strong>{formatPercent(evaluation.profitChange)}</strong><small>{formatValue(evaluation.baselineProfit)} → {formatValue(evaluation.projectedProfit)}</small><i><span style={{ width: `${clamp(50 + (evaluation.profitChange ?? 0) * 2)}%` }} /></i></div>
          <div><span>Inventory</span><strong>{formatPercent(evaluation.inventoryChange)}</strong><small>{formatValue(selectedBaseline?.inventory ?? analytics.metrics.inventory.current)} → {formatValue(evaluation.projectedInventory)}</small><i><span style={{ width: `${clamp(50 + evaluation.inventoryChange * 2)}%` }} /></i></div>
          <div><span>Operational load</span><strong>{formatPercent(applied.capacityChange)}</strong><small>{evaluation.capacityGap > 0 ? `${evaluation.capacityGap.toFixed(1)} point capacity gap` : 'Capacity covers demand assumption'}</small><i><span style={{ width: `${evaluation.score.operationalFeasibility}%` }} /></i></div>
          <div><span>Growth potential</span><strong>{evaluation.score.growthPotential}/100</strong><small>Health engine + scenario impact</small><i><span style={{ width: `${evaluation.score.growthPotential}%` }} /></i></div>
        </div>
        <footer><Scale size={13} /> Conditional calculation, not a causal claim: outcome = forecast baseline × visible price and demand assumptions − visible costs.</footer>
      </article>

      <article className="panel board-scorecard">
        <header><div><span>{sectionLabel('score', 'DECISION SCORE')}</span><h2>Board scorecard</h2></div><strong className={scoreTone(evaluation.score.final)}>{evaluation.score.final}<small>/100</small></strong></header>
        <div>
          {([
            ['Revenue impact', evaluation.score.revenueImpact, '25%'],
            ['Risk exposure', evaluation.score.riskExposure, '25%'],
            ['Operational feasibility', evaluation.score.operationalFeasibility, '20%'],
            ['Forecast reliability', evaluation.score.forecastReliability, '20%'],
            ['Growth potential', evaluation.score.growthPotential, '10%'],
          ] as const).map(([label, score, weight]) => <article key={label}><p><span>{label}</span><small>{label === 'Risk exposure' ? '100 = controlled' : `${weight} weight`}</small></p><b>{score}</b><i><span className={scoreTone(score)} style={{ width: `${score}%` }} /></i></article>)}
        </div>
        <footer><span>FINAL WEIGHTED SCORE</span><b>{evaluation.score.final}/100</b></footer>
      </article>
    </section>

    <section className="board-analysis-grid">
      <article className="panel board-confidence">
        <header><div><span>{sectionLabel('confidence', 'DECISION CONFIDENCE')}</span><h2>Why confidence is {evaluation.confidence >= 75 ? 'high' : evaluation.confidence >= 55 ? 'moderate' : 'limited'}</h2></div><Gauge size={19} /></header>
        <div className="board-confidence-score"><strong>{evaluation.confidence}%</strong><i><span style={{ width: `${evaluation.confidence}%` }} /></i><small>Decision confidence</small></div>
        <div className="board-confidence-parts">
          <article><span>Forecast reliability</span><b>{evaluation.score.forecastReliability}</b><small>65% of confidence</small></article>
          <article><span>Data completeness</span><b>{Math.round(analytics.source.completeness)}</b><small>20% of confidence</small></article>
          <article><span>Operational feasibility</span><b>{evaluation.score.operationalFeasibility}</b><small>15% of confidence</small></article>
        </div>
        <details><summary>Calculation and model evidence <ChevronDown size={12} /></summary><div><p><b>Models supporting the baseline</b>{selectedModels.length ? selectedModels.join(' + ') : primaryForecast?.model ?? 'No forecast model available'}</p><p><b>Validation</b>{primaryIntelligence?.validation.method ?? 'Temporal validation'} · {primaryIntelligence?.validation.folds ?? 0} folds · no random split</p><p><b>Scenario penalty</b>−{evaluation.scenarioPenalty} points for distance from observed history and incremental cost exposure.</p><p><b>Forecast intervals</b>{intervalMethod}; 95% baseline range propagated through the same deterministic scenario factors.</p></div></details>
      </article>

      <article className="panel board-risks">
        <header><div><span>{sectionLabel('risk', 'RISK ANALYSIS')}</span><h2>What could invalidate the decision</h2></div><ShieldAlert size={19} /></header>
        <div>
          <article><span className={`risk-signal ${evaluation.risk.toLowerCase()}`} /><p><b>Forecast uncertainty</b><small>{evaluation.intervalRatio === null ? 'No forecast interval is available.' : `The 95% range spans ${(evaluation.intervalRatio * 100).toFixed(1)}% of expected revenue.`}</small></p><strong>{evaluation.risk}</strong></article>
          <article><span className={`risk-signal ${evaluation.capacityGap > 0 ? 'medium' : 'low'}`} /><p><b>Operational constraint</b><small>{evaluation.capacityGap > 0 ? `Capacity trails expected demand by ${evaluation.capacityGap.toFixed(1)} points.` : 'The declared capacity response covers the demand assumption.'}</small></p><strong>{evaluation.capacityGap > 0 ? 'WATCH' : 'LOW'}</strong></article>
          <article><span className={`risk-signal ${evaluation.projectedProfitLower !== null && evaluation.projectedProfitLower < 0 ? 'high' : 'low'}`} /><p><b>Revenue downside</b><small>Modeled downside profit: {formatValue(evaluation.projectedProfitLower)}.</small></p><strong>{evaluation.projectedProfitLower !== null && evaluation.projectedProfitLower < 0 ? 'HIGH' : 'CONTROLLED'}</strong></article>
          <article><span className={`risk-signal ${Math.abs(applied.demandChange) > 15 ? 'medium' : 'low'}`} /><p><b>Market assumption</b><small>The {formatPercent(applied.demandChange)} demand response is an explicit business assumption, not generated by the LLM.</small></p><strong>{Math.abs(applied.demandChange) > 15 ? 'SENSITIVE' : 'VISIBLE'}</strong></article>
        </div>
      </article>
    </section>

    <section className="board-alternative-timeline">
      <article className="panel board-alternative">
        <header><div><span>{sectionLabel('alternative', 'ALTERNATIVE DECISION')}</span><h2>A lower-commitment option</h2></div><Lightbulb size={18} /></header>
        <div className="board-alternative-card">
          <span>AI TEAM ALTERNATIVE</span>
          <h3>{proposalStatement(alternative.proposal)}.</h3>
          <p>This variant scales the same visible assumptions to {Math.round(alternative.factor * 100)}% of the original commitment and is evaluated by the identical deterministic rules.</p>
          <div><span><small>Decision score</small><b>{alternative.evaluation.score.final}/100</b></span><span><small>Expected revenue</small><b>{formatPercent(alternative.evaluation.revenueChange)}</b></span><span><small>Risk</small><b>{alternative.evaluation.risk}</b></span></div>
        </div>
        <footer>{alternative.evaluation.score.final > evaluation.score.final ? <><TrendingUp size={13} /> Recommended because it improves the decision score by {alternative.evaluation.score.final - evaluation.score.final} points.</> : <><Target size={13} /> The original proposal retains the stronger score; use this alternative only to reduce commitment.</>}</footer>
      </article>

      <article className="panel board-timeline">
        <header><div><span>{sectionLabel('timeline', 'EXECUTIVE TIMELINE')}</span><h2>How the decision unfolds</h2></div><CalendarRange size={18} /></header>
        <div>
          {timelineIndexes.length ? timelineIndexes.map((index, position) => {
            const point = timelineSource[index]!
            const projected = point.value * scenarioFactor
            return <article key={point.period}><span><i />{position < timelineIndexes.length - 1 && <em />}</span><div><small>{index === 0 ? 'MONTH 1 / FIRST PERIOD' : index === 1 ? 'MONTH 2 / SECOND PERIOD' : index === 2 ? 'MONTH 3 / THIRD PERIOD' : 'MONTH 6 / OUTLOOK'}</small><b>{point.period}</b><p>Expected revenue {formatValue(projected)} · {formatPercent(percentageChange(projected, point.value))} versus the forecast baseline.</p></div><strong>{index === 0 ? 'PILOT' : index === timelineIndexes.at(-1) ? 'OUTLOOK' : 'MONITOR'}</strong></article>
          }) : <div className="board-no-timeline"><AlertTriangle size={16} /> Forecast horizon is unavailable; generate a validated forecast before scheduling execution.</div>}
        </div>
      </article>
    </section>

    <footer className="board-page-footer"><Zap size={14} /><p><b>Decision provenance preserved</b><span>Baseline: {selectedBaseline?.period ?? 'unavailable'} · Model: {primaryForecast?.model ?? 'unavailable'} · Engine: {analytics.intelligence.engineVersion}</span></p><Link to="/app/forecasts">Inspect forecast evidence <ArrowRight size={12} /></Link></footer>
  </>
}
