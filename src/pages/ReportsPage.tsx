import { Check, Copy, Download, ExternalLink, FileText, Link2, Printer, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { createShareLink, getExportBundle, type Analysis, type ApiDataset, type DatasetAnalytics } from '../api'
import { BookmarkButton } from '../components/BookmarkButton'
import { EmptyWorkspace } from '../components/EmptyWorkspace'
import { safeErrorMessage } from '../errors'
import { formatPercent, frequencyLabel } from '../format'

function value(number: number | null) {
  return number === null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number)
}

export function ReportsPage({ analysis, dataset, analytics }: { analysis: Analysis | null; dataset: ApiDataset | null; analytics: DatasetAnalytics | null }) {
  const briefing = analysis?.briefing
  const [format, setFormat] = useState<'pdf'|'csv'|'markdown'|'json'|'pptx'>('pdf')
  const [reportType, setReportType] = useState('executive_brief')
  const [sharing, setSharing] = useState(false)
  const [shareState, setShareState] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState('')
  const downloadBlob = (content: BlobPart, mime: string, extension: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `forecast-studio-executive-briefing.${extension}`
    link.click()
    URL.revokeObjectURL(url)
  }
  const download = async () => {
    if (!dataset || !analytics) return
    try {
      setError('')
      if (format === 'pdf') { window.print(); return }
      const bundle = (await getExportBundle(reportType)).bundle
      const payload = { generatedAt: new Date().toISOString(), reportType, dataset, analytics, analysis, workspaceEvidence: bundle }
    if (format === 'json') { downloadBlob(JSON.stringify(payload,null,2),'application/json','json'); return }
    if (format === 'csv') {
      const rows = [['Metric','Value'],['Business Health',analytics.health.overall],['Risk Level',analytics.health.riskLevel],['Forecast Confidence',briefing?.forecastConfidence ?? ''],['Revenue',analytics.metrics.revenue.current ?? ''],['Demand',analytics.metrics.demand.current ?? ''],['Inventory',analytics.metrics.inventory.current ?? ''],['Recommendation',briefing?.recommendation.action ?? '']]
      downloadBlob(rows.map((row)=>row.map((cell)=>`"${String(cell).replaceAll('"','""')}"`).join(',')).join('\n'),'text/csv','csv'); return
    }
    if (format === 'markdown') {
      downloadBlob(`# ${briefing?.headline ?? 'Executive Business Brief'}\n\nReport type: ${reportType.replaceAll('_',' ')}\n\n${briefing?.executiveSummary ?? `Analysis of ${dataset.filename}.`}\n\n## Evidence\n\n- Business Health: ${analytics.health.overall}/100\n- Risk: ${analytics.health.riskLevel}\n- Forecast Confidence: ${briefing?.forecastConfidence ?? 'Unavailable'}%\n\n## Recommended action\n\n${briefing?.recommendation.action ?? 'Deploy the AI Team to create an executive recommendation.'}\n\n## Persisted workspace evidence\n\n\`\`\`json\n${JSON.stringify(bundle,null,2)}\n\`\`\`\n`,'text/markdown','md'); return
    }
    const { default: PptxGenJS } = await import('pptxgenjs')
    const deck = new PptxGenJS()
    deck.layout = 'LAYOUT_WIDE'
    deck.author = 'AI Forecast Studio'
    deck.subject = 'Executive Forecast Brief'
    const cover = deck.addSlide(); cover.background = { color: '17241F' }; cover.addText('AI Forecast Studio',{x:.7,y:.6,w:5,h:.3,fontSize:12,color:'8FB5A3',bold:true}); cover.addText(briefing?.headline ?? 'Executive Business Brief',{x:.7,y:1.45,w:11.5,h:1.2,fontSize:28,color:'F2F6F3',bold:true,breakLine:false}); cover.addText(briefing?.executiveSummary ?? `Analysis of ${dataset.filename}.`,{x:.7,y:2.9,w:10.8,h:1,fontSize:14,color:'A9B8B0'}); cover.addText(`Business Health ${analytics.health.overall}/100  ·  Risk ${analytics.health.riskLevel}  ·  Confidence ${briefing?.forecastConfidence ?? '—'}%`,{x:.7,y:5.8,w:11,h:.5,fontSize:16,color:'DCE7E1'})
    const decision = deck.addSlide(); decision.addText('Executive Recommendation',{x:.7,y:.6,w:8,h:.5,fontSize:24,color:'24372E',bold:true}); decision.addText(briefing?.recommendation.action ?? 'A recommendation is not available yet.',{x:.7,y:1.5,w:11.5,h:1,fontSize:22,color:'315D48',bold:true}); decision.addText(briefing?.recommendation.expectedImpact ?? 'Run the AI Team analysis to generate validated business implications.',{x:.7,y:2.8,w:11,h:1,fontSize:15,color:'5F6E67'}); decision.addText(`Primary risk: ${briefing?.primaryRisk.title ?? analytics.health.riskLevel}`,{x:.7,y:4.3,w:11,h:.5,fontSize:16,color:'8E5E49'}); decision.addText('Generated from persisted analytics. Review before material decisions.',{x:.7,y:6.7,w:11,h:.25,fontSize:9,color:'8C9691'})
      await deck.writeFile({ fileName: 'forecast-studio-executive-briefing.pptx' })
    } catch (cause) {
      setError(safeErrorMessage(cause, 'The report could not be exported.'))
    }
  }
  const copyShareUrl = async (url = shareUrl) => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setShareState('Link created and copied')
    } catch {
      setShareState('Share link created. Copy it manually below.')
    }
  }
  const share = async () => {
    if (!analysis) { setError('Complete an AI Team analysis before generating a public report.'); return }
    try {
      setSharing(true); setError('')
      const result=await createShareLink(analysis.id,reportType)
      const url=`${window.location.origin}/shared/${result.share.token}`
      setShareUrl(url)
      await copyShareUrl(url)
    } catch(cause) {
      setShareUrl('')
      setShareState('')
      setError(safeErrorMessage(cause,'The share link could not be generated.'))
    } finally { setSharing(false) }
  }
  if (!dataset || !analytics) return <><header className="app-header"><div><span>STAKEHOLDER BRIEFINGS</span><h1>Reports</h1></div></header><EmptyWorkspace title="Connect data to generate a stakeholder report."/></>
  const observedChange = analytics.metrics.revenue.changePercent ?? analytics.metrics.demand.changePercent
  const reportedChange = briefing?.revenueForecast.changePercent ?? observedChange
  const reportedConfidence = briefing?.forecastConfidence ?? null
  const revenueForecast = analytics.forecasts.metrics.revenue
  const forecastPoints = revenueForecast?.points ?? []
  const pathStart = forecastPoints[0]?.value
  const pathEnd = forecastPoints.at(-1)?.value
  const pathChange = pathStart && pathEnd !== undefined ? ((pathEnd - pathStart) / Math.abs(pathStart)) * 100 : null
  return <>
    <header className="app-header"><div><span>STAKEHOLDER BRIEFINGS</span><h1>Reports</h1></div><div className="report-actions"><BookmarkButton datasetId={dataset.id} resourceType="executive_report" resourceId={analysis?.id ?? dataset.id} title={briefing?.headline ?? `${dataset.filename} report`} actionUrl="/app/reports"/><select aria-label="Report type" value={reportType} onChange={(event)=>{setReportType(event.target.value);setShareState('');setShareUrl('')}}><option value="executive_brief">Executive Brief</option><option value="forecast_report">Forecast Report</option><option value="team_meetings">Team Meetings</option><option value="decision_room">Decision Room</option><option value="risk_report">Risk Report</option><option value="recommendations">Recommendations</option><option value="business_health">Business Health</option><option value="comparative_analysis">Comparative Analysis</option><option value="all">Complete Workspace</option></select><button className="button button-outline" onClick={()=>window.print()}><Printer size={14}/> Print</button><select aria-label="Export format" value={format} onChange={(event)=>setFormat(event.target.value as typeof format)}><option value="pdf">Print / Save as PDF</option><option value="csv">CSV</option><option value="markdown">Markdown</option><option value="json">JSON</option><option value="pptx">PowerPoint</option></select><button className="button button-app" onClick={()=>{void download()}}><Download size={14}/> {format==='pdf'?'Print / Save as PDF':'Export'}</button><button className="button button-outline" disabled={sharing} onClick={()=>{void share()}}>{shareState?<Check size={14}/>:<Link2 size={14}/>} {sharing?'Sharing...':shareUrl?'Regenerate link':'Share'}</button></div></header>
    {error&&<p className="report-action-error">{error}</p>}
    {shareUrl&&<section className="share-link-result"><div><Check size={14}/><span><b>{shareState}</b><small>The public report was generated successfully.</small></span></div><label><span>Public URL</span><input readOnly value={shareUrl} onFocus={(event)=>event.currentTarget.select()}/></label><button onClick={()=>{void copyShareUrl()}}><Copy size={13}/> Copy</button><a href={shareUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open public page</a></section>}
    <section className="report-page panel">
      <header className="report-cover"><div><span className="report-logo"><FileText size={18}/></span><b>AI Forecast Studio</b></div><span>{briefing?'EXECUTIVE AI DECISION BRIEF':'DETERMINISTIC DATA BRIEF'} · {new Intl.DateTimeFormat('en',{month:'long',day:'numeric',year:'numeric'}).format(new Date())}</span><h2>{briefing?.headline ?? `${dataset.filename}: the latest actual business snapshot.`}</h2><p>{briefing?.executiveSummary ?? `This report summarizes ${analytics.source.rowCount.toLocaleString()} source records across ${frequencyLabel(analytics.source.frequency,analytics.source.periods)}. AI risks and recommendations will appear after a completed specialist analysis.`}</p></header>
      <div className="report-score-row"><div><span>EXPLAINABLE BUSINESS HEALTH</span><b>{analytics.health.overall}<small>/100</small></b></div><div><span>{briefing?'FORECAST CONFIDENCE':'HISTORICAL PERIODS'}</span><b>{briefing ? formatPercent(reportedConfidence,{sign:false,unavailable:'N/A'}) : analytics.source.periods}</b></div><div><span>{briefing?'REVENUE OUTLOOK':'OBSERVED CHANGE'}</span><b>{formatPercent(reportedChange)}<small>{reportedChange === null ? 'baseline unavailable' : 'vs latest actual'}</small></b></div></div>
      {revenueForecast&&<div className="report-forecast-baseline"><span>Forecast path: <b>{pathChange === null || Math.abs(pathChange) < 1 ? 'approximately flat' : `${formatPercent(pathChange)} across the horizon`}</b></span><span>Expected endpoint: <b>{value(pathEnd ?? null)}</b></span><span>Baseline: <b>latest actual → modeled endpoint</b></span></div>}
      <div className="report-columns"><section><span>{briefing?'PRIORITY RISK':'LATEST ACTUALS'}</span><h3>{briefing?.primaryRisk.title ?? `${analytics.metrics.revenue.column ?? 'Revenue'} ${value(analytics.metrics.revenue.current)} · ${analytics.metrics.demand.column ?? 'Demand'} ${value(analytics.metrics.demand.current)}`}</h3><p>{briefing ? <>Severity: <b>{briefing.primaryRisk.severity}</b> · Timing: <b>{briefing.primaryRisk.estimatedTiming}</b></> : <>Gross margin: <b>{formatPercent(analytics.metrics.grossMarginPercent,{sign:false,unavailable:'Unavailable'})}</b> · Closing inventory: <b>{value(analytics.metrics.inventory.current)}</b></>}</p></section><section><span>{briefing?'RECOMMENDED DECISION':'DATA COVERAGE'}</span><h3>{briefing?.recommendation.action ?? `${formatPercent(analytics.source.completeness,{sign:false})} complete across ${analytics.source.periods} periods`}</h3><p>{briefing ? <>{briefing.recommendation.expectedImpact} · {formatPercent(briefing.recommendation.confidence,{sign:false})} confidence</> : <>Source: {dataset.filename} · {dataset.row_count.toLocaleString()} rows</>}</p></section></div>
      <div className="report-findings"><span>{briefing?'KEY FINDINGS':'TOP SEGMENTS'}</span>{briefing?.insights.slice(0,4).map((insight,index)=><div key={insight.title}><em>0{index+1}</em><p><b>{insight.title}</b><span>{insight.description}</span></p><small>{insight.evidence}</small></div>)}{!briefing&&analytics.segments.slice(0,4).map((segment,index)=><div key={segment.label}><em>0{index+1}</em><p><b>{segment.label}</b><span>{formatPercent(segment.sharePercent,{sign:false})} of {analytics.primaryMetricColumn ?? 'primary metric'}</span></p><small>{value(segment.value)}</small></div>)}{!briefing&&!analytics.segments.length&&<div><em>01</em><p><b>No segment dimension detected</b><span>The report still uses the real aggregate metrics above.</span></p><small>Source verified</small></div>}</div>
      <footer className="report-footer"><ShieldCheck size={14}/> Generated from {dataset.filename} in your private Neon workspace · AI outputs should be reviewed before material decisions.</footer>
    </section>
  </>
}
