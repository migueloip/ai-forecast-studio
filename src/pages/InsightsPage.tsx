import { ArrowRight, Lightbulb, Search, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Analysis, Briefing, DatasetAnalytics } from '../api'
import { EmptyWorkspace } from '../components/EmptyWorkspace'
import { formatPercent } from '../format'

const icons = { growth: TrendingUp, risk: ShieldAlert, pattern: Search, opportunity: Lightbulb }

function deterministicInsights(analytics: DatasetAnalytics): Briefing['insights'] {
  const insights: Briefing['insights'] = []
  const revenue = analytics.metrics.revenue
  if (revenue.current !== null) insights.push({ title: `${revenue.column ?? 'Revenue'} moved ${revenue.changePercent === null ? 'in the latest period' : formatPercent(revenue.changePercent)}`, description: `The latest actual value is ${new Intl.NumberFormat('en').format(revenue.current)} from records stored in Neon.`, evidence: revenue.previous === null ? 'Only one comparable period is available.' : `Previous period: ${new Intl.NumberFormat('en').format(revenue.previous)}`, type: (revenue.changePercent ?? 0) >= 0 ? 'growth' : 'risk' })
  if (analytics.metrics.grossMarginPercent !== null) insights.push({ title: `Observed gross margin is ${formatPercent(analytics.metrics.grossMarginPercent, { sign: false })}`, description: 'Revenue minus cost across the complete uploaded dataset.', evidence: `Gross profit: ${new Intl.NumberFormat('en').format(analytics.metrics.grossProfit ?? 0)}`, type: analytics.metrics.grossMarginPercent >= 25 ? 'opportunity' : 'risk' })
  if (analytics.segments[0]) insights.push({ title: `${analytics.segments[0].label} is the leading segment`, description: `This segment contributes the largest share of ${analytics.primaryMetricColumn ?? 'the primary metric'}.`, evidence: `${formatPercent(analytics.segments[0].sharePercent, { sign: false })} of observed total`, type: 'pattern' })
  return insights
}

export function InsightsPage({ analysis, analytics }: { analysis: Analysis | null; analytics: DatasetAnalytics | null }) {
  if (!analytics) return <><header className="app-header"><div><span>EVIDENCE LIBRARY</span><h1>Insights</h1></div></header><EmptyWorkspace/></>
  const verified = Boolean(analysis?.briefing)
  const insights = analysis?.briefing?.insights?.length ? analysis.briefing.insights : deterministicInsights(analytics)
  const score = analytics.health.overall
  const healthComponents = [
    { label: 'Revenue health', component: analytics.health.components.revenue },
    { label: 'Forecast reliability', component: analytics.health.components.forecastReliability },
    { label: 'Demand stability', component: analytics.health.components.demandStability },
    { label: 'Inventory health', component: analytics.health.components.inventory },
    { label: 'Growth potential', component: analytics.health.components.growthPotential },
    { label: 'Data quality', component: analytics.health.components.dataQuality },
  ]
  return <>
    <header className="app-header"><div><span>EVIDENCE LIBRARY</span><h1>Insights</h1></div><Link className="button button-app" to={verified?'/app/meetings':'/onboarding'}><Sparkles size={14}/> {verified?'Ask team about findings':'Deploy AI analysis'}</Link></header>
    <section className="insights-intro"><div><span className="live-pill"><i/> {insights.length} {verified?'AI-VERIFIED':'DETERMINISTIC'} FINDINGS</span><h2>The signals supported by your data.</h2><p>{verified?'Specialists reviewed these findings against the persisted dataset.':'These findings are calculated directly from real Neon aggregates; AI review is still pending.'}</p></div><div className="insight-score"><strong>{score}</strong><span>{verified?'Business health':'Data readiness'}<br/>score</span></div></section>
    <section className="panel health-explanation"><header><div><span className="section-kicker">EXPLAINABLE SCORE</span><h2>How Business Health is calculated</h2><p>Available components are combined using the visible weights. Missing metrics remain N/A and their weight is redistributed rather than counted as zero.</p></div><strong className={`risk-${analytics.health.riskLevel.toLowerCase()}`}>{analytics.health.riskLevel} RISK</strong></header><div className="health-explanation-grid">{healthComponents.map(({ label, component }) => <article key={label}><div><span>{label}<small>{component.weight}% weight</small></span><b>{component.score === null ? 'N/A' : `${component.score}/100`}</b></div><i><span style={{ width: `${component.score ?? 0}%` }}/></i><p>{component.explanation}</p></article>)}</div></section>
    <section className="insight-grid">{insights.map((insight,index)=>{const Icon=icons[insight.type];return <article className={`panel insight-card insight-${insight.type}`} key={`${insight.title}-${index}`}><div className="insight-card-top"><span><Icon size={17}/></span><em>0{index+1}</em></div><small>{insight.type.toUpperCase()}</small><h3>{insight.title}</h3><p>{insight.description}</p><div className="evidence-row"><span>EVIDENCE</span><b>{insight.evidence}</b></div>{verified&&<Link to="/app/meetings">Ask the specialists <ArrowRight size={13}/></Link>}</article>})}</section>
  </>
}
