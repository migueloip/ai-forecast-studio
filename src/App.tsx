import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useOutletContext } from 'react-router-dom'
import { archiveDataset, createSampleDataset, deleteDataset, getAnalysis, getDataset, getDatasetAnalytics, getLatestAnalysis, getLatestDataset, getLatestDatasetAnalytics, getTeamConversationContext, ingestDataset, listAnalysisContexts, listDatasets, renameDataset, retryAnalysis, startAnalysis, updateDatasetMapping, type Analysis, type AnalysisContextSummary, type ApiDataset, type Briefing, type ColumnProfile, type DatasetAnalytics, type DatasetHistoryItem, type ForecastMetricKey } from './api'
import { ProtectedRoute, useAuth } from './auth'
import { EmptyWorkspace } from './components/EmptyWorkspace'
import { ForecastChart } from './components/ForecastChart'
import { NotificationCenter } from './components/NotificationCenter'
import { ExecutiveSearch } from './components/ExecutiveSearch'
import { safeErrorMessage } from './errors'
import { formatPercent, frequencyLabel } from './format'
import { resolveMeetingWorkspaceContext } from './meetingDeepLink'
import { LoginPage } from './pages/LoginPage'
import { DecisionRoomPage } from './pages/DecisionRoomPage'
import { ForecastsPage } from './pages/ForecastsPage'
import { InsightsPage } from './pages/InsightsPage'
import { MeetingsPage } from './pages/MeetingsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TeamOSPage } from './pages/TeamOSPage'
import { SharedReportPage } from './pages/SharedReportPage'
import {
  Activity,
  Archive,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CloudUpload,
  Database,
  FileText,
  FileSpreadsheet,
  Gauge,
  Home,
  Languages,
  LogOut,
  Menu,
  MessageSquareText,
  PackageSearch,
  PanelLeftClose,
  Play,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  WandSparkles,
  UserRound,
  X,
} from 'lucide-react'

type AppSection = 'AI Team OS' | 'Forecast Intelligence' | 'Decision Room' | 'Team Meetings' | 'Insights' | 'Reports'

const agents = [
  { key: 'data_engineer', initials: 'DE', name: 'Elena', role: 'Data Engineer', color: '#7b6cf6', status: 'Data validated', detail: 'Schema, completeness, and coverage reviewed' },
  { key: 'data_scientist', initials: 'DS', name: 'Noah', role: 'Data Scientist', color: '#ee7c58', status: 'Patterns detected', detail: 'Trends, seasonality, and anomalies investigated' },
  { key: 'forecast_specialist', initials: 'FS', name: 'Maya', role: 'Forecast Specialist', color: '#31a97a', status: 'Forecast ready', detail: 'Forward outlook and uncertainty quantified' },
  { key: 'risk_analyst', initials: 'RA', name: 'Owen', role: 'Risk Analyst', color: '#dc9f35', status: 'Risk assessed', detail: 'Downside exposure and urgency stress-tested' },
  { key: 'strategy_lead', initials: 'RS', name: 'Ava', role: 'Strategy Lead', color: '#4289e8', status: 'Action proposed', detail: 'Evidence converted into a practical decision' },
]

const navItems: { label: AppSection; icon: typeof Home; path: string }[] = [
  { label: 'AI Team OS', icon: Home, path: '/app' },
  { label: 'Forecast Intelligence', icon: TrendingUp, path: '/app/forecasts' },
  { label: 'Decision Room', icon: Target, path: '/app/simulator' },
  { label: 'Team Meetings', icon: MessageSquareText, path: '/app/meetings' },
  { label: 'Insights', icon: Sparkles, path: '/app/insights' },
  { label: 'Reports', icon: FileText, path: '/app/reports' },
]

const sectionPaths = Object.fromEntries(navItems.map((item) => [item.label, item.path])) as Record<AppSection, string>

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <button className={`logo ${dark ? 'logo-dark' : ''}`} aria-label="AI Forecast Studio home">
      <span className="logo-mark"><span /><span /><span /></span>
      <span>Forecast<span className="logo-muted">Studio</span></span>
    </button>
  )
}

function MiniForecast({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={`forecast-svg ${compact ? 'forecast-compact' : ''}`} viewBox="0 0 760 260" role="img" aria-label="Revenue forecast rising over the next 12 weeks">
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4e7f6b" stopOpacity=".2" />
          <stop offset="100%" stopColor="#4e7f6b" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8eb29f" stopOpacity="0" />
          <stop offset="100%" stopColor="#8eb29f" stopOpacity=".22" />
        </linearGradient>
      </defs>
      {[45, 95, 145, 195, 245].map((y) => <line key={y} x1="32" x2="738" y1={y} y2={y} className="chart-grid" />)}
      <path d="M32,212 C68,203 86,188 118,194 S172,172 202,180 S254,142 287,154 S340,127 370,137 L370,254 L32,254 Z" fill="url(#area)" />
      <path d="M370,137 C414,144 438,106 471,119 S532,74 563,92 S620,60 652,67 S702,33 738,41 L738,88 C698,78 672,113 638,104 S583,134 552,126 S497,159 461,151 S412,173 370,164 Z" fill="url(#band)" />
      <path d="M32,212 C68,203 86,188 118,194 S172,172 202,180 S254,142 287,154 S340,127 370,137" className="chart-line chart-history" />
      <path d="M370,137 C414,144 438,106 471,119 S532,74 563,92 S620,60 652,67 S702,33 738,41" className="chart-line chart-future" />
      <line x1="370" x2="370" y1="20" y2="245" className="chart-today" />
      {!compact && <>
        <text x="343" y="18" className="chart-label">TODAY</text>
        <circle cx="738" cy="41" r="5" className="chart-dot" />
        <g className="chart-tooltip" transform="translate(590 12)">
          <rect width="120" height="40" rx="10" />
          <text x="12" y="17">Projected</text><text x="12" y="32">$528,400</text>
        </g>
      </>}
    </svg>
  )
}

function AgentAvatar({ agent, size = 'medium', pulse = false }: { agent: typeof agents[number]; size?: 'small' | 'medium' | 'large'; pulse?: boolean }) {
  return (
    <span className={`agent-avatar avatar-${size} ${pulse ? 'agent-pulse' : ''}`} style={{ '--agent-color': agent.color } as React.CSSProperties}>
      {agent.initials}
    </span>
  )
}

function Landing({ enterApp, startOnboarding }: { enterApp: () => void; startOnboarding: () => void }) {
  const [mobileMenu, setMobileMenu] = useState(false)
  const [liveStep, setLiveStep] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setLiveStep((step) => (step + 1) % agents.length), 2300)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="landing-page">
      <nav className="landing-nav shell">
        <Logo />
        <div className="nav-links">
          <a href="#product">Product</a><a href="#team">AI Team</a><a href="#simulator">Decision Room</a><a href="#security">Security</a>
        </div>
        <div className="nav-actions">
          <button className="text-button" onClick={enterApp}>Sign in</button>
          <button className="button button-small button-dark" onClick={startOnboarding}>Deploy your team <ArrowRight size={15} /></button>
        </div>
        <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle menu">{mobileMenu ? <X /> : <Menu />}</button>
        {mobileMenu && <div className="mobile-popover"><a href="#product">Product</a><a href="#team">AI Team</a><a href="#simulator">Decision Room</a><button onClick={startOnboarding}>Launch studio</button></div>}
      </nav>

      <main>
        <section className="hero shell">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> AI-powered decision intelligence</div>
            <h1>Your business has data.<br /><em>Now it has a team.</em></h1>
            <p>Deploy specialized AI agents that prepare your data, forecast demand, identify risks, and recommend what to do next.</p>
            <div className="hero-actions">
              <button className="button button-dark" onClick={startOnboarding}>Deploy your AI Team <ArrowRight size={17} /></button>
              <button className="button button-ghost" onClick={startOnboarding}><Play size={15} fill="currentColor" /> See it in action</button>
            </div>
            <div className="hero-proof"><div className="proof-avatars">{agents.slice(0, 4).map((a) => <AgentAvatar key={a.name} agent={a} size="small" />)}</div><span>From raw data to a clear decision in minutes.</span></div>
          </div>

          <div className="team-stage" aria-label="AI agents collaborating on a business forecast">
            <div className="stage-glow" />
            <div className="stage-topbar"><span><i /> AI Team live</span><span>5 agents</span></div>
            <div className="stage-center">
              <div className="data-core"><Sparkles size={20} /><strong>Q4 Sales</strong><span>24,890 records</span></div>
              <svg className="agent-lines" viewBox="0 0 600 420" preserveAspectRatio="none">
                <path d="M300 210 L105 92" /><path d="M300 210 L495 92" /><path d="M300 210 L72 306" /><path d="M300 210 L300 365" /><path d="M300 210 L528 306" />
              </svg>
              {agents.map((agent, index) => (
                <div key={agent.name} className={`stage-agent stage-agent-${index + 1} ${liveStep === index ? 'active' : ''}`}>
                  <AgentAvatar agent={agent} size="medium" pulse={liveStep === index} />
                  <div><strong>{agent.role}</strong><span>{liveStep === index ? agent.status : agent.name}</span></div>
                  {liveStep === index && <i className="status-check"><Check size={10} strokeWidth={3} /></i>}
                </div>
              ))}
              <div className="stage-message"><span className="tiny-agent" style={{ background: agents[liveStep].color }}>{agents[liveStep].initials}</span><div><b>{agents[liveStep].role}</b><p>{agents[liveStep].detail}</p></div></div>
            </div>
            <div className="stage-footer"><div><span>Analysis progress</span><strong>{72 + liveStep * 6}%</strong></div><div className="progress"><i style={{ width: `${72 + liveStep * 6}%` }} /></div></div>
          </div>
        </section>

        <section className="trust-strip shell"><span>BUILT FOR EVERY BUSINESS</span><div><b>NORTHSTAR</b><b>MONO</b><b>ARC & CO.</b><b>FIELDWORK</b><b>FORM</b></div></section>

        <section className="product-story shell" id="product">
          <div className="section-heading"><span className="section-kicker">ONE TEAM. EVERY ANSWER.</span><h2>From messy data to<br />your next best decision.</h2><p>Your AI Team handles the complexity. You stay focused on the business.</p></div>
          <div className="story-grid">
            <article className="story-card story-large forecast-card">
              <div className="card-heading"><span className="feature-icon green"><TrendingUp size={18} /></span><span>Forecasting</span><small>94% confidence</small></div>
              <h3>See what happens next.</h3><p>Reliable revenue and demand forecasts, explained in language everyone understands.</p>
              <div className="landing-chart"><div className="chart-stat"><span>Revenue forecast</span><strong>$528.4K</strong><em><ArrowUpRight size={13} /> 14.2%</em></div><MiniForecast compact /></div>
            </article>
            <article className="story-card risk-card">
              <div className="card-heading"><span className="feature-icon amber"><ShieldAlert size={18} /></span><span>Risk detection</span></div>
              <h3>Know before it happens.</h3><p>Spot inventory, revenue, and demand risks before they become expensive.</p>
              <div className="risk-preview"><div><span className="risk-symbol"><PackageSearch size={18} /></span><span><b>Inventory shortage</b><small>Product A · in 12 days</small></span><strong>HIGH</strong></div><div className="risk-meter"><i /></div></div>
            </article>
            <article className="story-card recommendation-card">
              <div className="card-heading"><span className="feature-icon blue"><Target size={18} /></span><span>Recommendations</span></div>
              <h3>Turn insight into action.</h3><p>Every finding ends with a clear, evidence-backed next step.</p>
              <div className="action-preview"><span><WandSparkles size={18} /></span><div><small>RECOMMENDED ACTION</small><b>Increase Product A inventory by 15%</b><em>Protect up to $18,400 in projected revenue</em></div><ChevronRight size={18} /></div>
            </article>
          </div>
        </section>

        <section className="team-section" id="team">
          <div className="shell">
            <div className="team-intro"><div><span className="section-kicker light">MEET YOUR AI TEAM</span><h2>Specialists, not assistants.</h2></div><p>Every agent has a clear role, produces real work, and challenges the team when the evidence demands it.</p></div>
            <div className="agent-roster">{agents.map((agent, i) => <article key={agent.name} className="roster-card"><div className="roster-top"><AgentAvatar agent={agent} size="large" /><span>0{i + 1}</span></div><h3>{agent.name}</h3><p>{agent.role}</p><div className="roster-task"><i style={{ background: agent.color }} /><span>{agent.status}</span></div></article>)}</div>
            <div className="team-quote"><Sparkles size={17} /><p>“The system doesn't just give you an answer. It shows you the team that produced it.”</p><span>AI Team OS</span></div>
          </div>
        </section>

        <section className="simulator-section shell" id="simulator">
          <div className="simulator-copy"><span className="section-kicker">AI EXECUTIVE DECISION ROOM</span><h2>Present the decision.<br />Let your team challenge it.</h2><p>Propose a pricing, growth, hiring, capacity, or inventory decision. Your AI Team evaluates its business case against the validated forecast.</p><ul><li><Check size={15} /> Executive consensus and decision score</li><li><Check size={15} /> Transparent assumptions and confidence</li><li><Check size={15} /> Risks, alternatives, and implementation timeline</li></ul><button className="button button-dark" onClick={startOnboarding}>Open Decision Room <ArrowRight size={16} /></button></div>
          <div className="simulator-window">
            <div className="sim-window-top"><div><i /><i /><i /></div><span>Decision Room</span><em>Board review complete</em></div>
            <div className="scenario-prompt"><Sparkles size={17} /><p>What happens if I increase prices by <strong>8%</strong> while demand falls by <strong>5%</strong>?</p></div>
            <div className="scenario-agents">{agents.slice(1).map(a => <AgentAvatar key={a.name} agent={a} size="small" />)}<span>4 specialists collaborated</span></div>
            <div className="outcome-grid"><div><span>Revenue</span><strong>+6.8%</strong><em className="positive"><ArrowUpRight size={12} /> $28.4K</em></div><div><span>Profit</span><strong>+12.4%</strong><em className="positive"><ArrowUpRight size={12} /> $9.2K</em></div><div><span>Demand</span><strong>−5.0%</strong><em className="neutral">Within range</em></div><div><span>Risk</span><strong>Low</strong><em className="positive">Controlled</em></div></div>
            <div className="decision-verdict"><span><Check size={16} /></span><div><small>TEAM VERDICT</small><b>Recommended with safeguards</b><p>Test the new price with one customer segment for two weeks.</p></div><ChevronRight size={18} /></div>
          </div>
        </section>

        <section className="cta-section" id="security"><div className="shell cta-inner"><span className="cta-orbit"><Sparkles size={24} /></span><h2>Your next decision deserves<br />a full team.</h2><p>Connect your data and meet your AI Data Science Team today.</p><button className="button button-light" onClick={startOnboarding}>Deploy your AI Team <ArrowRight size={17} /></button><div className="cta-note"><ShieldAlert size={13} /> Your data stays private and secure</div></div></section>
      </main>
      <footer className="footer shell"><Logo /><p>Decision intelligence for every business.</p><span>© 2026 AI Forecast Studio</span></footer>
    </div>
  )
}

type OnboardingStep = 'upload' | 'review' | 'deploy'

function Onboarding({ onCancel, onComplete }: { onCancel: () => void; onComplete: (briefing: Briefing) => void }) {
  const [step, setStep] = useState<OnboardingStep>('upload')
  const [dataset, setDataset] = useState<ApiDataset | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [datasetHistory, setDatasetHistory] = useState<DatasetHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [uploadNotice, setUploadNotice] = useState('')
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([])
  const [analysisId, setAnalysisId] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [deployError, setDeployError] = useState('')
  const [retryVersion, setRetryVersion] = useState(0)
  const [mappingDraft, setMappingDraft] = useState<Record<string, ColumnProfile['role']>>({})
  const [recoveryAnalysis, setRecoveryAnalysis] = useState<Analysis | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refreshHistory = async () => {
    try {
      const result = await listDatasets()
      setDatasetHistory(result.datasets)
      setHistoryError('')
    } catch (error) {
      setHistoryError(safeErrorMessage(error, 'The dataset library could not be loaded.'))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void listDatasets()
      .then((result) => {
        if (cancelled) return
        setDatasetHistory(result.datasets)
        setHistoryError('')
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(safeErrorMessage(error, 'The dataset library could not be loaded.'))
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getLatestAnalysis().then((result)=>{
      if (!cancelled && result.analysis && ['queued','running','failed'].includes(result.analysis.status)) setRecoveryAnalysis(result.analysis)
    }).catch(()=>undefined)
    return ()=>{cancelled=true}
  }, [])

  const openInterruptedAnalysis = async (resume: boolean) => {
    if (!recoveryAnalysis) return
    try {
      const result = await getDataset(recoveryAnalysis.dataset_id)
      setDataset(result.dataset)
      setMappingDraft(Object.fromEntries(result.dataset.columns.map((column) => [column.name, column.role])))
      setSelectedDatasetIds(recoveryAnalysis.dataset_ids ?? [recoveryAnalysis.dataset_id])
      setAnalysis(recoveryAnalysis)
      setAnalysisId(recoveryAnalysis.id)
      setStep('deploy')
      if (resume && recoveryAnalysis.status === 'failed') {
        await retryAnalysis(recoveryAnalysis.id)
        setAnalysis({...recoveryAnalysis,status:'queued',error:null})
        setRetryVersion((version)=>version+1)
      }
    } catch (error) {
      setUploadError(safeErrorMessage(error, 'The interrupted analysis could not be opened.'))
    }
  }

  const chooseFile = async (file?: File) => {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!extension || !['csv', 'xlsx', 'json'].includes(extension)) {
      setUploadError('Choose a CSV, Excel, or JSON file to continue.')
      return
    }
    try {
      setIsUploading(true)
      setUploadError('')
      setUploadNotice('')
      const result = await ingestDataset(file)
      setDataset(result.dataset)
      setMappingDraft(Object.fromEntries(result.dataset.columns.map((column) => [column.name, column.role])))
      setSelectedDatasetIds([result.dataset.id])
      setUploadNotice(result.reused ? 'This exact file was already in your library. We reused the saved dataset instead of creating a duplicate.' : 'Dataset added to your private library.')
      void refreshHistory()
      setStep('review')
    } catch (error) {
      setUploadError(safeErrorMessage(error, 'The dataset could not be uploaded.'))
    } finally {
      setIsUploading(false)
    }
  }

  const loadSample = async () => {
    try {
      setIsUploading(true)
      setUploadError('')
      setUploadNotice('')
      const result = await createSampleDataset()
      setDataset(result.dataset)
      setMappingDraft(Object.fromEntries(result.dataset.columns.map((column) => [column.name, column.role])))
      setSelectedDatasetIds([result.dataset.id])
      setUploadNotice(result.reused ? 'The saved Northstar dataset was reused.' : 'Northstar was added to your private library.')
      void refreshHistory()
      setStep('review')
    } catch (error) {
      setUploadError(safeErrorMessage(error, 'The sample dataset could not be created.'))
    } finally {
      setIsUploading(false)
    }
  }

  const toggleSavedDataset = (datasetId: string) => {
    setHistoryError('')
    setSelectedDatasetIds((current) => {
      if (current.includes(datasetId)) return current.filter((id) => id !== datasetId)
      if (current.length >= 5) {
        setHistoryError('Choose up to five datasets per analysis.')
        return current
      }
      return [...current, datasetId]
    })
  }

  const reviewSavedDatasets = async () => {
    const primaryDatasetId = selectedDatasetIds[0]
    if (!primaryDatasetId) return
    try {
      setHistoryLoading(true)
      setHistoryError('')
      setUploadNotice(`${selectedDatasetIds.length} saved dataset${selectedDatasetIds.length === 1 ? '' : 's'} selected. No upload was required.`)
      const result = await getDataset(primaryDatasetId)
      setDataset(result.dataset)
      setMappingDraft(Object.fromEntries(result.dataset.columns.map((column) => [column.name, column.role])))
      setStep('review')
    } catch (error) {
      setHistoryError(safeErrorMessage(error, 'The selected dataset could not be opened.'))
    } finally {
      setHistoryLoading(false)
    }
  }

  const renameSavedDataset = async (item: DatasetHistoryItem) => {
    const next = window.prompt('Rename this business context. The original source filename will remain unchanged.', item.display_name ?? item.filename.replace(/\.[^.]+$/, ''))
    if (!next?.trim()) return
    try { await renameDataset(item.id, next.trim()); await refreshHistory() } catch (error) { setHistoryError(safeErrorMessage(error, 'The dataset could not be renamed.')) }
  }

  const archiveSavedDataset = async (item: DatasetHistoryItem) => {
    if (!window.confirm(`Archive “${item.display_name ?? item.filename}”? Its source records and analysis history will be preserved.`)) return
    try { await archiveDataset(item.id); setSelectedDatasetIds((current)=>current.filter((id)=>id!==item.id)); await refreshHistory() } catch (error) { setHistoryError(safeErrorMessage(error, 'The dataset could not be archived.')) }
  }

  const deleteSavedDataset = async (item: DatasetHistoryItem) => {
    const name = item.display_name ?? item.filename
    const confirmation = window.prompt(`Permanent deletion affects source records, analyses, forecasts, reports, conversations, simulations, and dataset shares. Type “${name}” to continue.`)
    if (confirmation !== name) return
    try { await deleteDataset(item.id, confirmation); setSelectedDatasetIds((current)=>current.filter((id)=>id!==item.id)); await refreshHistory() } catch (error) { setHistoryError(safeErrorMessage(error, 'The dataset could not be deleted.')) }
  }

  const saveColumnMapping = async () => {
    if (!dataset) return
    try {
      setHistoryLoading(true)
      const result = await updateDatasetMapping(dataset.id, dataset.columns.map((column)=>({ name: column.name, role: mappingDraft[column.name] ?? column.role })))
      setDataset(result.dataset)
      setUploadNotice('Column mapping updated. Dependent forecasts must be recalculated before they are used again.')
    } catch (error) {
      setHistoryError(safeErrorMessage(error, 'The column mapping could not be updated.'))
    } finally { setHistoryLoading(false) }
  }

  const enterCompletedContext = () => {
    if (!analysis?.briefing || !analysisId) return
    localStorage.setItem('forecast-studio-active-context', analysisId)
    onComplete(analysis.briefing)
  }

  useEffect(() => {
    if (step !== 'deploy' || !analysisId) return
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const result = await getAnalysis(analysisId)
        if (cancelled) return
        setAnalysis(result.analysis)
        if (result.analysis.status === 'failed') {
          setDeployError(result.analysis.error ?? 'The AI Team could not complete this analysis.')
          return
        }
        if (result.analysis.status !== 'completed') timer = window.setTimeout(poll, 1_200)
      } catch (error) {
        if (!cancelled) setDeployError(safeErrorMessage(error, 'Could not read the analysis status.'))
      }
    }
    void poll()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [analysisId, step, retryVersion])

  const deployTeam = async () => {
    if (!dataset) return
    setStep('deploy')
    setAnalysis(null)
    setAnalysisId('')
    setDeployError('')
    try {
      const result = await startAnalysis(selectedDatasetIds.length > 0 ? selectedDatasetIds : [dataset.id])
      setAnalysisId(result.analysisId)
    } catch (error) {
      setDeployError(safeErrorMessage(error, 'The AI Team could not be deployed.'))
    }
  }

  const resumeTeam = async () => {
    if (!analysisId) return
    try {
      setDeployError('')
      await retryAnalysis(analysisId)
      setAnalysis((current) => current ? { ...current, status: 'queued', error: null } : current)
      setRetryVersion((version) => version + 1)
    } catch (error) {
      setDeployError(safeErrorMessage(error, 'The AI Team could not resume this analysis.'))
    }
  }

  const deploymentComplete = analysis?.status === 'completed' && Boolean(analysis.briefing)
  const completedRuns = analysis?.agents.filter((run) => run.status === 'completed').length ?? 0
  const totalRuns = analysis?.agents.length ?? 6
  const hasRunningAgent = analysis?.agents.some((run) => run.status === 'running') ?? false
  const progress = deploymentComplete ? 100 : Math.round(((completedRuns + (hasRunningAgent ? .35 : 0)) / totalRuns) * 100)
  const dateRange = dataset?.summary.dateRange
  const periodLabel = dateRange
    ? `${new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(dateRange.start))} – ${new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(dateRange.end))}`
    : 'No date range detected'
  const activeRun = analysis?.agents.find((run) => run.status === 'running')
  const selectedSources = datasetHistory.filter((item) => selectedDatasetIds.includes(item.id))
  const selectedRowCount = selectedDatasetIds.reduce((total, id) => {
    if (id === dataset?.id) return total + (dataset?.row_count ?? 0)
    return total + (datasetHistory.find((item) => item.id === id)?.row_count ?? 0)
  }, 0)

  return (
    <div className="onboarding-shell">
      <header className="onboarding-nav">
        <Logo />
        <div className="onboarding-steps" aria-label="Setup progress">
          {['Connect data', 'Review', 'Deploy team'].map((label, index) => {
            const activeIndex = step === 'upload' ? 0 : step === 'review' ? 1 : 2
            return <span key={label} className={index === activeIndex ? 'active' : index < activeIndex ? 'complete' : ''}><i>{index < activeIndex ? <Check size={10} /> : index + 1}</i>{label}</span>
          })}
        </div>
        <button className="onboarding-close" onClick={onCancel} aria-label="Close setup"><X size={18} /></button>
      </header>

      {step === 'upload' && (
        <main className="onboarding-main upload-step">
          {recoveryAnalysis&&<section className="onboarding-recovery"><AlertTriangle size={19}/><div><b>Your previous analysis was interrupted.</b><p>{recoveryAnalysis.agents.filter((agent)=>agent.status==='completed').length} specialist stages are preserved. Resume from the first incomplete stage, start a separate analysis, or return to the workspace.</p></div><button className="button button-dark" onClick={()=>{void openInterruptedAnalysis(true)}}>Resume</button><button className="button button-outline" onClick={()=>setRecoveryAnalysis(null)}>Start over</button><button className="button button-outline" onClick={onCancel}>Return to workspace</button></section>}
          <div className="setup-heading">
            <span className="section-kicker">BUILD YOUR BUSINESS MODEL</span>
            <h1>Give your AI Team context.</h1>
            <p>Start with historical business data. Your Data Engineer will inspect the structure before anything is analyzed.</p>
          </div>
          <section
            className={`upload-zone ${dragging ? 'is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }}
          >
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.json" onChange={(event) => { void chooseFile(event.target.files?.[0]) }} />
            <span className="upload-icon"><CloudUpload size={27} /></span>
            <h2>Drop your business data here</h2>
            <p>CSV, Excel, or JSON · up to 25 MB</p>
            <button className="button button-dark" disabled={isUploading} onClick={() => fileInput.current?.click()}>{isUploading ? <><span className="spinner" /> Connecting to Neon...</> : 'Choose a file'}</button>
            {uploadError && <div className="upload-error"><ShieldAlert size={14} /> {uploadError}</div>}
          </section>
          {(historyLoading || datasetHistory.length > 0 || historyError) && <>
            <div className="sample-divider"><span>or reuse saved data</span></div>
            <section className="dataset-library" aria-label="Uploaded dataset history">
              <div className="library-head">
                <div><span className="section-kicker">DATASET LIBRARY</span><h2>Your connected history</h2><p>Select up to five sources. The first selection becomes the dashboard baseline.</p></div>
                <em>{datasetHistory.length} saved</em>
              </div>
              {historyLoading && datasetHistory.length === 0 ? <div className="library-loading"><span className="spinner" /> Loading your Neon library...</div> : (
                <div className="dataset-history-list">
                  {datasetHistory.map((item) => {
                    const selected = selectedDatasetIds.includes(item.id)
                    const coverage = item.date_range ? `${new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(item.date_range.start))} – ${new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(item.date_range.end))}` : 'No timeline'
                    return <div className={`dataset-history-row ${selected ? 'selected' : ''}`} key={item.id}>
                      <button type="button" className="dataset-history-select" aria-pressed={selected} onClick={() => toggleSavedDataset(item.id)}><span className="history-file-icon"><FileSpreadsheet size={17} /></span></button>
                      <span className="history-file-copy"><b>{item.display_name ?? item.filename.replace(/\.[^.]+$/, '')}</b><small>Original: {item.filename} · {item.row_count.toLocaleString()} rows · {coverage}</small></span>
                      <span className="history-quality"><b>{Math.round(item.completeness)}%</b><small>complete</small></span>
                      <span className="history-analyses"><b>{item.latest_forecast_confidence===null?'—':`${Math.round(item.latest_forecast_confidence)}%`}</b><small>confidence</small></span>
                      <span className="history-date">{relativeTime(item.created_at)}</span>
                      <span className="dataset-row-actions"><button title="Rename" onClick={()=>{void renameSavedDataset(item)}}><Pencil size={11}/></button><button title="Archive" onClick={()=>{void archiveSavedDataset(item)}}><Archive size={11}/></button><button title="Delete permanently" className="danger" onClick={()=>{void deleteSavedDataset(item)}}><Trash2 size={11}/></button><i>{selected ? <Check size={12} /> : <Plus size={12} />}</i></span>
                    </div>
                  })}
                  {!datasetHistory.length && !historyLoading && <div className="library-empty">Your uploaded datasets will appear here automatically.</div>}
                </div>
              )}
              {historyError && <div className="library-error"><ShieldAlert size={13} /> {historyError}</div>}
              {datasetHistory.length > 0 && <div className="library-actions"><span>{selectedDatasetIds.length ? `${selectedDatasetIds.length} of 5 selected` : 'Select saved sources to continue'}</span><button className="button button-dark" disabled={historyLoading || selectedDatasetIds.length === 0} onClick={() => { void reviewSavedDatasets() }}>Review selected <ArrowRight size={14} /></button></div>}
            </section>
          </>}
          <div className="sample-divider"><span>or start instantly</span></div>
          <button className="sample-dataset" disabled={isUploading} onClick={() => { void loadSample() }}>
            <span><Database size={20} /></span>
            <div><b>Explore Northstar Retail</b><small>24 months of sales, inventory, products, and pricing</small></div>
            <em>Use sample data <ArrowRight size={14} /></em>
          </button>
          <div className="privacy-note"><ShieldAlert size={13} /> Your data is used only to create this workspace analysis.</div>
        </main>
      )}

      {step === 'review' && (
        <main className="onboarding-main review-step">
          <button className="back-step" onClick={() => setStep('upload')}><ArrowLeft size={14} /> Choose another file</button>
          <div className="setup-heading">
            <span className="section-kicker">DATA ENGINEER REVIEW</span>
            <h1>{selectedDatasetIds.length > 1 ? `${selectedDatasetIds.length} data sources are ready.` : 'Your data is ready.'}</h1>
            <p>{selectedDatasetIds.length > 1 ? 'The AI Team will compare the selected histories and use their combined context during analysis.' : 'We found a healthy time series and mapped the fields needed to forecast revenue, demand, and inventory.'}</p>
          </div>
          <section className="review-layout">
            <article className="review-card file-summary">
              <div className="review-card-title"><span><FileSpreadsheet size={19} /></span><div><b>{dataset?.filename}</b><small>Persisted in Neon · profiled just now</small></div><em><Check size={12} /> Ready</em></div>
              <div className="dataset-stats"><div><span>Rows</span><strong>{dataset?.row_count.toLocaleString()}</strong></div><div><span>Period</span><strong>{periodLabel}</strong></div><div><span>Completeness</span><strong>{dataset?.summary.completeness}%</strong></div></div>
              <div className="quality-callout"><Check size={15} /><div><b>{dateRange ? 'Forecasting timeline detected' : 'Dataset profile completed'}</b><p>{dateRange ? 'The timeline and numeric metrics are ready for specialist analysis.' : 'Review the detected metrics before relying on time-based forecasts.'}</p></div></div>
              {uploadNotice && <div className="reuse-notice"><Database size={14} /><span>{uploadNotice}</span></div>}
            </article>
            <article className="review-card schema-card">
              <div className="schema-head"><div><span>DETECTED SCHEMA</span><h2>Business field mapping</h2></div><em>{dataset?.summary.keyMetrics.length ?? 0} key metrics</em></div>
              {dataset?.columns.map((column) => <div className="schema-row editable" key={column.name}><select aria-label={`Role for ${column.name}`} value={mappingDraft[column.name] ?? column.role} onChange={(event)=>setMappingDraft((current)=>({...current,[column.name]:event.target.value as ColumnProfile['role']}))}><option value="date">Date</option><option value="revenue">Revenue</option><option value="demand">Demand</option><option value="inventory">Inventory</option><option value="price">Price</option><option value="cost">Cost</option><option value="profit">Profit</option><option value="holiday">Holiday flag</option><option value="external_regressor">External driver</option><option value="dimension">Dimension</option><option value="metric">Other KPI</option></select><code>{column.name}</code><small>{column.type}</small><Check size={13} /></div>)}
              {!dataset?.columns.length && <div className="empty-schema">No business fields were detected.</div>}
              <button className="button button-outline mapping-save" disabled={historyLoading} onClick={()=>{void saveColumnMapping()}}>Save mapping & invalidate forecasts</button>
            </article>
          </section>
          {selectedDatasetIds.length > 1 && <section className="context-sources"><div><span className="section-kicker">ANALYSIS CONTEXT</span><b>{selectedDatasetIds.length} connected sources</b></div><div>{selectedSources.map((source) => <span key={source.id}><FileSpreadsheet size={12} /> {source.filename}</span>)}</div></section>}
          <div className="review-actions">
            <div className="ready-team">{agents.map((agent) => <AgentAvatar key={agent.name} agent={agent} size="small" />)}<span>Your specialists are ready</span></div>
            <button className="button button-dark" onClick={() => { void deployTeam() }}>Deploy AI Team <ArrowRight size={16} /></button>
          </div>
        </main>
      )}

      {step === 'deploy' && (
        <main className="deployment-step">
          <section className="deployment-stage">
            <div className="deployment-glow" />
            <div className="deployment-copy">
              <span className="live-pill"><i /> AI TEAM OS</span>
              <h1>{deployError ? 'The team needs configuration.' : deploymentComplete ? 'Your briefing is ready.' : 'Your team is investigating.'}</h1>
              <p>{deployError ? deployError : deploymentComplete ? 'Five specialists and the Team Lead collaborated to produce your first evidence-backed briefing.' : 'Specialists are validating evidence and handing work to one another in real time.'}</p>
            </div>
            <div className="deployment-board">
              <div className="deployment-core"><Database size={20} /><b>{selectedDatasetIds.length > 1 ? `${selectedDatasetIds.length} connected datasets` : dataset?.filename ?? 'Business model'}</b><span>{selectedRowCount.toLocaleString()} records in Neon</span></div>
              <div className="deploy-agent-list">
                {agents.map((agent) => {
                  const run = analysis?.agents.find((item) => item.agent_key === agent.key)
                  const state = run?.status === 'completed' ? 'complete' : run?.status === 'running' ? 'working' : 'waiting'
                  return <div className={`deploy-agent ${state}`} key={agent.name}><AgentAvatar agent={agent} size="medium" pulse={state === 'working'} /><div><b>{agent.role}</b><span>{state === 'complete' ? agent.status : state === 'working' ? agent.detail : 'Waiting for handoff'}</span></div><em>{state === 'complete' ? <Check size={13} /> : state === 'working' ? <span className="mini-spinner" /> : 'Queued'}</em></div>
                })}
              </div>
            </div>
            <div className="deployment-progress"><div><span>{deployError ? 'Configuration required' : deploymentComplete ? 'Analysis complete' : activeRun ? `${activeRun.role} is working` : 'Creating specialist workstreams'}</span><strong>{progress}%</strong></div><div><i style={{ width: `${progress}%` }} /></div></div>
            {deployError && <div className="deployment-error"><ShieldAlert size={17} /><span>{deployError}</span>{analysisId?<button onClick={() => { void resumeTeam() }}>Retry from failed step</button>:<button onClick={() => { setStep('review'); setDeployError('') }}>Review setup</button>}</div>}
            {deploymentComplete && analysis?.briefing && <div className="deployment-result context-ready"><span><Sparkles size={18} /></span><div><small>ANALYSIS READY · SWITCH WORKSPACE CONTEXT?</small><b>{selectedDatasetIds.length>1?selectedSources.map((source)=>source.display_name??source.filename).join(' + '):dataset?.display_name??dataset?.filename}</b><p>{analysis.briefing.primaryRisk.title} · Your previous workspace remains selected until you choose.</p></div><div><button className="button button-light" onClick={enterCompletedContext}>Switch context <ArrowRight size={15} /></button>{localStorage.getItem('forecast-studio-active-context')&&<button className="button button-outline" onClick={() => onComplete(analysis.briefing!)}>Keep current context</button>}<button className="button button-outline" onClick={()=>window.open(`/app?context=${analysisId}`,'_blank','noopener')}>Open in new context</button></div></div>}
          </section>
        </main>
      )}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, change, tone = 'green', down = false }: { icon: typeof Activity; label: string; value: string; change: string; tone?: string; down?: boolean }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={17} /></div><div className="metric-main"><span>{label}</span><strong>{value}</strong></div><div className={`metric-change ${down ? 'down' : ''}`}>{change !== '—' && (down ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />)}{change}</div></article>
}

function formatMetric(value: number | null, compact = true) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en', { notation: compact ? 'compact' : 'standard', maximumFractionDigits: value < 100 ? 1 : 0 }).format(value)
}

function trendText(value: number | null) {
  return formatPercent(value)
}

function healthScoreTone(score: number | null) {
  if (score === null) return ''
  return score >= 70 ? 'positive' : score >= 50 ? 'warning' : 'danger'
}

function relativeTime(value?: string | null) {
  if (!value) return 'Pending'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

function findingText(output: unknown, fallback: string) {
  if (!output || typeof output !== 'object') return fallback
  const finding = output as { headline?: unknown; summary?: unknown; recommendation?: unknown }
  return [finding.headline, finding.summary, finding.recommendation].find((value): value is string => typeof value === 'string') ?? fallback
}

function TodayDashboard({ setSection, briefing, analytics, analysis }: { setSection: (section: AppSection) => void; briefing: Briefing | null; analytics: DatasetAnalytics | null; analysis: Analysis | null }) {
  const { user } = useAuth()
  const [chartMetric, setChartMetric] = useState<ForecastMetricKey>('revenue')
  const [chartHorizon, setChartHorizon] = useState<3 | 6>(6)
  const [showForecastInterval, setShowForecastInterval] = useState(true)
  const firstName = user?.fullName.split(/\s+/)[0] ?? 'there'
  if (!analytics) return <><header className="app-header"><div><span>{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span><h1>Good morning, {firstName}.</h1></div></header><EmptyWorkspace/></>
  const availableForecastMetrics = (Object.keys(analytics.forecasts.metrics) as ForecastMetricKey[]).filter((metric) => analytics.forecasts.metrics[metric] !== null)
  const selectedForecastMetric = availableForecastMetrics.includes(chartMetric) ? chartMetric : analytics.forecasts.primaryMetric
  const primaryForecast = selectedForecastMetric ? analytics.forecasts.metrics[selectedForecastMetric] : null
  const forecastEndpoint = primaryForecast?.points[Math.min(chartHorizon, primaryForecast.points.length) - 1]
  const forecastBaseline = selectedForecastMetric ? analytics.metrics[selectedForecastMetric].current : null
  const forecastChange = forecastEndpoint && forecastBaseline !== null && forecastBaseline !== 0 ? ((forecastEndpoint.value - forecastBaseline) / Math.abs(forecastBaseline)) * 100 : 0
  const signedForecast = `${forecastChange >= 0 ? '+' : ''}${forecastChange.toFixed(1)}%`
  const forecastPeriodUnit = analytics.source.frequency === 'daily' ? 'days' : analytics.source.frequency === 'weekly' ? 'weeks' : analytics.source.frequency === 'quarterly' ? 'quarters' : 'months'
  const healthScore = analytics.health.overall
  const recentRuns = analysis?.agents.filter((run) => run.status === 'completed' || run.status === 'running').slice().reverse().slice(0, 4) ?? []
  const healthLabel = healthScore >= 80 ? 'Strong' : healthScore >= 60 ? 'Stable' : 'Needs attention'
  const healthComponents = [
    { label: 'Revenue health', component: analytics.health.components.revenue },
    { label: 'Forecast reliability', component: analytics.health.components.forecastReliability },
    { label: 'Demand stability', component: analytics.health.components.demandStability },
    { label: 'Inventory health', component: analytics.health.components.inventory },
    { label: 'Growth potential', component: analytics.health.components.growthPotential },
    { label: 'Data quality', component: analytics.health.components.dataQuality },
  ]
  return <>
    <header className="app-header"><div><span>EXECUTIVE BRIEFING · {new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span><h1>Good morning, {firstName}.</h1></div><button className="button button-app" onClick={() => setSection('Team Meetings')}><Sparkles size={15} /> Ask your AI Team</button></header>

    <section className="briefing-card">
      <div className="briefing-orb"><Sparkles size={19} /></div>
      <div className="briefing-copy"><div className="briefing-label"><span>{briefing ? 'AI TEAM BRIEFING' : 'REAL DATA SNAPSHOT'}</span><i>{analytics.source.rowCount.toLocaleString()} Neon records · {frequencyLabel(analytics.source.frequency,analytics.source.periods)}</i></div><h2>{briefing?.headline ?? <>Your real metrics are ready. <em>Deploy the AI Team</em> to generate risks and recommendations.</>}</h2><p>{briefing?.executiveSummary ?? <>Latest revenue: <strong>{formatMetric(analytics.metrics.revenue.current)}</strong> · Demand: <strong>{formatMetric(analytics.metrics.demand.current)}</strong> · Data completeness: <strong>{formatPercent(analytics.source.completeness,{sign:false})}</strong>.</>}</p><div className="briefing-actions"><button onClick={() => setSection('Insights')}>Review evidence <ArrowRight size={14} /></button><button onClick={() => setSection('Decision Room')}><Play size={12} fill="currentColor" /> Present a decision</button>{!briefing&&<Link to="/onboarding">Deploy analysis <ArrowRight size={14}/></Link>}</div></div>
      <div className="briefing-team">{agents.slice(0, Math.max(1, Math.min(3, recentRuns.length || 1))).map((a) => <AgentAvatar agent={a} size="small" key={a.name} />)}<span>{recentRuns.length}<br />completed runs</span></div>
    </section>

    <section className="metric-grid">
      <MetricCard icon={CircleDollarSign} label={`Latest revenue${analytics.metrics.revenue.column ? ` · ${analytics.metrics.revenue.column}` : ''}`} value={formatMetric(analytics.metrics.revenue.current)} change={trendText(analytics.metrics.revenue.changePercent)} down={(analytics.metrics.revenue.changePercent ?? 0) < 0} />
      <MetricCard icon={PackageSearch} label={`Latest demand${analytics.metrics.demand.column ? ` · ${analytics.metrics.demand.column}` : ''}`} value={formatMetric(analytics.metrics.demand.current)} change={trendText(analytics.metrics.demand.changePercent)} tone="blue" down={(analytics.metrics.demand.changePercent ?? 0) < 0} />
      <MetricCard icon={Gauge} label="Gross margin" value={formatPercent(analytics.metrics.grossMarginPercent, { sign: false })} change={analytics.metrics.grossProfit === null ? '—' : formatMetric(analytics.metrics.grossProfit)} tone="purple" />
      <MetricCard icon={ShieldAlert} label={`Closing inventory${analytics.metrics.inventory.column ? ` · ${analytics.metrics.inventory.column}` : ''}`} value={formatMetric(analytics.metrics.inventory.current)} change={trendText(analytics.metrics.inventory.changePercent)} tone="amber" down={(analytics.metrics.inventory.changePercent ?? 0) < 0} />
    </section>

    <section className="dashboard-grid">
      <article className="panel forecast-panel">
        <div className="panel-header"><div><span>{primaryForecast ? `${primaryForecast.metric.toUpperCase()} FORECAST` : 'PRIMARY METRIC FORECAST'}</span><h3>{formatMetric(forecastEndpoint?.value ?? null)} <em>{forecastChange < 0 ? <ArrowDownRight size={13}/> : <ArrowUpRight size={13}/>} {primaryForecast ? signedForecast : '—'}</em></h3></div><div className="panel-tools"><label title="Forecast metric"><select aria-label="Forecast metric" value={selectedForecastMetric ?? ''} onChange={(event) => setChartMetric(event.target.value as ForecastMetricKey)} disabled={!availableForecastMetrics.length}>{availableForecastMetrics.map((metric) => <option key={metric} value={metric}>{metric[0]!.toUpperCase() + metric.slice(1)}</option>)}</select><ChevronDown size={12}/></label><label title="Forecast horizon"><select aria-label="Forecast horizon" value={chartHorizon} onChange={(event) => setChartHorizon(Number(event.target.value) as 3 | 6)} disabled={!primaryForecast}><option value={3}>3 {forecastPeriodUnit}</option><option value={6}>6 {forecastPeriodUnit}</option></select><ChevronDown size={12}/></label><button className={showForecastInterval ? 'is-active' : ''} aria-label="Toggle 95% prediction interval" aria-pressed={showForecastInterval} title={showForecastInterval ? 'Hide 95% prediction interval' : 'Show 95% prediction interval'} onClick={() => setShowForecastInterval((visible) => !visible)}><SlidersHorizontal size={15} /></button></div></div>
        <ForecastChart analytics={analytics} metric={selectedForecastMetric ?? undefined} horizon={chartHorizon} showInterval={showForecastInterval}/>
        <div className="chart-legend"><span><i className="actual" /> Actual</span><span><i className="projected" /> Forecast</span><span><i className="range" /> 95% interval</span></div>
      </article>

      <article className="panel health-panel">
        <div className="panel-header"><div><span>BUSINESS HEALTH</span><h3>{healthLabel}</h3></div><button aria-label="Open business health" onClick={() => setSection('Insights')}><ArrowUpRight size={16} /></button></div>
        <div className="health-score"><svg viewBox="0 0 180 100"><path d="M20 88 A70 70 0 0 1 160 88" className="gauge-base" /><path d="M20 88 A70 70 0 0 1 160 88" className="gauge-value" style={{ strokeDasharray: `${Math.round(healthScore * 2.2)} 220` }} /></svg><div><strong>{healthScore}</strong><span>out of 100</span></div></div>
        <div className="health-list">{healthComponents.map(({ label, component }) => <div key={label} title={component.explanation}><span>{label}<small>{component.weight}% weight</small></span><b className={healthScoreTone(component.score)}>{component.score === null ? 'N/A' : `${component.score}/100`}</b></div>)}<div className="health-risk" title="Risk is high when the weighted score is below 50 or any available component is below 35; medium below 70 or when any component is below 60."><span>Risk level</span><b className={analytics.health.riskLevel === 'HIGH' ? 'danger' : analytics.health.riskLevel === 'MEDIUM' ? 'warning' : 'positive'}>{analytics.health.riskLevel}</b></div></div>
      </article>

      <article className="panel recommendation-panel">
        <div className="panel-header"><div><span>PRIORITY RECOMMENDATION</span><h3>{briefing?.primaryRisk.title ?? 'AI recommendation pending'}</h3></div>{briefing&&<span className="new-pill">LIVE</span>}</div>
        <div className="recommendation-content"><div className="rec-icon"><PackageSearch size={21} /></div><div><h4>{briefing?.recommendation.action ?? 'Deploy the AI Team on this dataset'}</h4><p>{briefing?.primaryRisk.estimatedTiming ?? 'The deterministic metrics are ready; specialist analysis has not completed yet.'}</p><div className="rec-impact"><span><small>EXPECTED IMPACT</small><b>{briefing?.recommendation.expectedImpact ?? 'Pending'}</b></span><span><small>CONFIDENCE</small><b>{briefing ? `${briefing.recommendation.confidence}%` : '—'}</b></span><span><small>URGENCY</small><b>{briefing?.recommendation.urgency ?? '—'}</b></span></div></div></div>
        <div className="recommendation-actions"><button className="button button-app" onClick={() => setSection('Decision Room')}><Play size={12} fill="currentColor" /> Present action</button><button className="button button-outline" onClick={() => setSection('Insights')}>Review evidence</button></div>
      </article>

      <article className="panel activity-panel">
        <div className="panel-header"><div><span>TEAM ACTIVITY</span><h3>{recentRuns.length ? 'Latest specialist work' : 'No runs yet'}</h3></div><span className="live-pill"><i /> {analysis?.status ?? 'IDLE'}</span></div>
        <div className="activity-list">{recentRuns.map((run) => {const agent=agents.find((item)=>item.key===run.agent_key);return <div key={run.agent_key}><span className="activity-avatar" style={{ background: agent?.color ?? '#60736b' }}>{run.agent_name[0]}</span><p><b>{run.agent_name}</b> {findingText(run.output, run.status === 'running' ? 'is analyzing the latest dataset' : 'completed specialist analysis')}<small>{relativeTime(run.completed_at ?? run.started_at)}</small></p></div>})}{!recentRuns.length&&<p className="activity-empty">Deploy an analysis to see real agent activity.</p>}</div>
        <button className="view-all" onClick={() => setSection('AI Team OS')}>View full activity <ArrowRight size={13} /></button>
      </article>
    </section>
  </>
}



interface WorkspaceContext {
  analysis: Analysis | null
  dataset: ApiDataset | null
  analytics: DatasetAnalytics | null
  loading: boolean
  error: string
  refreshAnalysis: () => Promise<void>
}

function AnalysisStatusBanner({ analysis, onAnalysisChange }: { analysis: Analysis; onAnalysisChange: (analysis: Analysis) => void }) {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(`analysis-banner:${analysis.id}`) === 'dismissed')
  const [details, setDetails] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  const completed = analysis.agents.filter((agent) => agent.status === 'completed' && agent.agent_key !== 'team_lead').length
  const total = analysis.agents.filter((agent) => agent.agent_key !== 'team_lead').length || 5
  const failedAgent = analysis.failure_details?.failedAgent
  const failedAgentName = analysis.agents.find((agent) => agent.agent_key === failedAgent)?.agent_name
  const failed = analysis.status === 'failed'
  const invalidated = Boolean(analysis.invalidated_at)
  if ((analysis.status === 'completed' && !invalidated) || dismissed) return null
  const resume = async () => {
    try {
      setRetrying(true)
      setError('')
      await retryAnalysis(analysis.id)
      const refreshed = await getAnalysis(analysis.id)
      onAnalysisChange(refreshed.analysis)
    } catch (caught) {
      setError(safeErrorMessage(caught, 'The analysis could not be resumed.'))
    } finally {
      setRetrying(false)
    }
  }
  return <section className={`global-analysis-status ${failed ? 'failed' : 'active'}`} role={failed ? 'alert' : 'status'}>
    <span>{failed ? <AlertTriangle size={18}/> : <span className="spinner"/>}</span>
    <div><b>{invalidated ? 'Forecast recalculation required' : failed ? (analysis.failure_code === 'AI_TIMEOUT' ? 'Analysis timed out' : 'Analysis interrupted') : analysis.retry_count > 0 ? 'Analysis is resuming' : 'AI Team analysis in progress'}</b><p>{invalidated ? 'The dataset column mapping changed. Deterministic forecasts and specialist conclusions must be recalculated before new decisions are made.' : failed ? `The team completed ${completed} of ${total} specialist stages. Completed work was preserved${failedAgentName ? `; ${failedAgentName} can resume from the interrupted stage` : ''}.` : `${completed} of ${total} specialist stages completed. This status will update automatically.`}</p>{error&&<small>{error}</small>}{details&&<dl><div><dt>Failure category</dt><dd>{invalidated?'DATA_MAPPING_CHANGED':analysis.failure_code ?? 'Internal processing failure'}</dd></div><div><dt>Interrupted stage</dt><dd>{failedAgentName ?? 'Not recorded'}</dd></div><div><dt>Last server update</dt><dd>{new Date(analysis.last_heartbeat_at ?? analysis.created_at).toLocaleString()}</dd></div><div><dt>Retry count</dt><dd>{analysis.retry_count}</dd></div></dl>}</div>
    <div className="global-analysis-actions">{invalidated?<Link className="button button-app" to="/onboarding"><RotateCcw size={12}/> Recalculate analysis</Link>:failed&&<button className="button button-app" onClick={()=>{void resume()}} disabled={retrying}><RotateCcw size={12}/>{retrying?'Resuming…':'Resume analysis'}</button>}<button onClick={()=>setDetails(!details)}>{details?'Hide':'View'} technical details</button><button onClick={()=>{sessionStorage.setItem(`analysis-banner:${analysis.id}`,'dismissed');setDismissed(true)}}>Dismiss temporarily</button></div>
  </section>
}

function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [dataset, setDataset] = useState<ApiDataset | null>(null)
  const [analytics, setAnalytics] = useState<DatasetAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [contexts, setContexts] = useState<AnalysisContextSummary[]>([])
  const [contextSwitching, setContextSwitching] = useState(false)
  const [pinnedContexts, setPinnedContexts] = useState<string[]>(()=>{
    try { return JSON.parse(localStorage.getItem('forecast-studio-pinned-contexts')??'[]') as string[] } catch { return [] }
  })
  const refreshAnalysis = async () => {
    const result = await getLatestAnalysis()
    setAnalysis(result.analysis)
  }
  useEffect(() => {
    let active = true
    const requestedContext = resolveMeetingWorkspaceContext(
      window.location.search,
      localStorage.getItem('forecast-studio-active-context'),
      async (conversationId) => (await getTeamConversationContext(conversationId)).context,
    )
    const workspaceRequest = requestedContext.then((contextId) => contextId
      ? getAnalysis(contextId).then(async (analysisResult) => {
        const [datasetResult, analyticsResult] = await Promise.all([getDataset(analysisResult.analysis.dataset_id), getDatasetAnalytics(analysisResult.analysis.dataset_id)])
        if (datasetResult.dataset.archived_at) throw new Error('The selected dataset is archived.')
        return [analysisResult, datasetResult, analyticsResult] as const
      }).catch(() => Promise.all([getLatestAnalysis(), getLatestDataset(), getLatestDatasetAnalytics()]))
      : Promise.all([getLatestAnalysis(), getLatestDataset(), getLatestDatasetAnalytics()]))
    Promise.all([workspaceRequest, listAnalysisContexts()]).then(([[analysisResult, datasetResult, analyticsResult], contextResult]) => {
      if (!active) return
      setAnalysis(analysisResult.analysis)
      setDataset(datasetResult.dataset)
      setAnalytics(analyticsResult.analytics)
      setContexts(contextResult.contexts)
      if (analysisResult.analysis) localStorage.setItem('forecast-studio-active-context', analysisResult.analysis.id)
    }).catch((error: unknown) => { if (active) setWorkspaceError(safeErrorMessage(error, 'The workspace could not be loaded.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!analysis || !['queued', 'running'].includes(analysis.status)) return
    const timer = window.setInterval(() => {
      void getAnalysis(analysis.id).then((result) => setAnalysis(result.analysis)).catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [analysis])
  const switchContext = async (contextId: string) => {
    if (contextId === analysis?.id) { setContextOpen(false); return }
    try {
      setContextSwitching(true)
      setWorkspaceError('')
      const analysisResult = await getAnalysis(contextId)
      const [datasetResult, analyticsResult] = await Promise.all([getDataset(analysisResult.analysis.dataset_id), getDatasetAnalytics(analysisResult.analysis.dataset_id)])
      setAnalysis(analysisResult.analysis)
      setDataset(datasetResult.dataset)
      setAnalytics(analyticsResult.analytics)
      localStorage.setItem('forecast-studio-active-context', contextId)
      setContextOpen(false)
    } catch (error) {
      setWorkspaceError(safeErrorMessage(error, 'The selected business context could not be opened.'))
    } finally { setContextSwitching(false) }
  }
  const initials = user?.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() ?? 'AF'
  const activeContext = contexts.find((context)=>context.id===analysis?.id)
  const orderedContexts = [...contexts].sort((left,right)=>Number(pinnedContexts.includes(right.id))-Number(pinnedContexts.includes(left.id)))
  const togglePinnedContext = (contextId: string) => {
    setPinnedContexts((current)=>{
      const next=current.includes(contextId)?current.filter((id)=>id!==contextId):[...current,contextId]
      localStorage.setItem('forecast-studio-pinned-contexts',JSON.stringify(next))
      return next
    })
  }
  const workspaceName = activeContext?.dataset_names.join(' + ') ?? dataset?.display_name ?? dataset?.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') ?? 'New workspace'
  const signOut = async () => { await logout(); navigate('/', { replace: true }) }
  return <div className="app-shell">
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-top"><Logo dark/><button className="collapse-button" onClick={()=>setCollapsed(!collapsed)} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'}>{collapsed?<ChevronRight size={18}/>:<PanelLeftClose size={17}/>}</button><button className="close-mobile" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div>
      <div className="workspace-context-wrap"><button className="workspace-switch" onClick={()=>setContextOpen(!contextOpen)} aria-expanded={contextOpen}><span className="workspace-icon">{workspaceName[0]?.toUpperCase()}</span><span><b>{workspaceName}</b><small>{activeContext?.dataset_ids.length && activeContext.dataset_ids.length>1 ? `${activeContext.dataset_ids.length} datasets · exact context` : dataset ? `${dataset.row_count.toLocaleString()} records` : 'Connect a data source'}</small></span>{contextSwitching?<span className="spinner"/>:<ChevronDown size={14}/>}</button>{contextOpen&&<div className="workspace-context-menu"><header><span>BUSINESS CONTEXT</span><Link to="/onboarding"><Plus size={12}/> Add or analyze data</Link></header>{orderedContexts.map((context)=><div className={`workspace-context-option ${context.id===analysis?.id?'active':''}`} key={context.id}><button onClick={()=>{void switchContext(context.id)}}><span>{context.dataset_names.map((name)=><b key={name}>{name}</b>)}</span><small>{context.dataset_ids.length>1?'Comparative context':'Single dataset'} · {context.status} · {context.forecast_confidence===null?'confidence unavailable':`${Math.round(context.forecast_confidence)}% confidence`}</small>{context.id===analysis?.id&&<Check size={12}/>}</button><button className={pinnedContexts.includes(context.id)?'pinned':''} title={pinnedContexts.includes(context.id)?'Unpin context':'Pin context'} onClick={()=>togglePinnedContext(context.id)}><Pin size={11}/></button></div>)}</div>}</div>
      <nav className="app-nav">{navItems.map(({label, icon:Icon, path})=><NavLink key={label} to={path} end={path==='/app'} onClick={()=>setMobileOpen(false)}><Icon size={17}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><span className="sidebar-section-label">DATA</span><NavLink to="/onboarding"><Box size={17}/><span>Data Sources</span><em className="source-status"><i/> {dataset ? 'Live' : 'Connect'}</em></NavLink><span className="sidebar-section-label">SYSTEM</span><NavLink to="/app/settings"><Settings2 size={17}/><span>Settings</span></NavLink><div className="account-menu-wrap"><button className="account" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen}><span>{initials}</span><div><b>{user?.fullName}</b><small>{user?.email}</small></div><ChevronRight size={14}/></button>{accountOpen&&<div className="account-menu"><Link to="/app/settings" onClick={()=>setAccountOpen(false)}><UserRound size={13}/> Account</Link><Link to="/app/settings" onClick={()=>setAccountOpen(false)}><Settings2 size={13}/> Preferences</Link><Link to="/app/settings" onClick={()=>setAccountOpen(false)}><Languages size={13}/> Language</Link><Link to="/app/settings" onClick={()=>setAccountOpen(false)}><ShieldCheck size={13}/> Security</Link><button onClick={()=>{void signOut()}}><LogOut size={13}/> Sign out</button></div>}</div></div>
    </aside>
    <main className="app-main">
      <div className="app-utility"><button className="mobile-sidebar" onClick={()=>setMobileOpen(true)}><Menu size={18}/></button><ExecutiveSearch/><div><NotificationCenter/><NavLink className="back-site" to="/">View site <ArrowUpRight size={13}/></NavLink></div></div>
      <div className="app-content">{analysis&&<AnalysisStatusBanner key={`${analysis.id}:${analysis.status}:${analysis.retry_count}`} analysis={analysis} onAnalysisChange={setAnalysis}/>} {loading ? <div className="workspace-loading"><span className="spinner"/> Loading real metrics from Neon...</div> : workspaceError ? <div className="workspace-error panel"><ShieldAlert size={20}/><h2>We could not load this workspace.</h2><p>{workspaceError}</p><button className="button button-app" onClick={()=>window.location.reload()}>Try again</button></div> : <Outlet context={{ analysis, dataset, analytics, loading, error: workspaceError, refreshAnalysis } satisfies WorkspaceContext}/>}</div>
    </main>
  </div>
}

function useWorkspace() { return useOutletContext<WorkspaceContext>() }
function TodayRoute() { const navigate = useNavigate(); const { analysis, analytics } = useWorkspace(); return <TodayDashboard analysis={analysis} analytics={analytics} briefing={analysis?.briefing ?? null} setSection={(section)=>navigate(sectionPaths[section])}/> }
function TeamRoute() { const { analysis, dataset, analytics } = useWorkspace(); return <TeamOSPage analysis={analysis} dataset={dataset} analytics={analytics}/> }
function ForecastsRoute() { const { analysis, analytics } = useWorkspace(); return <ForecastsPage analysis={analysis} analytics={analytics}/> }
function InsightsRoute() { const { analysis, analytics } = useWorkspace(); return <InsightsPage analysis={analysis} analytics={analytics}/> }
function DecisionRoomRoute() { const { analytics, dataset, analysis } = useWorkspace(); return <DecisionRoomPage key={analysis?.id ?? 'no-analysis'} analytics={analytics} dataset={dataset} analysis={analysis}/> }
function MeetingsRoute() { const { analysis } = useWorkspace(); return <MeetingsPage key={analysis?.id ?? 'no-analysis'} analysis={analysis}/> }
function ReportsRoute() { const { analysis, dataset, analytics } = useWorkspace(); return <ReportsPage analysis={analysis} dataset={dataset} analytics={analytics}/> }
function SettingsRoute() { const { analysis, dataset, analytics } = useWorkspace(); return <SettingsPage analysis={analysis} dataset={dataset} analytics={analytics}/> }

function LandingRoute() {
  const navigate = useNavigate()
  const { user } = useAuth()
  return <Landing enterApp={() => navigate(user ? '/app' : '/login')} startOnboarding={() => navigate(user ? '/onboarding' : '/register')} />
}

function OnboardingRoute() {
  const navigate = useNavigate()
  return <ProtectedRoute><Onboarding onCancel={() => navigate('/app')} onComplete={() => navigate('/app', { replace: true })}/></ProtectedRoute>
}

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingRoute/>}/>
    <Route path="/login" element={<LoginPage mode="login"/>}/>
    <Route path="/register" element={<LoginPage mode="register"/>}/>
    <Route path="/shared/:token" element={<SharedReportPage/>}/>
    <Route path="/onboarding" element={<OnboardingRoute/>}/>
    <Route path="/app" element={<ProtectedRoute><AppShell/></ProtectedRoute>}>
      <Route index element={<TeamRoute/>}/>
      <Route path="team" element={<Navigate to="/app" replace/>}/>
      <Route path="briefing" element={<TodayRoute/>}/>
      <Route path="forecasts" element={<ForecastsRoute/>}/>
      <Route path="insights" element={<InsightsRoute/>}/>
      <Route path="simulator" element={<DecisionRoomRoute/>}/>
      <Route path="meetings" element={<MeetingsRoute/>}/>
      <Route path="reports" element={<ReportsRoute/>}/>
      <Route path="settings" element={<SettingsRoute/>}/>
    </Route>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes>
}
