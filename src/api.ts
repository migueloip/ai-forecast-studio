import { errorFromResponse, networkError } from './errors'

export interface ColumnProfile {
  name: string
  type: 'date' | 'number' | 'boolean' | 'string'
  role: 'date' | 'revenue' | 'demand' | 'inventory' | 'price' | 'cost' | 'profit' | 'holiday' | 'external_regressor' | 'dimension' | 'metric'
  completeness: number
  uniqueCount: number
}

export interface DatasetProfile {
  rowCount: number
  columnCount: number
  completeness: number
  dateRange: { start: string; end: string } | null
  columns: ColumnProfile[]
  keyMetrics: string[]
  timeSeries: Array<{ period: string; values: Record<string, number> }>
  redactedColumns: string[]
}

export interface ApiDataset {
  id: string
  filename: string
  file_type: string
  row_count: number
  column_count: number
  columns: ColumnProfile[]
  summary: DatasetProfile
  created_at: string
  display_name: string | null
  archived_at: string | null
}

export interface DatasetHistoryItem {
  id: string
  filename: string
  display_name: string | null
  file_type: string
  row_count: number
  column_count: number
  file_size_bytes: number | null
  completeness: number
  date_range: { start: string; end: string } | null
  key_metrics: string[]
  analysis_count: number
  latest_analysis_status: Analysis['status'] | null
  latest_forecast_confidence: number | null
  note: string
  archived_at: string | null
  created_at: string
}

export interface Briefing {
  headline: string
  executiveSummary: string
  businessHealthScore: number
  forecastConfidence: number | null
  revenueForecast: {
    direction: 'growth' | 'decline' | 'stable' | null
    changePercent: number | null
    horizon: string
  }
  primaryRisk: {
    title: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    estimatedTiming: string
  }
  recommendation: {
    action: string
    expectedImpact: string
    confidence: number
    urgency: string
  }
  insights: Array<{
    title: string
    description: string
    evidence: string
    type: 'growth' | 'risk' | 'pattern' | 'opportunity'
  }>
}

export interface AgentRun {
  id: string
  agent_key: string
  agent_name: string
  role: string
  sequence: number
  status: 'queued' | 'running' | 'completed' | 'failed'
  input_summary: string | null
  output: unknown | null
  openai_response_id: string | null
  started_at: string | null
  completed_at: string | null
}

export interface Analysis {
  id: string
  dataset_id: string
  dataset_ids?: string[]
  dataset_context?: Array<{
    id: string
    name: string
    filename: string
    rowCount: number
    periods: number
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular'
  }>
  mission: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  model: string
  briefing: Briefing | null
  error: string | null
  failure_code: string | null
  failure_details: { failedAgent?: string | null; category?: string; recoveredAfterRestart?: boolean } | null
  retry_count: number
  started_at: string | null
  last_heartbeat_at: string | null
  invalidated_at: string | null
  created_at: string
  completed_at: string | null
  agents: AgentRun[]
}

export interface AnalysisContextSummary {
  id: string
  status: Analysis['status']
  dataset_ids: string[]
  dataset_names: string[]
  forecast_confidence: number | null
  created_at: string
  completed_at: string | null
}

export interface User {
  id: string
  email: string
  fullName: string
  createdAt: string
}

export interface TeamMeeting {
  responses: Array<{
    agentKey: MeetingAgentKey
    answer: string
    evidence: string
    confidence: number
  }>
  synthesis: string
}

export type MeetingAgentKey = 'data_engineer' | 'data_scientist' | 'forecast_specialist' | 'risk_analyst' | 'strategy_lead'
export type MeetingTarget = 'all' | MeetingAgentKey

export interface TeamChatMessage {
  id: string
  role: 'user' | 'agent' | 'synthesis'
  agent_key: MeetingAgentKey | null
  content: string
  evidence: string | null
  confidence: number | null
  created_at: string
  job_id: string | null
}

export type MeetingJobStatus = 'queued' | 'preparing' | 'running' | 'synthesizing' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export interface MeetingJob {
  id: string
  conversation_id: string
  analysis_id: string
  target_agent_key: MeetingTarget
  expected_agents: MeetingAgentKey[]
  completed_agents: MeetingAgentKey[]
  status: MeetingJobStatus
  stage: string
  attempt: number
  error_code: string | null
  error_message: string | null
  cancel_requested_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TeamConversation {
  id: string
  analysis_id: string
  context_key: string
  dataset_ids: string[]
  dataset_names: string[]
  context_mode: 'single' | 'comparative'
  title: string
  target_agent_key: MeetingTarget
  message_count: number
  last_message: string | null
  created_at: string
  updated_at: string
  job_status: MeetingJobStatus | null
  job_stage: string | null
  job_completed_count: number
  job_expected_count: number
  job?: MeetingJob | null
  messages?: TeamChatMessage[]
}

export interface TeamMeetingContext {
  analysisId: string
  contextKey: string
  mode: 'single' | 'comparative'
  datasets: Array<{
    id: string
    name: string
    rowCount: number
    periods: number
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular'
  }>
  forecastConfidence: number | null
  specialistPerspectives: number
}

export interface MetricSnapshot {
  column: string | null
  current: number | null
  previous: number | null
  total: number | null
  changePercent: number | null
}

export type ForecastMetricKey = 'revenue' | 'demand' | 'cost' | 'inventory' | 'profit' | 'kpi'

export interface ForecastModelEvaluation {
  key: string
  name: string
  family: 'statistical' | 'machine_learning' | 'deep_learning'
  status: 'evaluated' | 'rejected' | 'unavailable' | 'failed'
  reason: string
  advantages: string
  disadvantages: string
  requiredCharacteristics: string
  trainingTimeMs: number | null
  selectionScore: number | null
  stability: number | null
  confidence: number | null
  metrics: { mae: number; mse: number; rmse: number; mape: number | null; smape: number | null; mase: number | null; r2: number | null; normalizedRmse: number; accuracyPercentage: number } | null
  forecast: number[] | null
}

export interface MetricForecastIntelligence {
  metric: ForecastMetricKey
  column: string
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  validation: { method: string; folds: number; horizon: number; origins: number[]; randomSplit: false }
  diagnostics: {
    trend: { detected: boolean; direction: 'growth' | 'decline' | 'stable'; strength: number; slopePerPeriod: number }
    seasonality: { detected: boolean; period: number | null; strength: number; profile: Array<{ position: number; effect: number }> }
    regularity: number
    volatility: { coefficient: number; level: 'low' | 'medium' | 'high' }
    anomalies: Array<{ period: string; value: number; zScore: number }>
    correlations: Array<{ feature: string; coefficient: number }>
    holidayEffects: Array<{ month: number; effect: number; direction: 'spike' | 'dip'; reason: string }>
    marketingImpact: Array<{ feature: string; coefficient: number }>
    growthPattern: { compoundRatePerPeriod: number | null; direction: 'growth' | 'decline' | 'stable' }
    cyclicBehavior: boolean
  }
  models: ForecastModelEvaluation[]
  strategy: {
    type: 'single' | 'ensemble'
    selectedModels: string[]
    selectedName: string
    weights: Array<{ model: string; weight: number }>
    reason: string
    confidence: number
    confidenceMethodology: { score: number; components: Record<string, number>; weights: Record<string, number>; methodology: string }
    accuracyPercentage: number
    intervalMethod: string
    confidenceLevel: 95
  }
}

export interface MetricForecast {
  metric: ForecastMetricKey
  column: string
  model: string
  horizon: number
  trainingPeriods: number
  validationPeriods: number
  confidenceLevel: 95
  confidence: number
  accuracy: { mae: number; rmse: number; mape: number | null }
  changePercent: number | null
  points: Array<{ period: string; value: number; lower: number; upper: number }>
}

export interface DatasetAnalytics {
  version: 5
  generatedAt: string
  source: {
    rowCount: number
    completeness: number
    dateRange: { start: string; end: string } | null
    periods: number
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular'
  }
  metrics: {
    revenue: MetricSnapshot
    demand: MetricSnapshot
    cost: MetricSnapshot
    inventory: MetricSnapshot
    profit: MetricSnapshot
    kpi: MetricSnapshot
    grossProfit: number | null
    grossMarginPercent: number | null
  }
  series: Array<{
    period: string
    revenue: number | null
    demand: number | null
    cost: number | null
    inventory: number | null
    profit: number | null
    kpi: number | null
  }>
  forecasts: {
    horizon: number
    primaryMetric: ForecastMetricKey | null
    metrics: Record<ForecastMetricKey, MetricForecast | null>
  }
  intelligence: {
    status: 'ready' | 'fallback'
    engine: string
    engineVersion: string
    generatedAt: string
    datasetProfile: { type: string; problem: string; frequency: string; forecastableMetrics: ForecastMetricKey[] } | null
    forecasts: Record<ForecastMetricKey, MetricForecastIntelligence | null>
    message: string | null
  }
  health: {
    overall: number
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    components: Record<'revenue' | 'forecastReliability' | 'demandStability' | 'inventory' | 'growthPotential' | 'dataQuality', {
      score: number | null
      weight: number
      explanation: string
    }>
  }
  segments: Array<{ label: string; value: number; sharePercent: number }>
  segmentColumn: string | null
  primaryMetricColumn: string | null
}

export interface AppNotification {
  id: string
  type: string
  title: string
  message: string
  severity: 'info' | 'success' | 'warning' | 'error'
  action_url: string | null
  metadata: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export type AiPersonality = 'executive' | 'technical' | 'founder' | 'investor' | 'consulting' | 'board_meeting' | 'academic' | 'startup'
export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive'

export interface AiPreferences {
  business_type: string
  priority: string
  forecast_horizon: string
  risk_tolerance: RiskTolerance
  personality: AiPersonality
  communication_style: string
  custom_instructions: string
  updated_at: string | null
}

export interface AiCredentialStatus {
  configured: boolean
  source: 'user' | 'server' | 'none'
  provider: 'nvidia' | 'server'
  maskedKey: string | null
  model: string
  baseUrl: string
  encryptedAtRest: boolean
  encryptionReady: boolean
  updatedAt: string | null
}

export interface Bookmark {
  id: string
  dataset_id: string | null
  resource_type: string
  resource_id: string
  title: string
  action_url: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface ExecutiveOverview {
  stats: { businessesAnalyzed: number; forecastConfidence: number | null; businessAlerts: number; pendingDecisions: number; highPriorityRisks: number; growthOpportunities: number }
  teamStatus: Array<{ agent_key: string; agent_name: string; role: string; status: AgentRun['status']; output: unknown; started_at: string | null; completed_at: string | null }>
  notifications: Array<Pick<AppNotification, 'id' | 'title' | 'message' | 'severity' | 'action_url' | 'created_at' | 'read_at'>>
  timeline: Array<{ id: string; title: string; detail: string; type: string; createdAt: string; actionUrl: string | null }>
  memory: { businessContexts: number; datasetHistory: number; forecastHistory: number; recommendations: number; decisions: number; specialistConversations: number; bookmarks: number }
  businesses: Array<{ id: string; name: string; businessHealth: number; risk: string; confidence: number | null }>
}

export interface ExecutiveSearchResult {
  id: string
  type: string
  title: string
  detail: string
  actionUrl: string
  createdAt: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD'
  const transientStatuses = new Set([502, 503, 504])
  let response: Response | null = null
  for (let attempt = 0; attempt < (canRetry ? 3 : 1); attempt += 1) {
    try {
      response = await fetch(url, { ...init, credentials: 'include' })
    } catch {
      if (!canRetry || attempt === 2) throw networkError()
      await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
      continue
    }
    if (!transientStatuses.has(response.status) || !canRetry || attempt === 2) break
    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
  }
  if (!response) throw networkError()
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok) throw errorFromResponse(body, response.status, response.headers.get('x-request-id'))
  if (body === null && response.status !== 204) throw errorFromResponse(null, 500, response.headers.get('x-request-id'))
  return body as T
}

export async function ingestDataset(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request<{ dataset: ApiDataset; reused: boolean }>('/api/datasets/ingest', { method: 'POST', body: formData })
}

export function createSampleDataset() {
  return request<{ dataset: ApiDataset; reused: boolean }>('/api/datasets/sample', { method: 'POST' })
}

export function startAnalysis(datasetIds: string[]) {
  return request<{ analysisId: string; status: string }>('/api/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      datasetIds,
      mission: 'Forecast revenue and demand over the validated forecast horizon, identify the most material business risk, and recommend the best next action using the detected time frequency.',
    }),
  })
}

export function recalculateForecast(datasetIds: string[]) {
  return request<{ recalculated: number }>('/api/datasets/recalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetIds }),
  })
}

export function listDatasets(includeArchived = false) {
  return request<{ datasets: DatasetHistoryItem[] }>(`/api/datasets${includeArchived ? '?archived=true' : ''}`)
}

export function getDataset(datasetId: string) {
  return request<{ dataset: ApiDataset }>(`/api/datasets/${encodeURIComponent(datasetId)}`)
}

export function getDatasetAnalytics(datasetId: string) {
  return request<{ analytics: DatasetAnalytics }>(`/api/datasets/${encodeURIComponent(datasetId)}/analytics`)
}

export function renameDataset(datasetId: string, displayName: string) {
  return request<{ dataset: ApiDataset }>(`/api/datasets/${encodeURIComponent(datasetId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) })
}

export function archiveDataset(datasetId: string, archived = true) {
  return request<{ dataset: ApiDataset }>(`/api/datasets/${encodeURIComponent(datasetId)}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) })
}

export function deleteDataset(datasetId: string, confirmation: string) {
  return request<never>(`/api/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation }) })
}

export function updateDatasetMapping(datasetId: string, mapping: Array<{ name: string; role: ColumnProfile['role'] }>) {
  return request<{ dataset: ApiDataset; invalidated: true; message: string }>(`/api/datasets/${encodeURIComponent(datasetId)}/mapping`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping }) })
}

export function getAnalysis(analysisId: string) {
  return request<{ analysis: Analysis }>(`/api/analyses/${analysisId}`)
}

export function listAnalysisContexts() {
  return request<{ contexts: AnalysisContextSummary[] }>('/api/analysis-contexts')
}

export function retryAnalysis(analysisId: string) {
  return request<{ analysisId: string; status: string }>(`/api/analyses/${analysisId}/retry`, { method: 'POST' })
}

export function getLatestAnalysis() {
  return request<{ analysis: Analysis | null }>('/api/analyses/latest/current')
}

export function getLatestDataset() {
  return request<{ dataset: ApiDataset | null }>('/api/datasets/latest/current')
}

export function getLatestDatasetAnalytics() {
  return request<{ analytics: DatasetAnalytics | null }>('/api/datasets/latest/current/analytics')
}

export function getCurrentUser() {
  return request<{ user: User }>('/api/auth/me')
}

export function login(email: string, password: string, turnstileToken: string) {
  return request<{ user: User }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken }),
  })
}

export function register(fullName: string, email: string, password: string, turnstileToken: string) {
  return request<{ user: User }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName, email, password, turnstileToken }),
  })
}

export async function logout() {
  await request<never>('/api/auth/logout', { method: 'POST' })
}

export function askTeam(question: string, target: MeetingTarget, analysisId: string, conversationId?: string) {
  return request<{ job: MeetingJob; conversation: TeamConversation & { messages: TeamChatMessage[] } }>('/api/team/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, target, conversationId, analysisId }),
  })
}

export function getTeamConversations(analysisId: string) {
  return request<{ conversations: TeamConversation[]; context: TeamMeetingContext }>(`/api/team/conversations?analysisId=${encodeURIComponent(analysisId)}`)
}

export function getTeamConversation(conversationId: string, analysisId: string) {
  return request<{ conversation: TeamConversation & { messages: TeamChatMessage[] } }>(`/api/team/conversations/${encodeURIComponent(conversationId)}?analysisId=${encodeURIComponent(analysisId)}`)
}

export function getTeamConversationContext(conversationId: string) {
  return request<{ context: { analysisId: string; contextKey: string; datasetIds: string[] } }>(`/api/team/conversations/${encodeURIComponent(conversationId)}/context`)
}

export function getMeetingJob(jobId: string) {
  return request<{ job: MeetingJob }>(`/api/team/jobs/${encodeURIComponent(jobId)}`)
}

export function cancelMeetingJob(jobId: string) {
  return request<{ job: MeetingJob }>(`/api/team/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
}

export function retryMeetingJob(jobId: string) {
  return request<{ job: MeetingJob }>(`/api/team/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' })
}

export function getNotifications(limit = 30) {
  return request<{ notifications: AppNotification[]; unreadCount: number }>(`/api/notifications?limit=${limit}`)
}

export function markNotificationRead(notificationId: string) {
  return request<{ notification: AppNotification }>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead() {
  return request<{ updated: number }>('/api/notifications/read-all', { method: 'POST' })
}

export function getExecutiveOverview() {
  return request<{ overview: ExecutiveOverview }>('/api/executive/overview')
}

export function executiveSearch(q: string, analysisId?: string) {
  const context = analysisId ? `&analysisId=${encodeURIComponent(analysisId)}` : ''
  return request<{ answer: string; results: ExecutiveSearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}${context}`)
}

export function getAiPreferences() {
  return request<{ preferences: AiPreferences }>('/api/preferences')
}

export function saveAiPreferences(preferences: AiPreferences) {
  return request<{ preferences: AiPreferences }>('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) })
}

export function getAiCredential() {
  return request<{ credential: AiCredentialStatus }>('/api/ai-credential')
}

export function saveNvidiaCredential(apiKey: string, model: string) {
  return request<{ credential: AiCredentialStatus }>('/api/ai-credential', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, model }),
  })
}

export function deleteAiCredential() {
  return request<{ credential: AiCredentialStatus }>('/api/ai-credential', { method: 'DELETE' })
}

export function testNvidiaCredential(apiKey: string, model: string) {
  return request<{ ok: true; model: string }>('/api/ai-credential/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, model }),
  })
}

export function getDatasetNote(datasetId: string) {
  return request<{ note: { note: string; updated_at: string | null } }>(`/api/datasets/${encodeURIComponent(datasetId)}/note`)
}

export function saveDatasetNote(datasetId: string, note: string) {
  return request<{ note: { note: string; updated_at: string | null } }>(`/api/datasets/${encodeURIComponent(datasetId)}/note`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
}

export function listBookmarks() {
  return request<{ bookmarks: Bookmark[] }>('/api/bookmarks')
}

export function createBookmark(input: { datasetId?: string | null; resourceType: string; resourceId: string; title: string; actionUrl: string }) {
  return request<{ bookmark: Bookmark }>('/api/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function deleteBookmark(bookmarkId: string) {
  return request<never>(`/api/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'DELETE' })
}

export function saveDecisionRecord(input: { datasetId: string; analysisId?: string | null; kind: string; title: string; verdict: string; risk: string; confidence: number | null; score: number | null; proposal: Record<string, unknown>; result: Record<string, unknown> }) {
  return request<{ decision: { id: string; created_at: string } }>('/api/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function createShareLink(analysisId: string, reportType: string) {
  return request<{ share: { token: string; title: string; expiresAt: string } }>('/api/reports/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId, reportType }) })
}

export function getExportBundle(scope: string) {
  return request<{ bundle: Record<string, unknown> }>(`/api/exports/${encodeURIComponent(scope)}`)
}

export function getPublicReport(token: string) {
  return request<{ report: { title: string; report_type: string; snapshot: Record<string, unknown>; expires_at: string | null; created_at: string } }>(`/api/public/reports/${encodeURIComponent(token)}`)
}
