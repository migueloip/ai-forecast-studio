import { Bot, Bookmark, Check, Database, Eye, EyeOff, KeyRound, LockKeyhole, Save, Trash2, UserRound, Zap } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  deleteAiCredential, getAiCredential, getAiPreferences, getDatasetNote, listBookmarks, saveAiPreferences,
  saveDatasetNote, saveNvidiaCredential, testNvidiaCredential,
  type AiCredentialStatus, type AiPreferences, type Analysis, type ApiDataset, type Bookmark as BookmarkRecord, type DatasetAnalytics,
} from '../api'
import { useAuth } from '../auth'
import { safeErrorMessage } from '../errors'
import { formatPercent, frequencyLabel } from '../format'

const defaultPreferences: AiPreferences = { business_type: 'General business', priority: 'Business resilience', forecast_horizon: '6 months', risk_tolerance: 'moderate', personality: 'executive', communication_style: 'executive', custom_instructions: '', updated_at: null }
const personalities: AiPreferences['personality'][] = ['executive','technical','founder','investor','consulting','board_meeting','academic','startup']
const defaultCredential: AiCredentialStatus = { configured: false, source: 'none', provider: 'nvidia', maskedKey: null, model: 'openai/gpt-oss-120b', baseUrl: 'https://integrate.api.nvidia.com/v1', encryptedAtRest: false, encryptionReady: false, updatedAt: null }

export function SettingsPage({ dataset, analytics, analysis }: { dataset: ApiDataset | null; analytics: DatasetAnalytics | null; analysis: Analysis | null }) {
  const { user } = useAuth()
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [note, setNote] = useState('')
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [credential, setCredential] = useState(defaultCredential)
  const [nvidiaApiKey, setNvidiaApiKey] = useState('')
  const [nvidiaModel, setNvidiaModel] = useState(defaultCredential.model)
  const [showApiKey, setShowApiKey] = useState(false)
  const [credentialAction, setCredentialAction] = useState<'save' | 'test' | 'delete' | null>(null)
  const [credentialMessage, setCredentialMessage] = useState('')
  const [credentialError, setCredentialError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getAiPreferences(), getAiCredential(), listBookmarks(), dataset ? getDatasetNote(dataset.id) : Promise.resolve({ note: { note: '', updated_at: null } })])
      .then(([preferenceResult, credentialResult, bookmarkResult, noteResult]) => { if (active) { setPreferences(preferenceResult.preferences); setCredential(credentialResult.credential); setNvidiaModel(credentialResult.credential.model); setBookmarks(bookmarkResult.bookmarks); setNote(noteResult.note.note) } })
      .catch((cause) => { if (active) setError(safeErrorMessage(cause, 'Workspace preferences could not be loaded.')) })
    return () => { active = false }
  }, [dataset])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      setSaving(true); setSaved(false); setError('')
      const tasks: Promise<unknown>[] = [saveAiPreferences(preferences)]
      if (dataset) tasks.push(saveDatasetNote(dataset.id, note))
      await Promise.all(tasks)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2_500)
    } catch (cause) {
      setError(safeErrorMessage(cause, 'Your AI Team settings could not be saved.'))
    } finally { setSaving(false) }
  }

  const saveCredential = async () => {
    setCredentialAction('save'); setCredentialError(''); setCredentialMessage('')
    try {
      const result = await saveNvidiaCredential(nvidiaApiKey, nvidiaModel)
      setCredential(result.credential); setNvidiaApiKey(''); setShowApiKey(false)
      setCredentialMessage('NVIDIA API key encrypted and saved for this account.')
    } catch (cause) {
      setCredentialError(safeErrorMessage(cause, 'The NVIDIA API key could not be saved.'))
    } finally { setCredentialAction(null) }
  }

  const testCredential = async () => {
    setCredentialAction('test'); setCredentialError(''); setCredentialMessage('')
    try {
      await testNvidiaCredential(nvidiaApiKey, nvidiaModel)
      setCredentialMessage(`Connection verified. ${nvidiaModel} is available for this key.`)
    } catch (cause) {
      setCredentialError(safeErrorMessage(cause, 'NVIDIA could not verify this key and model.'))
    } finally { setCredentialAction(null) }
  }

  const removeCredential = async () => {
    if (!window.confirm('Remove your saved NVIDIA API key? This cannot be undone.')) return
    setCredentialAction('delete'); setCredentialError(''); setCredentialMessage('')
    try {
      const result = await deleteAiCredential()
      setCredential(result.credential); setNvidiaModel(result.credential.model); setNvidiaApiKey('')
      setCredentialMessage(result.credential.configured ? 'Personal key removed. The server-managed provider is active.' : 'Personal key removed.')
    } catch (cause) {
      setCredentialError(safeErrorMessage(cause, 'The NVIDIA API key could not be removed.'))
    } finally { setCredentialAction(null) }
  }

  const update = <K extends keyof AiPreferences>(key: K, value: AiPreferences[K]) => setPreferences((current) => ({ ...current, [key]: value }))
  return <>
    <header className="app-header"><div><span>EXECUTIVE OPERATING SYSTEM</span><h1>Settings</h1></div><button form="ai-team-settings" className="button button-app" disabled={saving}>{saved ? <Check size={14}/> : <Save size={14}/>} {saving ? 'Saving...' : saved ? 'Saved' : 'Save settings'}</button></header>
    <section className="settings-grid">
      <article className="panel settings-card"><span><UserRound size={18}/></span><div><small>ACCOUNT</small><h2>{user?.fullName}</h2><p>{user?.email}</p></div><em>Active</em></article>
      <article className="panel settings-card"><span><Database size={18}/></span><div><small>BUSINESS CONTEXT</small><h2>{dataset?.display_name ?? dataset?.filename ?? 'Waiting for business data'}</h2><p>{dataset && analytics ? `${dataset.row_count.toLocaleString()} records · ${frequencyLabel(analytics.source.frequency,analytics.source.periods)} · ${formatPercent(analytics.source.completeness,{sign:false})} complete` : 'Upload a dataset to assemble your Executive AI Team.'}</p></div><em>{dataset?'Neon':'Waiting'}</em></article>
      <article className="panel settings-card"><span><Bot size={18}/></span><div><small>AI EXECUTIVE TEAM</small><h2>{preferences.personality.replaceAll('_',' ')}</h2><p>{analysis ? `${analysis.agents.length} persisted specialist runs · ${analysis.status}` : 'The AI Team is waiting for its first assignment.'}</p></div><em>{analysis?.status ?? 'Ready'}</em></article>
      <article className="panel settings-card"><span><LockKeyhole size={18}/></span><div><small>SECURITY</small><h2>Private workspace</h2><p>HttpOnly session, row ownership enforcement, redacted AI samples and scoped business memory.</p></div><em>Protected</em></article>
    </section>
    <form id="ai-team-settings" className="settings-os-grid" onSubmit={(event) => { void submit(event) }}>
      <section className="panel api-credential-settings"><header><span><KeyRound size={12}/> NVIDIA BUILD / NIM</span><h2>Use your own NVIDIA API key.</h2><p>The key is sent once to this API, encrypted with AES-256-GCM, and stored only as ciphertext. It is never returned to the browser or exposed to other accounts.</p></header><div className="credential-status"><span className={credential.configured?'active':''}><i/>{credential.source==='user'?'Personal encrypted key':credential.source==='server'?'Server-managed key':'No provider configured'}</span><b>{credential.maskedKey ?? 'Add a key from build.nvidia.com'}</b><em>{credential.model}</em></div><div className="credential-fields"><label><span>NVIDIA API key</span><div className="credential-secret"><input type={showApiKey?'text':'password'} autoComplete="off" value={nvidiaApiKey} onChange={(event)=>setNvidiaApiKey(event.target.value)} maxLength={500} placeholder={credential.source==='user'?'Enter a new key to replace the saved one':'nvapi-...'}/><button type="button" onClick={()=>setShowApiKey((shown)=>!shown)} aria-label={showApiKey?'Hide API key':'Show API key'}>{showApiKey?<EyeOff size={14}/>:<Eye size={14}/>}</button></div></label><label><span>NVIDIA model ID</span><input value={nvidiaModel} onChange={(event)=>setNvidiaModel(event.target.value)} maxLength={160} placeholder="openai/gpt-oss-120b"/></label></div><div className="credential-actions"><button type="button" className="button button-ghost" disabled={Boolean(credentialAction)||(!nvidiaApiKey&&!(credential.configured&&credential.provider==='nvidia'))} onClick={()=>{void testCredential()}}><Zap size={13}/>{credentialAction==='test'?'Testing...':'Test connection'}</button><button type="button" className="button button-app" disabled={Boolean(credentialAction)||!nvidiaApiKey||!credential.encryptionReady} onClick={()=>{void saveCredential()}}><LockKeyhole size={13}/>{credentialAction==='save'?'Encrypting...':'Save encrypted key'}</button>{credential.source==='user'&&<button type="button" className="credential-delete" disabled={Boolean(credentialAction)} onClick={()=>{void removeCredential()}}><Trash2 size={13}/>{credentialAction==='delete'?'Removing...':'Remove personal key'}</button>}</div>{!credential.encryptionReady&&<p className="credential-warning">Set a valid CREDENTIAL_ENCRYPTION_KEY on the local API server before saving personal keys.</p>}{credentialMessage&&<p className="credential-success">{credentialMessage}</p>}{credentialError&&<p className="settings-save-error">{credentialError}</p>}</section>
      <section className="panel ai-instruction-settings"><header><span>CUSTOM AI TEAM INSTRUCTIONS</span><h2>Define how your Executive Team works.</h2><p>These preferences change prioritization and communication. Deterministic forecasts and persisted metrics are never altered.</p></header><div className="settings-field-grid"><label><span>My business is</span><input value={preferences.business_type} onChange={(event)=>update('business_type',event.target.value)} maxLength={100}/></label><label><span>Always prioritize</span><input value={preferences.priority} onChange={(event)=>update('priority',event.target.value)} maxLength={160}/></label><label><span>Preferred forecasting horizon</span><input value={preferences.forecast_horizon} onChange={(event)=>update('forecast_horizon',event.target.value)} maxLength={60}/></label><label><span>Risk tolerance</span><select value={preferences.risk_tolerance} onChange={(event)=>update('risk_tolerance',event.target.value as AiPreferences['risk_tolerance'])}><option value="conservative">Conservative</option><option value="moderate">Moderate</option><option value="aggressive">Aggressive</option></select></label><label><span>Communication style</span><input value={preferences.communication_style} onChange={(event)=>update('communication_style',event.target.value)} maxLength={80}/></label><label className="wide"><span>Standing instructions</span><textarea value={preferences.custom_instructions} onChange={(event)=>update('custom_instructions',event.target.value)} maxLength={1500} placeholder="Example: Always explain inventory exposure before growth opportunities."/></label></div></section>
      <section className="panel personality-settings"><header><span>AI TEAM PERSONALITY</span><h2>Choose the room you want to walk into.</h2></header><div>{personalities.map((personality)=><button type="button" key={personality} className={preferences.personality===personality?'active':''} onClick={()=>update('personality',personality)}><i/>{personality.replaceAll('_',' ')}{preferences.personality===personality&&<Check size={12}/>}</button>)}</div><p>Applied to recommendations, reports, Decision Room explanations and Team Meetings.</p></section>
      <section className="panel dataset-note-settings"><header><span>DATASET NOTES</span><h2>{dataset?.filename ?? 'No active business context'}</h2><p>Notes remain isolated to this dataset and help the team recognize its operational context.</p></header><textarea disabled={!dataset} value={note} onChange={(event)=>setNote(event.target.value)} maxLength={2000} placeholder={dataset?'Example: High-priority retail dataset; holiday inventory must be reviewed weekly.':'Connect a dataset before adding business notes.'}/></section>
      <section className="panel bookmark-settings"><header><span><Bookmark size={12}/> BOOKMARKS</span><h2>Saved executive evidence</h2></header><div>{bookmarks.slice(0,8).map((item)=><Link key={item.id} to={item.action_url}><span><b>{item.title}</b><small>{item.resource_type.replaceAll('_',' ')}</small></span><em>{new Intl.DateTimeFormat('en',{dateStyle:'medium'}).format(new Date(item.created_at))}</em></Link>)}{!bookmarks.length&&<p>Save forecasts, recommendations, decisions or reports to build your executive reading list.</p>}</div></section>
    </form>
    {error&&<p className="settings-save-error">{error}</p>}
    <section className="panel settings-detail"><span className="section-kicker">DATA POLICY</span><h2>Your source data stays scoped to this account.</h2><p>Complete records are stored in Neon. The inference provider receives the dataset profile, aggregates, redacted samples and prior verified specialist findings. Sensitive columns detected during ingestion are excluded from model samples.</p><div><span>Dataset analytics cache</span><b>{analytics ? `Generated ${new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(analytics.generatedAt))}` : 'The AI Team is waiting for business data'}</b></div><div><span>AI analysis</span><b>{analysis?.status ?? 'No forecast exists yet. Let’s build one.'}</b></div></section>
  </>
}
