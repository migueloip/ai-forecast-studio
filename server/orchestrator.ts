import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { z } from 'zod'
import { config } from './config.js'
import { ConfigurationError, query } from './db.js'
import { getDatasetAnalytics, getDatasetContext } from './repositories.js'
import type { DatasetAnalytics } from './analytics.js'
import { notifySafely } from './notifications.js'
import { getAiPreferences, getDatasetNote, preferencesPrompt } from './executive.js'
import { appError, ErrorCatalog, normalizeError } from './errors/index.js'
import { meetingDependencyGraph } from './reliability.js'
import {
  addMessage,
  addMeetingJobEvent,
  claimMeetingJob,
  completeMeetingAgent,
  createConversation,
  createMeetingJob,
  getConversation,
  getLatestAnalysisIdForContext,
  getMeetingContext,
  getMeetingJobInternal,
  getSpecialistMemory,
  meetingConversationUrl,
  meetingAgentKeys,
  requireConversation,
  updateMeetingJob,
  updateConversationAnalysis,
  type MeetingTarget,
} from './meetings.js'

const EvidenceSchema = z.object({
  label: z.string(),
  value: z.string(),
  source: z.string(),
})

export const AgentFindingSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  evidence: z.array(EvidenceSchema).min(1).max(4),
  confidence: z.number().min(0).max(100),
  severity: z.enum(['info', 'opportunity', 'warning', 'critical']),
  recommendation: z.string(),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    trend: z.enum(['up', 'down', 'stable', 'unknown']),
  })).max(4),
})

export type AgentFinding = z.infer<typeof AgentFindingSchema>

export const BriefingSchema = z.object({
  headline: z.string(),
  executiveSummary: z.string(),
  businessHealthScore: z.number().min(0).max(100),
  forecastConfidence: z.number().min(0).max(100).nullable(),
  revenueForecast: z.object({
    direction: z.enum(['growth', 'decline', 'stable']).nullable(),
    changePercent: z.number().nullable(),
    horizon: z.string(),
  }),
  primaryRisk: z.object({
    title: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    estimatedTiming: z.string(),
  }),
  recommendation: z.object({
    action: z.string(),
    expectedImpact: z.string(),
    confidence: z.number().min(0).max(100),
    urgency: z.string(),
  }),
  insights: z.array(z.object({
    title: z.string(),
    description: z.string(),
    evidence: z.string(),
    type: z.enum(['growth', 'risk', 'pattern', 'opportunity']),
  })).min(2).max(5),
})

export type Briefing = z.infer<typeof BriefingSchema>

const TeamSpecialistResponseSchema = z.object({
  answer: z.string(),
  evidence: z.string(),
  confidence: z.number().min(0).max(100),
})

const TeamSynthesisSchema = z.object({
  synthesis: z.string(),
})

const specialistAgents = [
  {
    key: 'data_engineer', name: 'Elena', role: 'Data Engineer',
    instructions: 'Evaluate data readiness, completeness, schema quality, temporal coverage, and material limitations. Do not invent missing columns or values.',
  },
  {
    key: 'data_scientist', name: 'Noah', role: 'Data Scientist',
    instructions: 'Identify trends, seasonality, anomalies, segment differences, and plausible business drivers. Distinguish evidence from hypothesis.',
  },
  {
    key: 'forecast_specialist', name: 'Maya', role: 'Forecast Specialist',
    instructions: 'Interpret the supplied Forecast Intelligence result and its temporal backtest. Treat its point estimates, selected single/ensemble strategy, evaluated and rejected models, diagnostics, validation errors, and empirical 95% intervals as the quantitative baseline. Explain why the strategy won, why alternatives were rejected, and never replace validated projections with invented numbers.',
  },
  {
    key: 'risk_analyst', name: 'Owen', role: 'Risk Analyst',
    instructions: 'Stress-test prior findings, identify operational or financial exposure, estimate urgency, and name assumptions that could invalidate the conclusion.',
  },
  {
    key: 'strategy_lead', name: 'Ava', role: 'Recommendation Specialist',
    instructions: 'Turn verified evidence into one practical, prioritized action with measurable upside, safeguards, and a clear decision window.',
  },
] as const

const teamLead = {
  key: 'team_lead',
  name: 'Atlas',
  role: 'AI Chief Data Scientist',
}

function openaiClient() {
  if (!config.aiApiKey) throw new ConfigurationError('AI_API_KEY is not configured. Add your provider key to .env before starting an analysis.')
  return new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl, timeout: config.aiTimeoutMs, maxRetries: 0 })
}

function retryableProviderError(error: unknown) {
  const normalized = normalizeError(error)
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null
  return normalized.code === 'AI_TIMEOUT' || normalized.code === 'RATE_LIMITED' || normalized.code === 'AI_UNAVAILABLE' || (status !== null && status >= 500)
}

function waitForBackoff(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('The request was cancelled.', 'AbortError')); return }
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('The request was cancelled.', 'AbortError')) }, { once: true })
  })
}

function extractJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? content).trim()
  const objectStart = candidate.indexOf('{')
  const objectEnd = candidate.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error('The model response did not contain a JSON object.')
  return candidate.slice(objectStart, objectEnd + 1)
}

async function structuredCompletion<Schema extends z.ZodType>(
  client: OpenAI,
  schema: Schema,
  schemaName: string,
  instructions: string,
  input: string,
  maxTokens = config.aiMaxOutputTokens,
  signal?: AbortSignal,
) {
  const jsonSchema = z.toJSONSchema(schema)
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${instructions}\nReturn only a JSON object matching this ${schemaName} schema:\n${JSON.stringify(jsonSchema)}`,
    },
    { role: 'user', content: input },
  ]

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now()
    let completion: OpenAI.Chat.Completions.ChatCompletion | null = null
    for (let providerAttempt = 0; providerAttempt <= config.aiMaxRetries; providerAttempt += 1) {
      try {
        completion = await client.chat.completions.create({
        model: config.aiModel,
        messages,
        temperature: 1,
        top_p: 1,
        max_tokens: maxTokens,
        reasoning_effort: config.aiReasoningEffort,
        stream: false,
        }, { signal })
        break
      } catch (error) {
        const normalized = normalizeError(error)
        const retryable = retryableProviderError(error) && providerAttempt < config.aiMaxRetries && !signal?.aborted
        console.error(JSON.stringify({ event: 'provider_request_failed', schema: schemaName, schemaAttempt: attempt + 1, providerAttempt: providerAttempt + 1, providerWaitMs: Date.now() - startedAt, code: normalized.code, retryable }))
        if (!retryable) throw error
        await waitForBackoff(600 * (2 ** providerAttempt), signal)
      }
    }
    if (!completion) throw appError('AI_UNAVAILABLE')
    console.log(JSON.stringify({ event: 'provider_request_completed', schema: schemaName, schemaAttempt: attempt + 1, providerWaitMs: Date.now() - startedAt, outputTokens: completion.usage?.completion_tokens ?? 0 }))
    const content = completion.choices[0]?.message.content
    if (!content) throw new Error('The model returned an empty response.')
    try {
      const output = schema.parse(JSON.parse(extractJson(content)))
      return { output, responseId: completion.id }
    } catch (error) {
      lastError = error
      messages.push(
        { role: 'assistant', content },
        { role: 'user', content: 'The previous response did not match the required schema. Correct it and return only valid JSON.' },
      )
    }
  }
  throw appError('AI_INVALID_RESPONSE', { cause: lastError })
}

async function createSpecialistFinding(
  client: OpenAI,
  agent: (typeof specialistAgents)[number],
  datasetContext: string,
  mission: string,
  priorFindings: AgentFinding[],
) {
  const { output, responseId } = await structuredCompletion(
    client,
    AgentFindingSchema,
    `${agent.key}_finding`,
    [
      `You are ${agent.name}, the ${agent.role} in AI Forecast Studio.`,
      agent.instructions,
      'Use only the supplied dataset profile, aggregates, redacted sample, and prior verified findings.',
      'Every number must be supported by supplied evidence. Express uncertainty clearly. Never claim causality from correlation.',
      'Return an executive-friendly finding. Do not expose private chain-of-thought.',
    ].join(' '),
    `MISSION\n${mission}\n\nDATASET CONTEXT\n${datasetContext}\n\nPRIOR TEAM FINDINGS\n${JSON.stringify(priorFindings)}`,
  )
  return { finding: output, responseId }
}

async function createBriefing(client: OpenAI, mission: string, findings: AgentFinding[], analyticsList: Array<DatasetAnalytics | null>) {
  const { output, responseId } = await structuredCompletion(
    client,
    BriefingSchema,
    'executive_briefing',
    [
      'You are Atlas, the AI Chief Data Scientist and final orchestrator for a small-business decision intelligence product.',
      'Synthesize the specialist findings into a concise, internally consistent executive briefing.',
      'Use only the evidence supplied by specialists. Resolve disagreements conservatively and avoid false precision.',
      'Use the Forecast Specialist validated statistical baseline for forecast direction, change, horizon, and confidence; do not average it with qualitative guesses.',
      'Never calculate, estimate, extrapolate, or invent any numerical forecast. Numerical forecast fields are replaced by the deterministic engine after your explanation is generated.',
    ].join(' '),
    `MISSION\n${mission}\n\nSPECIALIST FINDINGS\n${JSON.stringify(findings)}`,
    config.aiBriefingMaxTokens,
  )
  const authoritative = analyticsList.find((analytics): analytics is DatasetAnalytics => Boolean(analytics))
  const forecast = authoritative?.forecasts.metrics.revenue
    ?? (authoritative?.forecasts.primaryMetric ? authoritative.forecasts.metrics[authoritative.forecasts.primaryMetric] : null)
  const change = forecast?.changePercent ?? null
  const periodName = authoritative?.source.frequency === 'daily' ? 'days' : authoritative?.source.frequency === 'weekly' ? 'weeks' : authoritative?.source.frequency === 'quarterly' ? 'quarters' : 'months'
  const briefing: Briefing = {
    ...output,
    businessHealthScore: authoritative?.health.overall ?? 0,
    forecastConfidence: forecast?.confidence ?? null,
    revenueForecast: {
      direction: change === null ? null : change > .5 ? 'growth' : change < -.5 ? 'decline' : 'stable',
      changePercent: change,
      horizon: forecast ? `${forecast.points.length} ${periodName}` : 'No validated forecast available',
    },
    recommendation: {
      ...output.recommendation,
      expectedImpact: forecast
        ? `Evaluate against the ${forecast.model} validated baseline and its 95% interval before committing.`
        : 'Quantitative impact is unavailable until a model-validated forecast can be produced.',
      confidence: forecast?.confidence ?? 0,
    },
  }
  return { briefing, responseId }
}

async function createAgentRun(analysisId: string, key: string, name: string, role: string, sequence: number) {
  await query(
    `insert into agent_runs (id, analysis_id, agent_key, agent_name, role, sequence, status)
     values ($1, $2, $3, $4, $5, $6, 'queued')`,
    [randomUUID(), analysisId, key, name, role, sequence],
  )
}

export async function createAnalysis(userId: string, datasetIds: string[], mission: string) {
  if (!config.aiApiKey) throw new ConfigurationError('AI_API_KEY is not configured. Add your provider key to .env before starting an analysis.')
  const uniqueDatasetIds = [...new Set(datasetIds)]
  if (uniqueDatasetIds.length === 0 || uniqueDatasetIds.length > 5) throw appError('VALIDATION_ERROR')
  const ownedDatasets = await query<{ id: string }>(
    `select d.id from datasets d join workspaces w on w.id = d.workspace_id
     where w.owner_user_id = $1 and d.id = any($2::uuid[])`,
    [userId, uniqueDatasetIds],
  )
  if (ownedDatasets.length !== uniqueDatasetIds.length) throw appError('NOT_FOUND')
  const id = randomUUID()
  await query(
    `insert into analyses (id, dataset_id, mission, status, model)
     values ($1, $2, $3, 'queued', $4)`,
    [id, uniqueDatasetIds[0], mission, config.aiModel],
  )
  for (const [position, datasetId] of uniqueDatasetIds.entries()) {
    await query(
      'insert into analysis_datasets (analysis_id, dataset_id, position) values ($1, $2, $3)',
      [id, datasetId, position],
    )
  }
  for (const [index, agent] of specialistAgents.entries()) await createAgentRun(id, agent.key, agent.name, agent.role, index)
  await createAgentRun(id, teamLead.key, teamLead.name, teamLead.role, specialistAgents.length)
  await notifySafely(userId, {
    type: 'analysis_started', title: 'AI Team deployed',
    message: `Five specialists are reviewing ${uniqueDatasetIds.length === 1 ? 'your dataset' : `${uniqueDatasetIds.length} connected datasets`} and will notify you when the executive briefing is ready.`,
    severity: 'info', actionUrl: '/app', metadata: { analysisId: id, datasetIds: uniqueDatasetIds },
  })
  return id
}

export async function runAnalysis(analysisId: string) {
  const analysisStartedAt = Date.now()
  const analysisRows = await query<{ dataset_id: string; mission: string; user_id: string; created_at: string }>(
    `select a.dataset_id, a.mission, a.created_at, w.owner_user_id as user_id from analyses a
     join datasets d on d.id = a.dataset_id join workspaces w on w.id = d.workspace_id
     where a.id = $1`,
    [analysisId],
  )
  const analysis = analysisRows[0]
  if (!analysis) throw appError('NOT_FOUND')
  const claimed = await query<{ id: string }>(
    `update analyses set status = 'running', error = null, failure_code = null, failure_details = null,
       started_at = coalesce(started_at, now()), last_heartbeat_at = now(), updated_at = now()
     where id = $1 and status = 'queued' returning id`,
    [analysisId],
  )
  if (!claimed[0]) return false
  console.log(JSON.stringify({ event: 'analysis_job_started', analysisId, queueLatencyMs: Math.max(0, Date.now() - new Date(analysis.created_at).getTime()) }))
  const associatedDatasets = await query<{ dataset_id: string }>(
    'select dataset_id from analysis_datasets where analysis_id = $1 order by position asc',
    [analysisId],
  )
  const datasetIds = associatedDatasets.length > 0 ? associatedDatasets.map((row) => row.dataset_id) : [analysis.dataset_id]
  const contexts = await Promise.all(datasetIds.map((datasetId) => getDatasetContext(datasetId)))
  if (contexts.some((context) => !context)) throw appError('NOT_FOUND')
  const statisticalAnalytics = await Promise.all(datasetIds.map((datasetId) => getDatasetAnalytics(datasetId, analysis.user_id)))
  const datasetNotes = await Promise.all(datasetIds.map((datasetId) => getDatasetNote(analysis.user_id, datasetId)))
  const datasetContext = JSON.stringify({
    sourceCount: contexts.length,
    datasets: contexts.map((context, index) => {
      const { sampleRows, ...profileWithoutSample } = context!.dataset.summary
      return {
        filename: context!.dataset.filename,
        rowCount: context!.dataset.row_count,
        columns: context!.dataset.columns,
        profile: profileWithoutSample,
        statisticalAnalytics: statisticalAnalytics[index],
        businessNote: datasetNotes[index]?.note || null,
        redactedSample: sampleRows.slice(0, contexts.length === 1 ? 8 : 4),
      }
    }),
  })
  const previousRuns = await query<{ agent_key: string; status: string; output: AgentFinding | null }>(
    'select agent_key, status, output from agent_runs where analysis_id = $1 order by sequence asc',
    [analysisId],
  )
  const findings: AgentFinding[] = []
  const client = openaiClient()
  const operatingPreferences = preferencesPrompt(await getAiPreferences(analysis.user_id))
  const operatingMission = `${analysis.mission}\n\nEXECUTIVE OPERATING PREFERENCES\n${operatingPreferences}`

  try {
    for (const agent of specialistAgents) {
      const previous = previousRuns.find((run) => run.agent_key === agent.key)
      if (previous?.status === 'completed' && previous.output) {
        findings.push(AgentFindingSchema.parse(previous.output))
        continue
      }
      await query(
        `update agent_runs set status = 'running', started_at = now(), completed_at = null, input_summary = $2
         where analysis_id = $1 and agent_key = $3`,
        [analysisId, `${contexts.length} dataset profile(s) plus ${findings.length} prior team finding(s).`, agent.key],
      )
      await query('update analyses set last_heartbeat_at = now(), updated_at = now() where id = $1', [analysisId])
      const specialistStartedAt = Date.now()
      const { finding, responseId } = await createSpecialistFinding(client, agent, datasetContext, operatingMission, findings)
      findings.push(finding)
      await query(
        `update agent_runs set status = 'completed', output = $2::jsonb, openai_response_id = $3, completed_at = now()
         where analysis_id = $1 and agent_key = $4`,
        [analysisId, JSON.stringify(finding), responseId, agent.key],
      )
      await query('update analyses set last_heartbeat_at = now(), updated_at = now() where id = $1', [analysisId])
      console.log(JSON.stringify({ event: 'analysis_specialist_completed', analysisId, specialist: agent.key, durationMs: Date.now() - specialistStartedAt }))
      if (agent.key === 'risk_analyst' && ['warning', 'critical'].includes(finding.severity)) {
        await notifySafely(analysis.user_id, {
          type: 'risk_detected', title: finding.headline,
          message: finding.summary, severity: finding.severity === 'critical' ? 'error' : 'warning',
          actionUrl: '/app/insights', metadata: { analysisId, confidence: finding.confidence },
        })
      }
    }

    await query(
      `update agent_runs set status = 'running', started_at = now(), input_summary = $2
       where analysis_id = $1 and agent_key = $3`,
      [analysisId, `Synthesis of ${findings.length} specialist findings.`, teamLead.key],
    )
    await query('update analyses set last_heartbeat_at = now(), updated_at = now() where id = $1', [analysisId])
    const { briefing, responseId } = await createBriefing(client, operatingMission, findings, statisticalAnalytics)
    await query(
      `update agent_runs set status = 'completed', output = $2::jsonb, openai_response_id = $3, completed_at = now()
       where analysis_id = $1 and agent_key = $4`,
      [analysisId, JSON.stringify(briefing), responseId, teamLead.key],
    )
    await query(
      `update analyses set status = 'completed', briefing = $2::jsonb, completed_at = now(),
       failure_code = null, failure_details = null, last_heartbeat_at = now(), updated_at = now()
       where id = $1`,
      [analysisId, JSON.stringify(briefing)],
    )
    await notifySafely(analysis.user_id, {
      type: 'analysis_completed', title: 'Executive briefing ready',
      message: briefing.headline, severity: 'success', actionUrl: '/app',
      metadata: { analysisId, confidence: briefing.forecastConfidence },
    })
    console.log(JSON.stringify({ event: 'analysis_job_completed', analysisId, durationMs: Date.now() - analysisStartedAt, preservedStages: previousRuns.filter((run)=>run.status==='completed').length }))
    return true
  } catch (error) {
    const normalized = normalizeError(error)
    const message = normalized.publicMessage
    const failedRuns = await query<{ agent_key: string }>("update agent_runs set status = 'failed', completed_at = now() where analysis_id = $1 and status = 'running' returning agent_key", [analysisId])
    await query(
      `update analyses set status = 'failed', error = $2, failure_code = $3,
       failure_details = $4::jsonb, last_heartbeat_at = now(), updated_at = now() where id = $1`,
      [analysisId, message.slice(0, 1_500), normalized.code, JSON.stringify({ failedAgent: failedRuns[0]?.agent_key ?? null, category: normalized.code })],
    )
    await notifySafely(analysis.user_id, {
      type: 'analysis_failed', title: 'AI Team analysis needs attention',
      message: message.slice(0, 300), severity: 'error', actionUrl: '/app', metadata: { analysisId, failureCode: normalized.code },
    })
    console.error(JSON.stringify({ event: 'analysis_job_failed', analysisId, code: normalized.code, durationMs: Date.now() - analysisStartedAt, preservedStages: findings.length }))
    throw error
  }
}

export async function recoverInterruptedAnalyses() {
  const staleBefore = new Date(Date.now() - config.aiTimeoutMs - 60_000).toISOString()
  const interrupted = await query<{ id: string; user_id: string }>(
    `with stale as (
       update analyses
       set status = 'failed', error = $2, failure_code = 'AI_TIMEOUT',
         failure_details = jsonb_build_object('category', 'AI_TIMEOUT', 'recoveredAfterRestart', true), updated_at = now()
       where status = 'running' and coalesce(last_heartbeat_at, updated_at) < $1
       returning id, dataset_id
     )
     select stale.id, w.owner_user_id as user_id from stale
     join datasets d on d.id = stale.dataset_id
     join workspaces w on w.id = d.workspace_id`,
    [staleBefore, ErrorCatalog.ANALYSIS_INTERRUPTED.message],
  )
  if (interrupted.length === 0) return 0
  const analysisIds = interrupted.map((analysis) => analysis.id)
  await query(
    `update agent_runs set status = 'failed', completed_at = now()
     where analysis_id = any($1::uuid[]) and status = 'running'`,
    [analysisIds],
  )
  await Promise.all(interrupted.map((analysis) => notifySafely(analysis.user_id, {
    type: 'analysis_interrupted', title: 'AI Team analysis was interrupted',
    message: ErrorCatalog.ANALYSIS_INTERRUPTED.message, severity: 'warning',
    actionUrl: '/app', metadata: { analysisId: analysis.id, failureCode: 'AI_TIMEOUT' },
  })))
  return interrupted.length
}

export async function retryAnalysis(userId: string, analysisId: string) {
  const analysis = await getAnalysis(analysisId, userId)
  if (!analysis) throw appError('NOT_FOUND')
  if (analysis.status === 'running' || analysis.status === 'queued') throw appError('ANALYSIS_IN_PROGRESS')
  if (analysis.status === 'completed') throw appError('VALIDATION_ERROR', { message: 'This analysis is already complete.' })
  await query("update analyses set status = 'queued', error = null, failure_code = null, failure_details = null, completed_at = null, retry_count = retry_count + 1, updated_at = now() where id = $1", [analysisId])
  await query("update agent_runs set status = 'queued', started_at = null, completed_at = null where analysis_id = $1 and status = 'failed'", [analysisId])
  await notifySafely(userId, {
    type: 'analysis_retried', title: 'AI Team analysis resumed',
    message: 'Completed specialist work was preserved; the team is continuing from the failed step.',
    severity: 'info', actionUrl: '/app', metadata: { analysisId },
  })
  return analysisId
}

interface AnalysisRow extends Record<string, unknown> {
  id: string
  dataset_id: string
  dataset_ids: string[]
  dataset_context: Array<{ id: string; name: string; filename: string; rowCount: number; periods: number }>
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
}

interface AgentRunRow extends Record<string, unknown> {
  id: string
  agent_key: string
  agent_name: string
  role: string
  sequence: number
  status: 'queued' | 'running' | 'completed' | 'failed'
  input_summary: string | null
  output: AgentFinding | Briefing | null
  openai_response_id: string | null
  started_at: string | null
  completed_at: string | null
}

export async function getAnalysis(analysisId: string, userId: string) {
  const analyses = await query<AnalysisRow>(
    `select a.*, coalesce(
       (select jsonb_agg(ad.dataset_id order by ad.position) from analysis_datasets ad where ad.analysis_id = a.id),
       jsonb_build_array(a.dataset_id)
     ) as dataset_ids,
     coalesce(
       (select jsonb_agg(jsonb_build_object(
         'id', context_dataset.id,
         'name', regexp_replace(context_dataset.filename, '\\.[^.]+$', ''),
         'filename', context_dataset.filename,
         'rowCount', context_dataset.row_count,
         'periods', case when jsonb_typeof(context_dataset.summary->'timeSeries') = 'array' then jsonb_array_length(context_dataset.summary->'timeSeries') else 0 end,
         'frequency', coalesce(context_dataset.analytics->'source'->>'frequency', 'irregular')
       ) order by ad.position)
       from analysis_datasets ad join datasets context_dataset on context_dataset.id = ad.dataset_id
       where ad.analysis_id = a.id),
       '[]'::jsonb
     ) as dataset_context from analyses a
     join datasets d on d.id = a.dataset_id
     join workspaces w on w.id = d.workspace_id
     where a.id = $1 and w.owner_user_id = $2`,
    [analysisId, userId],
  )
  if (!analyses[0]) return null
  const runs = await query<AgentRunRow>(
    `select id, agent_key, agent_name, role, sequence, status, input_summary, output,
       openai_response_id, started_at, completed_at
     from agent_runs where analysis_id = $1 order by sequence asc`,
    [analysisId],
  )
  const analysis = analyses[0]
  const knownPublicMessages = new Set<string>(Object.values(ErrorCatalog).map((definition) => definition.message))
  const safeStoredError = analysis.error && !knownPublicMessages.has(analysis.error)
    ? ErrorCatalog.AI_UNAVAILABLE.message
    : analysis.error
  return { ...analysis, error: safeStoredError, agents: runs }
}

export async function getLatestAnalysis(userId: string) {
  const analyses = await query<{ id: string }>(
    `select a.id from analyses a
     join datasets d on d.id = a.dataset_id
     join workspaces w on w.id = d.workspace_id
     where w.owner_user_id = $1 order by a.created_at desc limit 1`,
    [userId],
  )
  return analyses[0] ? getAnalysis(analyses[0].id, userId) : null
}

export async function listAnalysisContexts(userId: string) {
  return query<{
    id: string; status: AnalysisRow['status']; created_at: string; completed_at: string | null
    dataset_ids: string[]; dataset_names: string[]; forecast_confidence: number | null
  }>(
    `select a.id, a.status, a.created_at, a.completed_at,
       array_agg(ad.dataset_id::text order by ad.position) as dataset_ids,
       array_agg(coalesce(d.display_name, regexp_replace(d.filename, '\\.[^.]+$', '')) order by ad.position) as dataset_names,
       (a.briefing->>'forecastConfidence')::double precision as forecast_confidence
     from analyses a
     join datasets primary_dataset on primary_dataset.id = a.dataset_id
     join workspaces w on w.id = primary_dataset.workspace_id
     join analysis_datasets ad on ad.analysis_id = a.id
     join datasets d on d.id = ad.dataset_id
     where w.owner_user_id = $1
     group by a.id having bool_and(d.archived_at is null)
     order by a.created_at desc limit 25`,
    [userId],
  )
}

export async function enqueueTeamMeeting(
  userId: string,
  question: string,
  requestedTarget: MeetingTarget = 'all',
  requestedConversationId?: string,
  requestedAnalysisId?: string,
) {
  const activeContext = await getMeetingContext(userId, requestedAnalysisId)
  if (!activeContext) throw appError('ANALYSIS_REQUIRED')
  const activeDatasetIds = activeContext.datasets.map((dataset) => dataset.id)
  const existingConversation = requestedConversationId
    ? await requireConversation(userId, requestedConversationId, activeDatasetIds)
    : null
  const conversationDatasetIds = existingConversation?.dataset_ids ?? activeDatasetIds
  const target = existingConversation?.target_agent_key ?? requestedTarget
  const latestContextAnalysisId = await getLatestAnalysisIdForContext(userId, conversationDatasetIds)
  const evidenceAnalysisId = latestContextAnalysisId ?? existingConversation?.analysis_id ?? activeContext.analysisId
  const analysis = await getAnalysis(evidenceAnalysisId, userId)
  if (!analysis?.briefing || analysis.status !== 'completed') throw appError('ANALYSIS_REQUIRED')
  const conversationId = existingConversation?.id
    ?? await createConversation(userId, analysis.id, conversationDatasetIds, target, question)
  if (existingConversation && existingConversation.analysis_id !== analysis.id) {
    await updateConversationAnalysis(existingConversation.id, analysis.id)
  }
  const expectedAgentKeys = target === 'all' ? [...meetingDependencyGraph.parallelSpecialists] : [target]
  const job = await createMeetingJob(userId, conversationId, analysis.id, target, expectedAgentKeys, question)
  return { job, conversation: await getConversation(userId, conversationId) }
}

const activeMeetingControllers = new Map<string, AbortController>()

function meetingAgent(agentKey: (typeof meetingAgentKeys)[number]) {
  const agent = specialistAgents.find((candidate) => candidate.key === agentKey)
  if (!agent) throw new Error(`Unknown meeting specialist: ${agentKey}`)
  return agent
}

export function cancelRunningMeetingJob(jobId: string) {
  activeMeetingControllers.get(jobId)?.abort()
}

export async function runMeetingJob(jobId: string) {
  const claimed = await claimMeetingJob(jobId)
  if (!claimed) return
  const controller = new AbortController()
  activeMeetingControllers.set(jobId, controller)
  const jobStartedAt = Date.now()
  let jobTimedOut = false
  const jobTimeout = setTimeout(() => { jobTimedOut = true; controller.abort() }, config.meetingJobTimeoutMs)
  try {
    const job = await getMeetingJobInternal(jobId)
    if (!job) throw appError('NOT_FOUND')
    console.log(JSON.stringify({ event: 'meeting_job_started', jobId, attempt: job.attempt, queueLatencyMs: Math.max(0, Date.now() - new Date(job.created_at).getTime()) }))
    const existingConversation = await requireConversation(job.user_id, job.conversation_id)
    const conversationDatasetIds = existingConversation.dataset_ids
    const analysis = await getAnalysis(job.analysis_id, job.user_id)
    if (!analysis?.briefing || analysis.status !== 'completed') throw appError('ANALYSIS_REQUIRED')
    const previousMessages = existingConversation.messages
      .filter((message) => message.id !== job.question_message_id)
      .slice(-12)
      .map((message) => ({ role: message.role, agentKey: message.agent_key, content: message.content }))
    const expectedAgentKeys = job.expected_agents
    const remainingAgentKeys = expectedAgentKeys.filter((agentKey) => !job.completed_agents.includes(agentKey))
  const sourceFindings = analysis.agents
    .filter((run) => expectedAgentKeys.includes(run.agent_key as (typeof expectedAgentKeys)[number]))
    .map((run) => ({ agentKey: run.agent_key, role: run.role, output: run.output }))
    const specialistMemory = (await getSpecialistMemory(job.user_id, conversationDatasetIds, job.conversation_id))
    .filter((memory) => expectedAgentKeys.includes(memory.agent_key as (typeof expectedAgentKeys)[number]))
    .map((memory) => ({
      datasetContext: memory.dataset_names,
      specialist: memory.agent_key,
      priorConclusion: memory.content.slice(0, 800),
      evidence: memory.evidence?.slice(0, 400) ?? null,
      conversation: memory.title,
    }))
    const contextDatasets = existingConversation.dataset_names
  const comparative = conversationDatasetIds.length > 1
    const operatingPreferences = preferencesPrompt(await getAiPreferences(job.user_id))
    const businessNotes = await Promise.all(conversationDatasetIds.map((datasetId) => getDatasetNote(job.user_id, datasetId)))
    const sharedInstructions = [
      `You are permanently assigned to this business context: ${contextDatasets.join(' + ')}.`,
      comparative
        ? 'This is a comparative business analysis. Compare the supplied datasets explicitly when evidence supports it and keep each company source clearly attributed.'
        : 'This is a single-business meeting. Never import facts, assumptions, or memory from any other dataset.',
      'Use only the supplied completed analysis, current conversation history, and dataset-scoped specialist memory.',
      'Dataset isolation is mandatory. If a prior memory is not labeled with the current meeting datasets, ignore it.',
      `Follow these executive operating preferences for prioritization and communication: ${operatingPreferences}`,
      'Never calculate or invent a numerical forecast, scenario result, confidence, probability, or business impact. You may only quote an existing numerical result verbatim and identify its validated source; otherwise state that the statistical engine must calculate it.',
      'Keep perspectives distinct, cite concise evidence, acknowledge uncertainty, and do not expose private chain-of-thought.',
    ].join(' ')
    const sharedInput = `MEETING DATASET CONTEXT\n${JSON.stringify({ mode: comparative ? 'comparative' : 'single', datasets: contextDatasets, businessNotes: businessNotes.map((item) => item.note).filter(Boolean) })}\n\nDATASET-SCOPED SPECIALIST MEMORY\n${JSON.stringify(specialistMemory)}\n\nCURRENT CONVERSATION HISTORY\n${JSON.stringify(previousMessages)}\n\nUSER QUESTION\n${job.question}\n\nEXECUTIVE BRIEFING\n${JSON.stringify(analysis.briefing)}\n\nCURRENT SPECIALIST FINDINGS\n${JSON.stringify(sourceFindings)}`

    await updateMeetingJob(jobId, { status: 'running', stage: remainingAgentKeys.length ? 'specialists_running' : 'specialists_completed' })
    await addMeetingJobEvent(jobId, 'specialists_started', { specialists: remainingAgentKeys })

    const specialistResults = await Promise.allSettled(remainingAgentKeys.map(async (agentKey) => {
      const agent = meetingAgent(agentKey)
      const startedAt = Date.now()
      const current = await getMeetingJobInternal(jobId)
      if (current?.cancel_requested_at) throw appError('ANALYSIS_INTERRUPTED', { message: 'This meeting was cancelled.' })
      const { output } = await structuredCompletion(
        openaiClient(),
        TeamSpecialistResponseSchema,
        `${agentKey}_meeting_response`,
        [
          `You are ${agent.name}, the ${agent.role} in AI Forecast Studio.`,
          agent.instructions,
          sharedInstructions,
          'Answer only from your specialist perspective. Return one concise answer, its persisted evidence source, and a confidence grounded in the supplied evidence.',
        ].join(' '),
        sharedInput,
        config.aiBriefingMaxTokens,
        controller.signal,
      )
      const message = await addMessage(job.conversation_id, {
        role: 'agent', agentKey, content: output.answer,
        evidence: output.evidence, confidence: output.confidence, jobId,
      })
      await completeMeetingAgent(jobId, agentKey, message.id, Date.now() - startedAt)
      return { agentKey, ...output }
    }))
    const failedResult = specialistResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failedResult) throw failedResult.reason
    if ((await getMeetingJobInternal(jobId))?.cancel_requested_at) throw appError('ANALYSIS_INTERRUPTED', { message: 'This meeting was cancelled.' })

    let synthesis = ''
    if (job.target_agent_key === 'all') {
      const completedConversation = await requireConversation(job.user_id, job.conversation_id)
      const responses = completedConversation.messages
        .filter((message) => message.job_id === jobId && message.role === 'agent')
        .map((message) => ({ agentKey: message.agent_key, answer: message.content, evidence: message.evidence, confidence: message.confidence }))
      await updateMeetingJob(jobId, { status: 'synthesizing', stage: 'atlas_synthesizing' })
      await addMeetingJobEvent(jobId, 'synthesis_started')
      const result = await structuredCompletion(
        openaiClient(),
        TeamSynthesisSchema,
        'team_meeting_synthesis',
        [
          `You are ${teamLead.name}, the ${teamLead.role}.`,
          sharedInstructions,
          'Synthesize only the completed specialist responses. State their shared conclusion or material disagreement without adding numerical claims.',
        ].join(' '),
        `USER QUESTION\n${job.question}\n\nSPECIALIST RESPONSES\n${JSON.stringify(responses)}`,
        config.aiBriefingMaxTokens,
        controller.signal,
      )
      synthesis = result.output.synthesis
      const message = await addMessage(job.conversation_id, { role: 'synthesis', content: synthesis, jobId })
      await addMeetingJobEvent(jobId, 'synthesis_completed', {}, undefined, message.id)
    }
    if ((await getMeetingJobInternal(jobId))?.cancel_requested_at) throw appError('ANALYSIS_INTERRUPTED', { message: 'This meeting was cancelled.' })
    await updateMeetingJob(jobId, { status: 'completed', stage: 'completed', completed: true })
    await addMeetingJobEvent(jobId, 'completed', { durationMs: Date.now() - jobStartedAt })
    await notifySafely(job.user_id, {
    type: 'meeting_completed', title: 'Team meeting response ready',
      message: synthesis || `${meetingAgent(expectedAgentKeys[0]!).name} has responded.`,
      severity: 'success', actionUrl: meetingConversationUrl(job.conversation_id, analysis.id),
      metadata: { analysisId: analysis.id, conversationId: job.conversation_id, jobId, datasetIds: conversationDatasetIds, target: job.target_agent_key, question: job.question.slice(0, 200) },
  })
    console.log(JSON.stringify({ event: 'meeting_job_completed', jobId, durationMs: Date.now() - jobStartedAt, specialists: expectedAgentKeys.length }))
  } catch (error) {
    const normalized = normalizeError(error)
    const current = await getMeetingJobInternal(jobId)
    const cancelled = Boolean(current?.cancel_requested_at)
    const timedOut = jobTimedOut || (!cancelled && normalized.code === 'AI_TIMEOUT')
    const status = cancelled ? 'cancelled' : timedOut ? 'timed_out' : 'failed'
    await updateMeetingJob(jobId, {
      status,
      stage: status,
      errorCode: cancelled ? 'USER_CANCELLED' : normalized.code,
      errorMessage: cancelled ? 'This meeting was cancelled.' : normalized.publicMessage,
      technicalDetails: { category: normalized.code, durationMs: Date.now() - jobStartedAt, errorName: error instanceof Error ? error.name : 'UnknownError' },
      completed: true,
    })
    await addMeetingJobEvent(jobId, status, { code: normalized.code, durationMs: Date.now() - jobStartedAt })
    console.error(JSON.stringify({ event: 'meeting_job_failed', jobId, code: normalized.code, durationMs: Date.now() - jobStartedAt }))
  } finally {
    clearTimeout(jobTimeout)
    activeMeetingControllers.delete(jobId)
  }
}
