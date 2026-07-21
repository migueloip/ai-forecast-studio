import { FileText, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicReport } from '../api'
import { safeErrorMessage } from '../errors'
import { formatPercent } from '../format'

export function SharedReportPage() {
  const { token = '' } = useParams()
  const [report, setReport] = useState<{ title: string; snapshot: Record<string, unknown>; expires_at: string | null } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    getPublicReport(token).then((result) => { if (active) setReport(result.report) }).catch((cause) => { if (active) setError(safeErrorMessage(cause, 'This shared report is unavailable or has expired.')) })
    return () => { active = false }
  }, [token])
  if (error) return <main className="shared-report-state"><FileText size={25}/><h1>Report unavailable</h1><p>{error}</p></main>
  if (!report) return <main className="shared-report-state"><span className="spinner"/>Opening executive report...</main>
  const analysis = report.snapshot.analysis && typeof report.snapshot.analysis === 'object' ? report.snapshot.analysis as Record<string, unknown> : {}
  const briefing = analysis.briefing && typeof analysis.briefing === 'object' ? analysis.briefing as Record<string, unknown> : {}
  const analytics = report.snapshot.analytics && typeof report.snapshot.analytics === 'object' ? report.snapshot.analytics as Record<string, unknown> : {}
  const health = analytics.health && typeof analytics.health === 'object' ? analytics.health as Record<string, unknown> : {}
  const confidence = typeof briefing.forecastConfidence === 'number' ? briefing.forecastConfidence : null
  return <main className="shared-report-page"><header><span><FileText size={18}/> AI Forecast Studio</span><em>SHARED EXECUTIVE REPORT</em></header><section><span>{report.title}</span><h1>{String(briefing.headline ?? 'Executive business briefing')}</h1><p>{String(briefing.executiveSummary ?? 'This report contains a persisted executive analysis snapshot.')}</p><div><article><small>Business Health</small><b>{String(health.overall ?? '—')}<em>/100</em></b></article><article><small>Forecast Confidence</small><b>{formatPercent(confidence,{sign:false})}</b></article><article><small>Status</small><b>{String(analysis.status ?? 'Shared')}</b></article></div></section><footer><ShieldCheck size={13}/> Read-only snapshot · expires {report.expires_at ? new Intl.DateTimeFormat('en',{dateStyle:'medium'}).format(new Date(report.expires_at)) : 'when revoked'}</footer></main>
}
