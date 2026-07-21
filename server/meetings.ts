import { randomUUID } from 'node:crypto'
import { query } from './db.js'
import { appError } from './errors/index.js'

export const meetingAgentKeys = ['data_engineer', 'data_scientist', 'forecast_specialist', 'risk_analyst', 'strategy_lead'] as const
export type MeetingAgentKey = (typeof meetingAgentKeys)[number]
export type MeetingTarget = 'all' | MeetingAgentKey
export type MeetingJobStatus = 'queued' | 'preparing' | 'running' | 'synthesizing' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export interface MeetingDataset {
  id: string
  name: string
  rowCount: number
  periods: number
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular'
}

export interface MeetingContext {
  analysisId: string
  contextKey: string
  mode: 'single' | 'comparative'
  datasets: MeetingDataset[]
  forecastConfidence: number | null
  specialistPerspectives: number
}

export interface ConversationRow extends Record<string, unknown> {
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
}

export interface MessageRow extends Record<string, unknown> {
  id: string
  role: 'user' | 'agent' | 'synthesis'
  agent_key: MeetingAgentKey | null
  content: string
  evidence: string | null
  confidence: number | null
  created_at: string
  job_id: string | null
}

export interface MeetingJobRow extends Record<string, unknown> {
  id: string
  user_id: string
  conversation_id: string
  analysis_id: string
  question_message_id: string | null
  question: string
  target_agent_key: MeetingTarget
  expected_agents: MeetingAgentKey[]
  completed_agents: MeetingAgentKey[]
  status: MeetingJobStatus
  stage: string
  attempt: number
  error_code: string | null
  error_message: string | null
  technical_details: Record<string, unknown> | null
  cancel_requested_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface AnalysisContextRow extends Record<string, unknown> {
  id: string
  briefing: { forecastConfidence?: number | null } | null
}

interface DatasetContextRow extends Record<string, unknown> {
  id: string
  filename: string
  row_count: number
  periods: number
  frequency: MeetingDataset['frequency'] | null
}

export interface SpecialistMemoryRow extends Record<string, unknown> {
  agent_key: MeetingAgentKey
  content: string
  evidence: string | null
  title: string
  dataset_names: string[]
  created_at: string
}

export function canonicalDatasetIds(datasetIds: string[]) {
  return [...new Set(datasetIds)].sort((left, right) => left.localeCompare(right))
}

export function meetingContextKey(datasetIds: string[]) {
  return canonicalDatasetIds(datasetIds).join(',')
}

export function meetingConversationUrl(conversationId: string, analysisId: string) {
  return `/app/meetings?conversation=${encodeURIComponent(conversationId)}&context=${encodeURIComponent(analysisId)}`
}

export function isConversationContextVisible(activeDatasetIds: string[], conversationDatasetIds: string[]) {
  const active = canonicalDatasetIds(activeDatasetIds)
  const conversation = canonicalDatasetIds(conversationDatasetIds)
  if (active.length === 0 || conversation.length === 0) return false
  if (meetingContextKey(active) === meetingContextKey(conversation)) return true
  return active.length > 1 && conversation.length === 1 && active.includes(conversation[0]!)
}

export function isMeetingTarget(value: unknown): value is MeetingTarget {
  return value === 'all' || meetingAgentKeys.includes(value as MeetingAgentKey)
}

function displayDatasetName(filename: string) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename
}

export async function getMeetingContext(userId: string, analysisId?: string) {
  const analyses = analysisId
    ? await query<AnalysisContextRow>(
      `select a.id, a.briefing from analyses a
       join datasets d on d.id = a.dataset_id
       join workspaces w on w.id = d.workspace_id
       where a.id = $1 and w.owner_user_id = $2`,
      [analysisId, userId],
    )
    : await query<AnalysisContextRow>(
      `select a.id, a.briefing from analyses a
       join datasets d on d.id = a.dataset_id
       join workspaces w on w.id = d.workspace_id
       where w.owner_user_id = $1 order by a.created_at desc limit 1`,
      [userId],
    )
  const analysis = analyses[0]
  if (!analysis) return null
  const datasets = await query<DatasetContextRow>(
    `select d.id, d.filename, d.row_count, coalesce(d.analytics->'source'->>'frequency', 'irregular') as frequency,
       case when jsonb_typeof(d.summary->'timeSeries') = 'array' then jsonb_array_length(d.summary->'timeSeries') else 0 end as periods
     from analysis_datasets ad join datasets d on d.id = ad.dataset_id
     where ad.analysis_id = $1 order by d.id asc`,
    [analysis.id],
  )
  if (!datasets.length) return null
  const normalized: MeetingDataset[] = datasets.map((dataset) => ({
    id: dataset.id,
    name: displayDatasetName(dataset.filename),
    rowCount: Number(dataset.row_count),
    periods: Number(dataset.periods),
    frequency: dataset.frequency ?? 'irregular',
  }))
  const datasetIds = normalized.map((dataset) => dataset.id)
  return {
    analysisId: analysis.id,
    contextKey: meetingContextKey(datasetIds),
    mode: normalized.length > 1 ? 'comparative' : 'single',
    datasets: normalized,
    forecastConfidence: analysis.briefing?.forecastConfidence ?? null,
    specialistPerspectives: normalized.length * meetingAgentKeys.length,
  } satisfies MeetingContext
}

const conversationSelect = `
  select c.id, c.analysis_id,
    coalesce(c.context_key, string_agg(tcd.dataset_id::text, ',' order by tcd.dataset_id::text)) as context_key,
    array_agg(tcd.dataset_id::text order by tcd.dataset_id::text) as dataset_ids,
    array_agg(regexp_replace(d.filename, '\\.[^.]+$', '') order by tcd.dataset_id::text) as dataset_names,
    case when count(tcd.dataset_id) > 1 then 'comparative' else 'single' end as context_mode,
    c.title, c.target_agent_key,
    (select count(*)::integer from team_messages m where m.conversation_id = c.id) as message_count,
    (select m.content from team_messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) as last_message,
    (select j.status from meeting_jobs j where j.conversation_id = c.id order by j.created_at desc limit 1) as job_status,
    (select j.stage from meeting_jobs j where j.conversation_id = c.id order by j.created_at desc limit 1) as job_stage,
    coalesce((select cardinality(j.completed_agents) from meeting_jobs j where j.conversation_id = c.id order by j.created_at desc limit 1), 0)::integer as job_completed_count,
    coalesce((select cardinality(j.expected_agents) from meeting_jobs j where j.conversation_id = c.id order by j.created_at desc limit 1), 0)::integer as job_expected_count,
    c.created_at, c.updated_at
  from team_conversations c
  join team_conversation_datasets tcd on tcd.conversation_id = c.id
  join datasets d on d.id = tcd.dataset_id`

export async function listConversations(userId: string, activeDatasetIds: string[]) {
  const active = canonicalDatasetIds(activeDatasetIds)
  if (!active.length) return []
  const rows = await query<ConversationRow>(
    `${conversationSelect}
     where c.user_id = $1
     group by c.id
     having array_agg(tcd.dataset_id::text order by tcd.dataset_id::text) = $2::text[]
       or ($3::integer > 1 and count(tcd.dataset_id) = 1 and min(tcd.dataset_id::text) = any($2::text[]))
     order by c.updated_at desc`,
    [userId, active, active.length],
  )
  return rows
}

export async function getConversation(userId: string, conversationId: string, activeDatasetIds?: string[]) {
  const conversations = await query<ConversationRow>(
    `${conversationSelect}
     where c.id = $1 and c.user_id = $2
     group by c.id`,
    [conversationId, userId],
  )
  const conversation = conversations[0]
  if (!conversation) return null
  if (activeDatasetIds && !isConversationContextVisible(activeDatasetIds, conversation.dataset_ids)) return null
  const messages = await query<MessageRow>(
    `select id, role, agent_key, content, evidence, confidence, created_at, job_id
     from team_messages where conversation_id = $1 order by created_at asc, id asc`,
    [conversationId],
  )
  const job = await getLatestConversationJob(userId, conversationId)
  return { ...conversation, messages, job }
}

export async function getConversationLinkContext(userId: string, conversationId: string) {
  const rows = await query<{ analysis_id: string; context_key: string; dataset_ids: string[] }>(
    `select c.analysis_id, c.context_key,
       array_agg(tcd.dataset_id::text order by tcd.dataset_id::text) as dataset_ids
     from team_conversations c
     join team_conversation_datasets tcd on tcd.conversation_id = c.id
     where c.id = $1 and c.user_id = $2
     group by c.id`,
    [conversationId, userId],
  )
  return rows[0] ?? null
}

export async function createConversation(userId: string, analysisId: string, datasetIds: string[], target: MeetingTarget, firstQuestion: string) {
  const normalizedIds = canonicalDatasetIds(datasetIds)
  if (!normalizedIds.length) throw appError('ANALYSIS_REQUIRED')
  const id = randomUUID()
  const title = firstQuestion.trim().replace(/\s+/g, ' ').slice(0, 90)
  await query(
    `with inserted as (
       insert into team_conversations (id, user_id, analysis_id, context_key, title, target_agent_key)
       values ($1, $2, $3, $4, $5, $6) returning id
     )
     insert into team_conversation_datasets (conversation_id, dataset_id, position)
     select inserted.id, source.dataset_id, (source.ordinality - 1)::integer
     from inserted cross join unnest($7::uuid[]) with ordinality as source(dataset_id, ordinality)`,
    [id, userId, analysisId, meetingContextKey(normalizedIds), title, target, normalizedIds],
  )
  return id
}

export async function addMessage(conversationId: string, message: {
  role: MessageRow['role']
  agentKey?: MeetingAgentKey
  content: string
  evidence?: string
  confidence?: number
  jobId?: string
}) {
  const rows = await query<MessageRow>(
    `insert into team_messages (id, conversation_id, role, agent_key, content, evidence, confidence, job_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, role, agent_key, content, evidence, confidence, created_at, job_id`,
    [randomUUID(), conversationId, message.role, message.agentKey ?? null, message.content, message.evidence ?? null, message.confidence ?? null, message.jobId ?? null],
  )
  await query('update team_conversations set updated_at = now() where id = $1', [conversationId])
  return rows[0]!
}

const meetingJobSelect = `
  select j.*, coalesce(m.content, '') as question
  from meeting_jobs j
  left join team_messages m on m.id = j.question_message_id`

export async function createMeetingJob(
  userId: string,
  conversationId: string,
  analysisId: string,
  target: MeetingTarget,
  expectedAgents: MeetingAgentKey[],
  question: string,
) {
  const jobId = randomUUID()
  const messageId = randomUUID()
  let jobs: MeetingJobRow[]
  try {
    jobs = await query<MeetingJobRow>(
      `with inserted_message as (
       insert into team_messages (id, conversation_id, role, content)
       values ($2, $3, 'user', $7) returning id
     ), inserted_job as (
       insert into meeting_jobs (
         id, user_id, conversation_id, analysis_id, question_message_id,
         target_agent_key, expected_agents, status, stage
       ) select $1, $4, $3, $5, inserted_message.id, $6, $8::text[], 'queued', 'queued'
       from inserted_message returning *
     )
     select inserted_job.*, $7::text as question from inserted_job`,
      [jobId, messageId, conversationId, userId, analysisId, target, question, expectedAgents],
    )
  } catch (error) {
    const constraint = typeof error === 'object' && error !== null && 'constraint' in error ? String(error.constraint) : ''
    if (constraint === 'meeting_jobs_one_active_conversation_idx') throw appError('MEETING_IN_PROGRESS', { cause: error })
    throw error
  }
  await query('update team_conversations set updated_at = now() where id = $1', [conversationId])
  await addMeetingJobEvent(jobId, 'queued', { expectedAgents })
  return jobs[0]!
}

export async function getMeetingJob(userId: string, jobId: string) {
  const rows = await query<MeetingJobRow>(`${meetingJobSelect} where j.id = $1 and j.user_id = $2`, [jobId, userId])
  return rows[0] ?? null
}

export async function getMeetingJobInternal(jobId: string) {
  const rows = await query<MeetingJobRow>(`${meetingJobSelect} where j.id = $1`, [jobId])
  return rows[0] ?? null
}

export async function getLatestConversationJob(userId: string, conversationId: string) {
  const rows = await query<MeetingJobRow>(
    `${meetingJobSelect} where j.conversation_id = $1 and j.user_id = $2 order by j.created_at desc limit 1`,
    [conversationId, userId],
  )
  return rows[0] ?? null
}

export async function claimMeetingJob(jobId: string) {
  const rows = await query<MeetingJobRow>(
    `update meeting_jobs set status = 'preparing', stage = 'preparing_context', attempt = attempt + 1,
       started_at = coalesce(started_at, now()), updated_at = now()
     where id = $1 and status = 'queued' and cancel_requested_at is null returning *, ''::text as question`,
    [jobId],
  )
  return rows[0] ?? null
}

export async function updateMeetingJob(jobId: string, patch: {
  status?: MeetingJobStatus
  stage?: string
  errorCode?: string | null
  errorMessage?: string | null
  technicalDetails?: Record<string, unknown> | null
  completed?: boolean
}) {
  const rows = await query<MeetingJobRow>(
    `update meeting_jobs set
       status = coalesce($2, status), stage = coalesce($3, stage), error_code = $4,
       error_message = $5, technical_details = $6,
       completed_at = case when $7 then now() else completed_at end, updated_at = now()
     where id = $1 returning *, ''::text as question`,
    [jobId, patch.status ?? null, patch.stage ?? null, patch.errorCode ?? null, patch.errorMessage ?? null, patch.technicalDetails ?? null, patch.completed ?? false],
  )
  return rows[0] ?? null
}

export async function completeMeetingAgent(jobId: string, agentKey: MeetingAgentKey, messageId: string, durationMs: number) {
  await query(
    `update meeting_jobs set completed_agents = case when $2 = any(completed_agents) then completed_agents else array_append(completed_agents, $2) end,
       stage = $2 || '_completed', updated_at = now() where id = $1`,
    [jobId, agentKey],
  )
  await addMeetingJobEvent(jobId, 'specialist_completed', { durationMs }, agentKey, messageId)
}

export async function addMeetingJobEvent(
  jobId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
  agentKey?: MeetingAgentKey,
  messageId?: string,
) {
  await query(
    `insert into meeting_job_events (id, job_id, event_type, agent_key, message_id, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), jobId, eventType, agentKey ?? null, messageId ?? null, metadata],
  )
}

export async function requestMeetingJobCancellation(userId: string, jobId: string) {
  const rows = await query<MeetingJobRow>(
    `update meeting_jobs set cancel_requested_at = now(),
       status = case when status = 'queued' then 'cancelled' else status end,
       stage = case when status = 'queued' then 'cancelled' else 'cancellation_requested' end,
       error_code = case when status = 'queued' then 'USER_CANCELLED' else error_code end,
       error_message = case when status = 'queued' then 'This meeting was cancelled.' else error_message end,
       completed_at = case when status = 'queued' then now() else completed_at end,
       updated_at = now()
     where id = $1 and user_id = $2 and status in ('queued', 'preparing', 'running', 'synthesizing')
     returning *, ''::text as question`,
    [jobId, userId],
  )
  const job = rows[0] ?? null
  if (job) await addMeetingJobEvent(jobId, job.status === 'cancelled' ? 'cancelled' : 'cancellation_requested', { completedAgents: job.completed_agents })
  return job
}

export async function recoverableMeetingJobs(staleBefore: string) {
  return query<{ id: string }>(
    `update meeting_jobs set status = case when attempt >= 2 then 'timed_out' else 'queued' end,
       stage = case when attempt >= 2 then 'timed_out' else 'queued' end,
       error_code = case when attempt >= 2 then 'AI_TIMEOUT' else error_code end,
       error_message = case when attempt >= 2 then 'The meeting exceeded its execution window.' else error_message end,
       completed_at = case when attempt >= 2 then now() else completed_at end,
       updated_at = now()
     where status in ('preparing', 'running', 'synthesizing') and updated_at < $1::timestamptz
     returning id`,
    [staleBefore],
  )
}

export async function listQueuedMeetingJobs() {
  return query<{ id: string }>(`select id from meeting_jobs where status = 'queued' order by created_at asc limit 50`)
}

export async function retryMeetingJob(userId: string, jobId: string) {
  const rows = await query<MeetingJobRow>(
    `update meeting_jobs set status = 'queued', stage = 'queued', error_code = null,
       error_message = null, technical_details = null, completed_at = null, updated_at = now()
     where id = $1 and user_id = $2 and status in ('failed', 'timed_out') and attempt < 2
     returning *, ''::text as question`,
    [jobId, userId],
  )
  return rows[0] ?? null
}

export async function requireConversation(userId: string, conversationId: string, activeDatasetIds?: string[]) {
  const conversation = await getConversation(userId, conversationId, activeDatasetIds)
  if (!conversation) throw appError('NOT_FOUND')
  return conversation
}

export async function getLatestAnalysisIdForContext(userId: string, datasetIds: string[]) {
  const normalizedIds = canonicalDatasetIds(datasetIds)
  const analyses = await query<{ id: string }>(
    `select a.id from analyses a
     join datasets primary_dataset on primary_dataset.id = a.dataset_id
     join workspaces w on w.id = primary_dataset.workspace_id
     where w.owner_user_id = $1 and a.status = 'completed'
       and (select array_agg(ad.dataset_id::text order by ad.dataset_id::text) from analysis_datasets ad where ad.analysis_id = a.id) = $2::text[]
     order by a.completed_at desc nulls last, a.created_at desc limit 1`,
    [userId, normalizedIds],
  )
  return analyses[0]?.id ?? null
}

export async function updateConversationAnalysis(conversationId: string, analysisId: string) {
  await query('update team_conversations set analysis_id = $2 where id = $1', [conversationId, analysisId])
}

export async function getSpecialistMemory(userId: string, activeDatasetIds: string[], excludeConversationId?: string) {
  const active = canonicalDatasetIds(activeDatasetIds)
  if (!active.length) return []
  return query<SpecialistMemoryRow>(
    `with conversation_context as (
       select c.id, c.title,
         array_agg(tcd.dataset_id::text order by tcd.dataset_id::text) as dataset_ids,
         array_agg(regexp_replace(d.filename, '\\.[^.]+$', '') order by tcd.dataset_id::text) as dataset_names
       from team_conversations c
       join team_conversation_datasets tcd on tcd.conversation_id = c.id
       join datasets d on d.id = tcd.dataset_id
       where c.user_id = $1 and ($4::uuid is null or c.id <> $4::uuid)
       group by c.id
       having array_agg(tcd.dataset_id::text order by tcd.dataset_id::text) = $2::text[]
         or ($3::integer > 1 and count(tcd.dataset_id) = 1 and min(tcd.dataset_id::text) = any($2::text[]))
     )
     select m.agent_key, m.content, m.evidence, cc.title, cc.dataset_names, m.created_at
     from conversation_context cc join team_messages m on m.conversation_id = cc.id
     where m.role = 'agent' and m.agent_key is not null
     order by m.created_at desc limit 30`,
    [userId, active, active.length, excludeConversationId ?? null],
  )
}
