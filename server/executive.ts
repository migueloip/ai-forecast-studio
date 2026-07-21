import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { query } from './db.js'
import { appError } from './errors/index.js'

export const personalities = ['executive', 'technical', 'founder', 'investor', 'consulting', 'board_meeting', 'academic', 'startup'] as const
export const riskTolerances = ['conservative', 'moderate', 'aggressive'] as const

export interface AiPreferences extends Record<string, unknown> {
  business_type: string
  priority: string
  forecast_horizon: string
  risk_tolerance: (typeof riskTolerances)[number]
  personality: (typeof personalities)[number]
  communication_style: string
  custom_instructions: string
  updated_at: string | null
}

const defaultPreferences: AiPreferences = {
  business_type: 'General business',
  priority: 'Business resilience',
  forecast_horizon: '6 months',
  risk_tolerance: 'moderate',
  personality: 'executive',
  communication_style: 'executive',
  custom_instructions: '',
  updated_at: null,
}

export async function getAiPreferences(userId: string) {
  const rows = await query<AiPreferences>('select business_type, priority, forecast_horizon, risk_tolerance, personality, communication_style, custom_instructions, updated_at from user_ai_preferences where user_id = $1', [userId])
  return rows[0] ?? defaultPreferences
}

export async function saveAiPreferences(userId: string, preferences: Omit<AiPreferences, 'updated_at'>) {
  const rows = await query<AiPreferences>(
    `insert into user_ai_preferences (user_id, business_type, priority, forecast_horizon, risk_tolerance, personality, communication_style, custom_instructions)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (user_id) do update set business_type=excluded.business_type, priority=excluded.priority,
       forecast_horizon=excluded.forecast_horizon, risk_tolerance=excluded.risk_tolerance,
       personality=excluded.personality, communication_style=excluded.communication_style,
       custom_instructions=excluded.custom_instructions, updated_at=now()
     returning business_type, priority, forecast_horizon, risk_tolerance, personality, communication_style, custom_instructions, updated_at`,
    [userId, preferences.business_type, preferences.priority, preferences.forecast_horizon, preferences.risk_tolerance, preferences.personality, preferences.communication_style, preferences.custom_instructions],
  )
  return rows[0]!
}

export function preferencesPrompt(preferences: AiPreferences) {
  return [
    `Business type: ${preferences.business_type}.`,
    `Always prioritize: ${preferences.priority}.`,
    `Preferred forecast horizon: ${preferences.forecast_horizon}. This preference never overrides the deterministic engine's validated horizon.`,
    `Risk tolerance: ${preferences.risk_tolerance}.`,
    `Communication personality: ${preferences.personality.replaceAll('_', ' ')}; style: ${preferences.communication_style}.`,
    preferences.custom_instructions ? `Additional user instructions: ${preferences.custom_instructions}` : '',
    'These preferences affect language and prioritization only. Never alter, invent, or recalculate deterministic numerical outputs.',
  ].filter(Boolean).join(' ')
}

async function requireOwnedDataset(userId: string, datasetId: string) {
  const rows = await query<{ id: string }>(`select d.id from datasets d join workspaces w on w.id=d.workspace_id where d.id=$1 and w.owner_user_id=$2`, [datasetId, userId])
  if (!rows[0]) throw appError('NOT_FOUND')
}

export async function getDatasetNote(userId: string, datasetId: string) {
  await requireOwnedDataset(userId, datasetId)
  const rows = await query<{ note: string; updated_at: string }>('select note, updated_at from dataset_notes where dataset_id=$1 and user_id=$2', [datasetId, userId])
  return rows[0] ?? { note: '', updated_at: null }
}

export async function saveDatasetNote(userId: string, datasetId: string, note: string) {
  await requireOwnedDataset(userId, datasetId)
  const rows = await query<{ note: string; updated_at: string }>(
    `insert into dataset_notes (dataset_id,user_id,note) values ($1,$2,$3)
     on conflict (dataset_id) do update set note=excluded.note, user_id=excluded.user_id, updated_at=now()
     returning note, updated_at`, [datasetId, userId, note],
  )
  return rows[0]!
}

export interface BookmarkRow extends Record<string, unknown> {
  id: string
  dataset_id: string | null
  resource_type: string
  resource_id: string
  title: string
  action_url: string
  metadata: Record<string, unknown>
  created_at: string
}

interface BookmarkInput {
  dataset_id: string | null
  resource_type: string
  resource_id: string
  title: string
  action_url: string
  metadata: Record<string, unknown>
}

export async function listBookmarks(userId: string) {
  return query<BookmarkRow>('select id,dataset_id,resource_type,resource_id,title,action_url,metadata,created_at from bookmarks where user_id=$1 order by created_at desc limit 100', [userId])
}

export async function saveBookmark(userId: string, input: BookmarkInput) {
  if (input.dataset_id) await requireOwnedDataset(userId, input.dataset_id)
  const rows = await query<BookmarkRow>(
    `insert into bookmarks (id,user_id,dataset_id,resource_type,resource_id,title,action_url,metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     on conflict (user_id,resource_type,resource_id) do update set title=excluded.title,action_url=excluded.action_url,metadata=excluded.metadata
     returning id,dataset_id,resource_type,resource_id,title,action_url,metadata,created_at`,
    [randomUUID(), userId, input.dataset_id, input.resource_type, input.resource_id, input.title, input.action_url, JSON.stringify(input.metadata)],
  )
  return rows[0]!
}

export async function removeBookmark(userId: string, bookmarkId: string) {
  const rows = await query<{ id: string }>('delete from bookmarks where id=$1 and user_id=$2 returning id', [bookmarkId, userId])
  return Boolean(rows[0])
}

export interface DecisionInput {
  datasetId: string
  analysisId?: string | null
  kind: string
  title: string
  verdict: string
  risk: string
  confidence: number | null
  score: number | null
  proposal: Record<string, unknown>
  result: Record<string, unknown>
}

export async function saveDecision(userId: string, input: DecisionInput) {
  await requireOwnedDataset(userId, input.datasetId)
  if (input.analysisId) {
    const owned = await query<{ id: string }>(`select a.id from analyses a join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id where a.id=$1 and w.owner_user_id=$2`, [input.analysisId, userId])
    if (!owned[0]) throw appError('NOT_FOUND')
  }
  const rows = await query<{ id: string; created_at: string }>(
    `insert into decision_records (id,user_id,dataset_id,analysis_id,kind,title,verdict,risk,confidence,score,proposal,result)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) returning id,created_at`,
    [randomUUID(), userId, input.datasetId, input.analysisId ?? null, input.kind, input.title, input.verdict, input.risk, input.confidence, input.score, JSON.stringify(input.proposal), JSON.stringify(input.result)],
  )
  return rows[0]!
}

interface DatasetExecutiveRow extends Record<string, unknown> {
  id: string
  filename: string
  analytics: {
    source?: { periods?: number }
    health?: { overall?: number; riskLevel?: string }
    forecasts?: { primaryMetric?: string; metrics?: Record<string, { confidence?: number } | null> }
  } | null
  created_at: string
}

interface AnalysisExecutiveRow extends Record<string, unknown> {
  id: string
  dataset_id: string
  status: string
  briefing: {
    headline?: string
    executiveSummary?: string
    forecastConfidence?: number
    insights?: Array<{ type?: string }>
  } | null
  created_at: string
  completed_at: string | null
}

export async function getExecutiveOverview(userId: string) {
  const [datasets, analyses, notifications, runs, counts, decisions] = await Promise.all([
    query<DatasetExecutiveRow>(`select d.id,d.filename,d.analytics,d.created_at from datasets d join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 order by d.created_at desc`, [userId]),
    query<AnalysisExecutiveRow>(`select a.id,a.dataset_id,a.status,a.briefing,a.created_at,a.completed_at from analyses a join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 order by a.created_at desc limit 50`, [userId]),
    query<{ id: string; title: string; message: string; severity: string; action_url: string | null; created_at: string; read_at: string | null }>('select id,title,message,severity,action_url,created_at,read_at from notifications where user_id=$1 order by created_at desc limit 12', [userId]),
    query<{ agent_key: string; agent_name: string; role: string; status: string; output: Record<string, unknown> | null; started_at: string | null; completed_at: string | null }>(`select r.agent_key,r.agent_name,r.role,r.status,r.output,r.started_at,r.completed_at from agent_runs r join analyses a on a.id=r.analysis_id join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 order by coalesce(r.completed_at,r.started_at) desc nulls last limit 6`, [userId]),
    query<{ conversations: number; decisions: number; bookmarks: number }>(`select
      (select count(*)::integer from team_conversations where user_id=$1) conversations,
      (select count(*)::integer from decision_records where user_id=$1) decisions,
      (select count(*)::integer from bookmarks where user_id=$1) bookmarks`, [userId]),
    query<{ id: string; dataset_id: string; title: string; verdict: string; risk: string; created_at: string }>('select id,dataset_id,title,verdict,risk,created_at from decision_records where user_id=$1 order by created_at desc limit 10', [userId]),
  ])
  const completed = analyses.filter((analysis) => analysis.status === 'completed' && analysis.briefing)
  const latest = completed[0]
  const forecastConfidence = typeof latest?.briefing?.forecastConfidence === 'number' ? latest.briefing.forecastConfidence : null
  const highPriorityRisks = datasets.filter((dataset) => dataset.analytics?.health?.riskLevel === 'HIGH').length
  const growthOpportunities = completed.slice(0, 5).reduce((sum, analysis) => sum + (analysis.briefing?.insights?.filter((item) => item.type === 'growth' || item.type === 'opportunity').length ?? 0), 0)
  const businessAlerts = notifications.filter((notification) => !notification.read_at && ['warning', 'error'].includes(notification.severity)).length
  const latestAnalysisByDataset = new Set(completed.map((analysis) => analysis.dataset_id))
  const decidedDatasets = new Set(decisions.map((decision) => decision.dataset_id))
  const pendingDecisions = [...latestAnalysisByDataset].filter((datasetId) => !decidedDatasets.has(datasetId)).length
  const timeline = [
    ...notifications.map((item) => ({ id: `notification:${item.id}`, title: item.title, detail: item.message, type: 'notification', createdAt: item.created_at, actionUrl: item.action_url })),
    ...decisions.map((item) => ({ id: `decision:${item.id}`, title: item.verdict, detail: item.title, type: 'decision', createdAt: item.created_at, actionUrl: '/app/simulator' })),
    ...datasets.slice(0, 5).map((item) => ({ id: `dataset:${item.id}`, title: 'Business data connected', detail: item.filename, type: 'dataset', createdAt: item.created_at, actionUrl: '/onboarding' })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 12)
  const businesses = datasets.map((dataset) => {
    const primaryMetric = dataset.analytics?.forecasts?.primaryMetric
    const primaryForecast = primaryMetric ? dataset.analytics?.forecasts?.metrics?.[primaryMetric] : null
    return { id: dataset.id, name: dataset.filename.replace(/\.[^.]+$/, ''), businessHealth: Number(dataset.analytics?.health?.overall ?? 0), risk: String(dataset.analytics?.health?.riskLevel ?? 'UNKNOWN'), confidence: typeof primaryForecast?.confidence === 'number' ? primaryForecast.confidence : null }
  })
  return {
    stats: { businessesAnalyzed: latestAnalysisByDataset.size, forecastConfidence, businessAlerts, pendingDecisions, highPriorityRisks, growthOpportunities },
    teamStatus: runs,
    notifications: notifications.slice(0, 5),
    timeline,
    memory: { businessContexts: datasets.length, datasetHistory: datasets.length, forecastHistory: completed.length, recommendations: completed.length, decisions: counts[0]?.decisions ?? 0, specialistConversations: counts[0]?.conversations ?? 0, bookmarks: counts[0]?.bookmarks ?? 0 },
    businesses,
  }
}

export async function executiveSearch(userId: string, searchText: string, activeDatasetIds: string[] = []) {
  const q = searchText.trim().slice(0, 200)
  const lower = q.toLowerCase()
  const semanticTerm = lower.includes('pricing') || lower.includes('price') ? 'pricing'
    : lower.includes('maya') ? 'Maya'
      : lower.includes('risk') ? 'risk'
        : lower.includes('confidence') ? 'confidence'
          : lower.includes('inventory') ? 'inventory'
            : lower.includes('forecast') ? 'forecast'
              : q
  const like = `%${semanticTerm}%`
  const scopedIds = [...new Set(activeDatasetIds)].sort()
  const contextKey = scopedIds.join(',')
  const [datasets, analyses, messages, decisions, bookmarks, specialistRuns] = await Promise.all([
    query<DatasetExecutiveRow>(`select d.id,d.filename,d.analytics,d.created_at from datasets d join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 order by d.created_at desc limit 100`, [userId]),
    query<AnalysisExecutiveRow>(`select a.id,a.dataset_id,a.status,a.briefing,a.created_at,a.completed_at from analyses a join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 and (a.mission ilike $2 or coalesce(a.briefing::text,'') ilike $2) and ($4::integer=0 or (select array_agg(ad.dataset_id::text order by ad.dataset_id::text) from analysis_datasets ad where ad.analysis_id=a.id)=$3::text[]) order by a.created_at desc limit 8`, [userId, like, scopedIds, scopedIds.length]),
    query<{ id: string; content: string; created_at: string; conversation_id: string; analysis_id: string }>(`select m.id,m.content,m.created_at,m.conversation_id,c.analysis_id from team_messages m join team_conversations c on c.id=m.conversation_id where c.user_id=$1 and m.content ilike $2 and ($4::integer=0 or c.context_key=$5 or ($4::integer>1 and (select count(*) from team_conversation_datasets cd where cd.conversation_id=c.id)=1 and exists(select 1 from team_conversation_datasets cd where cd.conversation_id=c.id and cd.dataset_id::text=any($3::text[])))) order by m.created_at desc limit 8`, [userId, like, scopedIds, scopedIds.length, contextKey]),
    query<{ id: string; title: string; verdict: string; risk: string; score: number | null; created_at: string }>(`select id,title,verdict,risk,score,created_at from decision_records where user_id=$1 and (title ilike $2 or kind ilike $2 or verdict ilike $2) and ($4::integer=0 or dataset_id::text=any($3::text[])) order by created_at desc limit 8`, [userId, like, scopedIds, scopedIds.length]),
    query<BookmarkRow>(`select id,dataset_id,resource_type,resource_id,title,action_url,metadata,created_at from bookmarks where user_id=$1 and title ilike $2 and ($4::integer=0 or dataset_id is null or dataset_id::text=any($3::text[])) order by created_at desc limit 8`, [userId, like, scopedIds, scopedIds.length]),
    query<{ id: string; agent_name: string; role: string; analysis_id: string; output: { headline?: string; summary?: string; recommendation?: string } | null; completed_at: string | null }>(`select r.id,r.agent_name,r.role,r.analysis_id,r.output,r.completed_at from agent_runs r join analyses a on a.id=r.analysis_id join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 and (r.agent_name ilike $2 or r.role ilike $2 or coalesce(r.output::text,'') ilike $2) and ($4::integer=0 or (select array_agg(ad.dataset_id::text order by ad.dataset_id::text) from analysis_datasets ad where ad.analysis_id=a.id)=$3::text[]) order by r.completed_at desc nulls last limit 8`, [userId, like, scopedIds, scopedIds.length]),
  ])
  let answer = ''
  if (lower.includes('highest') && lower.includes('risk')) {
    const ranked = datasets.map((dataset) => ({ dataset, score: Number(dataset.analytics?.health?.overall ?? 100), risk: String(dataset.analytics?.health?.riskLevel ?? 'UNKNOWN') })).sort((a, b) => a.score - b.score)
    const top = ranked[0]
    if (top) answer = `${top.dataset.filename} has the highest current exposure: ${top.risk} risk and Business Health ${top.score}/100.`
  } else if (lower.includes('highest') && lower.includes('confidence')) {
    const ranked = datasets.map((dataset) => {
      const primaryMetric = dataset.analytics?.forecasts?.primaryMetric
      return { dataset, confidence: Number(primaryMetric ? dataset.analytics?.forecasts?.metrics?.[primaryMetric]?.confidence ?? -1 : -1) }
    }).sort((a, b) => b.confidence - a.confidence)
    const top = ranked[0]
    if (top && top.confidence >= 0) answer = `${top.dataset.filename} has the highest persisted forecast confidence at ${top.confidence}%.`
  }
  const results = [
    ...datasets.filter((item) => item.filename.toLowerCase().includes(lower)).slice(0, 5).map((item) => ({ id: `dataset:${item.id}`, type: 'Dataset', title: item.filename, detail: `${item.analytics?.source?.periods ?? 0} periods`, actionUrl: '/onboarding', createdAt: item.created_at })),
    ...analyses.map((item) => ({ id: `analysis:${item.id}`, type: 'Evidence', title: String(item.briefing?.headline ?? 'Specialist analysis'), detail: String(item.briefing?.executiveSummary ?? ''), actionUrl: `/app?context=${item.id}`, createdAt: item.created_at })),
    ...messages.map((item) => ({ id: `message:${item.id}`, type: 'Conversations', title: item.content.slice(0, 80), detail: item.content.slice(80, 220), actionUrl: `/app/meetings?conversation=${item.conversation_id}&context=${item.analysis_id}`, createdAt: item.created_at })),
    ...decisions.map((item) => ({ id: `decision:${item.id}`, type: 'Decision', title: item.title, detail: `${item.verdict} · ${item.risk} risk${item.score === null ? '' : ` · ${item.score}/100`}`, actionUrl: '/app/simulator', createdAt: item.created_at })),
    ...bookmarks.map((item) => ({ id: `bookmark:${item.id}`, type: 'Bookmark', title: item.title, detail: item.resource_type, actionUrl: item.action_url, createdAt: item.created_at })),
    ...specialistRuns.map((item) => ({ id: `specialist:${item.id}`, type: 'Evidence', title: item.output?.headline ?? `${item.agent_name} specialist finding`, detail: `${item.agent_name} · ${item.output?.recommendation ?? item.output?.summary ?? item.role}`, actionUrl: `/app?context=${item.analysis_id}`, createdAt: item.completed_at ?? new Date(0).toISOString() })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 18)
  return { answer, results }
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createShareLink(userId: string, analysisId: string, reportType: string) {
  const rows = await query<{ analysis: Record<string, unknown>; dataset: Record<string, unknown>; analytics: Record<string, unknown> | null; filename: string }>(
    `select jsonb_build_object('id',a.id,'status',a.status,'briefing',a.briefing,'createdAt',a.created_at,'completedAt',a.completed_at) as analysis,
       jsonb_build_object('id',d.id,'filename',d.filename,'rowCount',d.row_count,'createdAt',d.created_at) as dataset,
       d.analytics, d.filename
     from analyses a join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id
     where a.id=$1 and w.owner_user_id=$2`, [analysisId, userId],
  )
  const source = rows[0]
  if (!source) throw appError('NOT_FOUND')
  const token = randomBytes(32).toString('base64url')
  const title = `${reportType.replaceAll('_', ' ')} · ${source.filename}`
  const workspaceEvidence = await getExportBundle(userId, reportType)
  const snapshot = { title, reportType, generatedAt: new Date().toISOString(), dataset: source.dataset, analytics: source.analytics, analysis: source.analysis, workspaceEvidence }
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString()
  await query(`insert into share_links (id,user_id,token_hash,report_type,title,snapshot,expires_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [randomUUID(), userId, tokenHash(token), reportType, title, JSON.stringify(snapshot), expiresAt])
  return { token, title, expiresAt }
}

export async function getPublicShare(token: string) {
  const rows = await query<{ title: string; report_type: string; snapshot: Record<string, unknown>; expires_at: string | null; created_at: string }>(`select title,report_type,snapshot,expires_at,created_at from share_links where token_hash=$1 and revoked_at is null and (expires_at is null or expires_at>now())`, [tokenHash(token)])
  return rows[0] ?? null
}

export async function getExportBundle(userId: string, scope: string) {
  const [datasets, analyses, decisions, meetings, bookmarks] = await Promise.all([
    query<{ id: string; filename: string; row_count: number; analytics: Record<string, unknown> | null; created_at: string }>(`select d.id,d.filename,d.row_count,d.analytics,d.created_at from datasets d join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 order by d.created_at desc`, [userId]),
    query<{ id: string; status: string; briefing: Record<string, unknown> | null; created_at: string; completed_at: string | null }>(`select a.id,a.status,a.briefing,a.created_at,a.completed_at from analyses a join datasets d on d.id=a.dataset_id join workspaces w on w.id=d.workspace_id where w.owner_user_id=$1 order by a.created_at desc`, [userId]),
    query<{ id: string; title: string; kind: string; verdict: string; risk: string; confidence: number | null; score: number | null; proposal: Record<string, unknown>; result: Record<string, unknown>; created_at: string }>('select id,title,kind,verdict,risk,confidence,score,proposal,result,created_at from decision_records where user_id=$1 order by created_at desc', [userId]),
    query<{ id: string; title: string; target_agent_key: string; dataset_names: string[]; messages: unknown; created_at: string }>(`select c.id,c.title,c.target_agent_key,c.created_at,
      array_agg(distinct d.filename order by d.filename) as dataset_names,
      coalesce((select jsonb_agg(jsonb_build_object('role',m.role,'agentKey',m.agent_key,'content',m.content,'evidence',m.evidence,'confidence',m.confidence,'createdAt',m.created_at) order by m.created_at) from team_messages m where m.conversation_id=c.id),'[]'::jsonb) messages
      from team_conversations c join team_conversation_datasets cd on cd.conversation_id=c.id join datasets d on d.id=cd.dataset_id
      where c.user_id=$1 group by c.id order by c.created_at desc`, [userId]),
    listBookmarks(userId),
  ])
  const normalizedScope = scope.replaceAll('-', '_')
  const bundle: Record<string, unknown> = { scope: normalizedScope, generatedAt: new Date().toISOString() }
  if (['executive_brief','forecast_report','risk_report','recommendations','business_health','comparative_analysis','all'].includes(normalizedScope)) {
    bundle.datasets = datasets
    bundle.analyses = analyses
  }
  if (['decision_room','all'].includes(normalizedScope)) bundle.decisions = decisions
  if (['team_meetings','all'].includes(normalizedScope)) bundle.teamMeetings = meetings
  if (normalizedScope === 'all') bundle.bookmarks = bookmarks
  return bundle
}
