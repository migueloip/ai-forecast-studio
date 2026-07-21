import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { authenticateUser, createSession, destroySession, registerUser, requireAuth } from './auth.js'
import { config, configurationStatus } from './config.js'
import { databaseIsReachable } from './db.js'
import { appError, normalizeError, safeRequestFailureLog, sendErrorResponse } from './errors/index.js'
import { requireTurnstile } from './turnstile.js'
import { deleteAiCredential, getAiCredentialStatus, resolveAiProvider, saveNvidiaCredential, testNvidiaCredential } from './ai-credentials.js'
import { createSampleDataset, parseDataset, profileDataset } from './ingestion.js'
import { migrate } from './migrate.js'
import { cancelRunningMeetingJob, createAnalysis, enqueueTeamMeeting, getAnalysis, getLatestAnalysis, listAnalysisContexts, recoverInterruptedAnalyses, retryAnalysis, runAnalysis, runMeetingJob } from './orchestrator.js'
import { archiveDataset, deleteDataset, getDataset, getDatasetAnalytics, getLatestDataset, listDatasets, persistDataset, recalculateDatasetAnalytics, renameDataset, updateDatasetMapping } from './repositories.js'
import { listNotifications, markAllNotificationsRead, markNotificationRead, notifySafely } from './notifications.js'
import {
  getConversation, getConversationLinkContext, getMeetingContext, getMeetingJob, isMeetingTarget, listConversations,
  listQueuedMeetingJobs, recoverableMeetingJobs, requestMeetingJobCancellation, retryMeetingJob,
} from './meetings.js'
import {
  createShareLink, executiveSearch, getAiPreferences, getDatasetNote, getExecutiveOverview, getExportBundle, getPublicShare,
  listBookmarks, personalities, removeBookmark, riskTolerances, saveAiPreferences, saveBookmark, saveDatasetNote, saveDecision,
} from './executive.js'

const app = express()
// Render terminates HTTPS at its reverse proxy before forwarding requests here.
// Trust exactly that first hop so Express and express-rate-limit use the client IP
// from X-Forwarded-For without accepting an arbitrarily long proxy chain.
app.set('trust proxy', 1)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
})

app.disable('x-powered-by')
app.use((request, response, next) => {
  const supplied = request.header('x-request-id')
  const requestId = supplied && /^[a-zA-Z0-9_-]{8,80}$/.test(supplied) ? supplied : randomUUID()
  response.locals.requestId = requestId
  response.setHeader('x-request-id', requestId)
  next()
})
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || config.appOrigins.includes(origin)),
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use((request, _response, next) => {
  const origin = request.header('origin')
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
  if (origin && mutation && !config.appOrigins.includes(origin)) {
    next(appError('FORBIDDEN'))
    return
  }
  next()
})

const asyncRoute = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next)
}

function sourceHash(content: Buffer | string) {
  return createHash('sha256').update(content).digest('hex')
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

app.get('/api/health', asyncRoute(async (_request, response) => {
  const status = configurationStatus()
  const database = status.database ? await databaseIsReachable() : false
  response.json({
    status: database && status.turnstile && (status.openai || status.credentialEncryption) ? 'ready' : 'configuration_required',
    services: { database, openai: status.openai, credentialEncryption: status.credentialEncryption, turnstile: status.turnstile },
    model: status.model,
    provider: status.provider,
  })
}))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (_request, response) => sendErrorResponse(response, appError('RATE_LIMITED'), response.locals.requestId),
})

const credentialTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000, limit: 10, standardHeaders: true, legacyHeaders: false,
  handler: (_request, response) => sendErrorResponse(response, appError('RATE_LIMITED'), response.locals.requestId),
})

app.post('/api/auth/register', authLimiter, asyncRoute(async (request, response) => {
  const fullName = typeof request.body?.fullName === 'string' ? request.body.fullName.trim() : ''
  const email = typeof request.body?.email === 'string' ? request.body.email.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  if (fullName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10) {
    throw appError('VALIDATION_ERROR', { message: 'Enter a valid name, email, and a password of at least 10 characters.' })
  }
  await requireTurnstile(request, 'register')
  const user = await registerUser(fullName.slice(0, 100), email.slice(0, 254), password)
  await createSession(response, user.id)
  await notifySafely(user.id, {
    type: 'welcome', title: 'Your AI Team workspace is ready',
    message: 'Connect a dataset to activate real metrics, specialist analysis, and proactive alerts.',
    severity: 'success', actionUrl: '/onboarding',
  })
  response.status(201).json({ user })
}))

app.post('/api/auth/login', authLimiter, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  await requireTurnstile(request, 'login')
  const user = await authenticateUser(email, password)
  if (!user) {
    throw appError('AUTH_INVALID')
  }
  await createSession(response, user.id)
  response.json({ user })
}))

app.post('/api/auth/token', authLimiter, asyncRoute(async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const label = typeof request.body?.label === 'string' ? request.body.label : 'API access'
  const user = await authenticateUser(email, password)
  if (!user) throw appError('AUTH_INVALID')
  const session = await createSession(null, user.id, 'api', label)
  response.setHeader('Cache-Control', 'no-store')
  response.status(201).json({ accessToken: session.token, tokenType: 'Bearer', expiresAt: session.expiresAt })
}))

app.get('/api/public/reports/:token', asyncRoute(async (request, response) => {
  const token = String(request.params.token ?? '')
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw appError('NOT_FOUND')
  const report = await getPublicShare(token)
  if (!report) throw appError('NOT_FOUND')
  response.setHeader('Cache-Control', 'private, max-age=300')
  response.json({ report })
}))

app.use('/api', requireAuth)

app.post('/api/auth/logout', asyncRoute(async (request, response) => {
  await destroySession(request, response)
  response.status(204).end()
}))

app.get('/api/auth/me', asyncRoute(async (_request, response) => {
  response.json({ user: response.locals.user, authMethod: response.locals.authMethod })
}))

app.post('/api/datasets/ingest', upload.single('file'), asyncRoute(async (request, response) => {
  if (!request.file) {
    throw appError('UPLOAD_REQUIRED')
  }
  const records = await parseDataset(request.file.originalname, request.file.buffer)
  if (records.length > config.maxDatasetRows) {
    throw appError('UPLOAD_TOO_LARGE', { message: `This workspace accepts up to ${config.maxDatasetRows.toLocaleString()} rows per dataset.` })
  }
  const profile = profileDataset(records)
  const persisted = await persistDataset(
    response.locals.user.id,
    request.file.originalname,
    request.file.originalname.split('.').pop()?.toLowerCase() ?? 'unknown',
    records,
    profile,
    sourceHash(request.file.buffer),
    request.file.size,
  )
  const dataset = persisted.dataset
  await notifySafely(response.locals.user.id, {
    type: persisted.reused ? 'dataset_reused' : 'dataset_connected', title: persisted.reused ? 'Existing dataset reused' : 'Dataset connected',
    message: persisted.reused
      ? `${dataset?.filename ?? request.file.originalname} was already in your library, so no duplicate was created.`
      : `${dataset?.filename ?? request.file.originalname} is ready with ${records.length.toLocaleString()} records and ${profile.completeness}% completeness.`,
    severity: 'success', actionUrl: '/app', metadata: { datasetId: dataset?.id, rows: records.length },
  })
  response.status(persisted.reused ? 200 : 201).json({ dataset, reused: persisted.reused })
}))

app.post('/api/datasets/sample', asyncRoute(async (_request, response) => {
  const records = createSampleDataset()
  const profile = profileDataset(records)
  const serializedSample = JSON.stringify(records)
  const persisted = await persistDataset(response.locals.user.id, 'northstar_retail_history.csv', 'csv', records, profile, sourceHash(serializedSample), Buffer.byteLength(serializedSample))
  const dataset = persisted.dataset
  await notifySafely(response.locals.user.id, {
    type: persisted.reused ? 'dataset_reused' : 'dataset_connected', title: persisted.reused ? 'Northstar sample reused' : 'Northstar sample connected',
    message: persisted.reused ? 'The existing Northstar dataset was selected from your library.' : `${records.length.toLocaleString()} records are ready for real analytics and AI analysis.`,
    severity: 'success', actionUrl: '/app', metadata: { datasetId: dataset?.id, sample: true },
  })
  response.status(persisted.reused ? 200 : 201).json({ dataset, reused: persisted.reused })
}))

app.get('/api/notifications', asyncRoute(async (request, response) => {
  const requestedLimit = Number(request.query.limit)
  const result = await listNotifications(response.locals.user.id, Number.isFinite(requestedLimit) ? requestedLimit : 30)
  response.json(result)
}))

app.patch('/api/notifications/:notificationId/read', asyncRoute(async (request, response) => {
  const notification = await markNotificationRead(response.locals.user.id, String(request.params.notificationId ?? ''))
  if (!notification) {
    throw appError('NOT_FOUND')
  }
  response.json({ notification })
}))

app.post('/api/notifications/read-all', asyncRoute(async (_request, response) => {
  const updated = await markAllNotificationsRead(response.locals.user.id)
  response.json({ updated })
}))

app.get('/api/executive/overview', asyncRoute(async (_request, response) => {
  response.json({ overview: await getExecutiveOverview(response.locals.user.id) })
}))

app.get('/api/search', asyncRoute(async (request, response) => {
  const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  if (q.length < 2 || q.length > 200) throw appError('VALIDATION_ERROR', { message: 'Search with between 2 and 200 characters.' })
  const analysisId = typeof request.query.analysisId === 'string' ? request.query.analysisId : undefined
  if (analysisId && !isUuid(analysisId)) throw appError('VALIDATION_ERROR')
  const analysis = analysisId ? await getAnalysis(analysisId, response.locals.user.id) : await getLatestAnalysis(response.locals.user.id)
  response.json(await executiveSearch(response.locals.user.id, q, analysis?.dataset_ids ?? []))
}))

app.get('/api/preferences', asyncRoute(async (_request, response) => {
  response.json({ preferences: await getAiPreferences(response.locals.user.id) })
}))

app.put('/api/preferences', asyncRoute(async (request, response) => {
  const text = (value: unknown, fallback: string, max: number) => typeof value === 'string' ? value.trim().slice(0, max) || fallback : fallback
  const riskTolerance = riskTolerances.includes(request.body?.risk_tolerance) ? request.body.risk_tolerance : 'moderate'
  const personality = personalities.includes(request.body?.personality) ? request.body.personality : 'executive'
  const preferences = await saveAiPreferences(response.locals.user.id, {
    business_type: text(request.body?.business_type, 'General business', 100),
    priority: text(request.body?.priority, 'Business resilience', 160),
    forecast_horizon: text(request.body?.forecast_horizon, '6 months', 60),
    risk_tolerance: riskTolerance,
    personality,
    communication_style: text(request.body?.communication_style, 'executive', 80),
    custom_instructions: text(request.body?.custom_instructions, '', 1_500),
  })
  response.json({ preferences })
}))

app.get('/api/ai-credential', asyncRoute(async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json({ credential: await getAiCredentialStatus(response.locals.user.id) })
}))

app.put('/api/ai-credential', asyncRoute(async (request, response) => {
  const apiKey = typeof request.body?.apiKey === 'string' ? request.body.apiKey : ''
  const model = typeof request.body?.model === 'string' ? request.body.model : ''
  const credential = await saveNvidiaCredential(response.locals.user.id, apiKey, model)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ credential })
}))

app.delete('/api/ai-credential', asyncRoute(async (_request, response) => {
  const credential = await deleteAiCredential(response.locals.user.id)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ credential })
}))

app.post('/api/ai-credential/test', credentialTestLimiter, asyncRoute(async (request, response) => {
  const draftKey = typeof request.body?.apiKey === 'string' ? request.body.apiKey.trim() : ''
  const draftModel = typeof request.body?.model === 'string' ? request.body.model.trim() : ''
  const saved = draftKey ? null : await resolveAiProvider(response.locals.user.id)
  const result = await testNvidiaCredential(draftKey || saved?.apiKey || '', draftModel || saved?.model || '')
  response.setHeader('Cache-Control', 'no-store')
  response.json(result)
}))

app.get('/api/bookmarks', asyncRoute(async (_request, response) => {
  response.json({ bookmarks: await listBookmarks(response.locals.user.id) })
}))

app.post('/api/bookmarks', asyncRoute(async (request, response) => {
  const resourceType = typeof request.body?.resourceType === 'string' ? request.body.resourceType.trim().slice(0, 40) : ''
  const resourceId = typeof request.body?.resourceId === 'string' ? request.body.resourceId.trim().slice(0, 180) : ''
  const title = typeof request.body?.title === 'string' ? request.body.title.trim().slice(0, 180) : ''
  const actionUrl = typeof request.body?.actionUrl === 'string' && /^\/(?:app|onboarding)(?:\/|$)/.test(request.body.actionUrl) ? request.body.actionUrl.slice(0, 300) : '/app'
  const datasetId = typeof request.body?.datasetId === 'string' && isUuid(request.body.datasetId) ? request.body.datasetId : null
  if (!resourceType || !resourceId || !title) throw appError('VALIDATION_ERROR')
  const bookmark = await saveBookmark(response.locals.user.id, { dataset_id: datasetId, resource_type: resourceType, resource_id: resourceId, title, action_url: actionUrl, metadata: {} })
  response.status(201).json({ bookmark })
}))

app.delete('/api/bookmarks/:bookmarkId', asyncRoute(async (request, response) => {
  const bookmarkId = String(request.params.bookmarkId ?? '')
  if (!isUuid(bookmarkId)) throw appError('VALIDATION_ERROR')
  if (!await removeBookmark(response.locals.user.id, bookmarkId)) throw appError('NOT_FOUND')
  response.status(204).end()
}))

app.post('/api/decisions', asyncRoute(async (request, response) => {
  const datasetId = typeof request.body?.datasetId === 'string' ? request.body.datasetId : ''
  const analysisId = typeof request.body?.analysisId === 'string' ? request.body.analysisId : null
  if (!isUuid(datasetId) || (analysisId && !isUuid(analysisId))) throw appError('VALIDATION_ERROR')
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const record = await saveDecision(response.locals.user.id, {
    datasetId, analysisId,
    kind: typeof request.body?.kind === 'string' ? request.body.kind.slice(0, 40) : 'scenario',
    title: typeof request.body?.title === 'string' ? request.body.title.trim().slice(0, 200) : 'Executive decision',
    verdict: typeof request.body?.verdict === 'string' ? request.body.verdict.slice(0, 60) : 'REQUIRES REVIEW',
    risk: typeof request.body?.risk === 'string' ? request.body.risk.slice(0, 20) : 'UNKNOWN',
    confidence: finite(request.body?.confidence), score: finite(request.body?.score),
    proposal: request.body?.proposal && typeof request.body.proposal === 'object' ? request.body.proposal : {},
    result: request.body?.result && typeof request.body.result === 'object' ? request.body.result : {},
  })
  response.status(201).json({ decision: record })
}))

app.post('/api/reports/share', asyncRoute(async (request, response) => {
  const analysisId = typeof request.body?.analysisId === 'string' ? request.body.analysisId : ''
  const reportType = typeof request.body?.reportType === 'string' ? request.body.reportType.trim().slice(0, 60) : 'executive_board_report'
  if (!isUuid(analysisId)) throw appError('VALIDATION_ERROR')
  response.status(201).json({ share: await createShareLink(response.locals.user.id, analysisId, reportType) })
}))

app.get('/api/exports/:scope', asyncRoute(async (request, response) => {
  const scope = String(request.params.scope ?? '').replaceAll('-', '_')
  const allowed = ['executive_brief','forecast_report','team_meetings','decision_room','risk_report','recommendations','business_health','comparative_analysis','all']
  if (!allowed.includes(scope)) throw appError('VALIDATION_ERROR')
  response.json({ bundle: await getExportBundle(response.locals.user.id, scope) })
}))

app.get('/api/datasets', asyncRoute(async (_request, response) => {
  const datasets = await listDatasets(response.locals.user.id, _request.query.archived === 'true')
  response.json({ datasets })
}))

app.patch('/api/datasets/:datasetId', asyncRoute(async (request, response) => {
  const datasetId = String(request.params.datasetId ?? '')
  const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim().replace(/\s+/g, ' ').slice(0, 120) : ''
  if (!isUuid(datasetId) || displayName.length < 2) throw appError('VALIDATION_ERROR', { message: 'Use a dataset name between 2 and 120 characters.' })
  const dataset = await renameDataset(response.locals.user.id, datasetId, displayName)
  if (!dataset) throw appError('NOT_FOUND')
  response.json({ dataset })
}))

app.post('/api/datasets/:datasetId/archive', asyncRoute(async (request, response) => {
  const datasetId = String(request.params.datasetId ?? '')
  if (!isUuid(datasetId)) throw appError('VALIDATION_ERROR')
  const dataset = await archiveDataset(response.locals.user.id, datasetId, request.body?.archived !== false)
  if (!dataset) throw appError('NOT_FOUND')
  response.json({ dataset })
}))

app.patch('/api/datasets/:datasetId/mapping', asyncRoute(async (request, response) => {
  const datasetId = String(request.params.datasetId ?? '')
  const allowedRoles = new Set(['date', 'revenue', 'demand', 'inventory', 'price', 'cost', 'profit', 'holiday', 'external_regressor', 'dimension', 'metric'])
  const supplied = Array.isArray(request.body?.mapping) ? request.body.mapping : []
  const mapping = supplied.filter((item: unknown): item is { name: string; role: never } => Boolean(item && typeof item === 'object' && 'name' in item && 'role' in item && typeof item.name === 'string' && typeof item.role === 'string' && allowedRoles.has(item.role)))
  if (!isUuid(datasetId) || mapping.length !== supplied.length || mapping.length === 0) throw appError('VALIDATION_ERROR', { message: 'Review the dataset column mapping.' })
  const dataset = await updateDatasetMapping(response.locals.user.id, datasetId, mapping)
  if (!dataset) throw appError('NOT_FOUND')
  response.json({ dataset, invalidated: true, message: 'Dependent forecasts were marked for recalculation.' })
}))

app.delete('/api/datasets/:datasetId', asyncRoute(async (request, response) => {
  const datasetId = String(request.params.datasetId ?? '')
  const confirmation = typeof request.body?.confirmation === 'string' ? request.body.confirmation.trim() : ''
  if (!isUuid(datasetId)) throw appError('VALIDATION_ERROR')
  const dataset = await getDataset(datasetId, response.locals.user.id)
  if (!dataset) throw appError('NOT_FOUND')
  const expected = dataset.display_name || dataset.filename
  if (confirmation !== expected) throw appError('VALIDATION_ERROR', { message: `Type “${expected}” to permanently delete this dataset.` })
  if (!await deleteDataset(response.locals.user.id, datasetId)) throw appError('NOT_FOUND')
  response.status(204).end()
}))

app.get('/api/datasets/latest/current', asyncRoute(async (_request, response) => {
  const dataset = await getLatestDataset(response.locals.user.id)
  response.json({ dataset })
}))

app.get('/api/datasets/latest/current/analytics', asyncRoute(async (_request, response) => {
  const dataset = await getLatestDataset(response.locals.user.id)
  if (!dataset) {
    response.json({ analytics: null })
    return
  }
  const analytics = await getDatasetAnalytics(dataset.id, response.locals.user.id)
  response.json({ analytics })
}))

app.get('/api/datasets/:datasetId/note', asyncRoute(async (request, response) => {
  const datasetId = String(request.params.datasetId ?? '')
  if (!isUuid(datasetId)) throw appError('VALIDATION_ERROR')
  response.json({ note: await getDatasetNote(response.locals.user.id, datasetId) })
}))

app.put('/api/datasets/:datasetId/note', asyncRoute(async (request, response) => {
  const datasetId = String(request.params.datasetId ?? '')
  const note = typeof request.body?.note === 'string' ? request.body.note.trim().slice(0, 2_000) : ''
  if (!isUuid(datasetId)) throw appError('VALIDATION_ERROR')
  response.json({ note: await saveDatasetNote(response.locals.user.id, datasetId, note) })
}))

app.post('/api/datasets/recalculate', asyncRoute(async (request, response) => {
  const suppliedIds = Array.isArray(request.body?.datasetIds) ? request.body.datasetIds : []
  const datasetIds: string[] = [...new Set<string>(
    suppliedIds.filter((value: unknown): value is string => typeof value === 'string'),
  )]
  if (datasetIds.length === 0 || datasetIds.length > 5 || datasetIds.some((id) => !isUuid(id))) {
    throw appError('VALIDATION_ERROR', { message: 'Choose between one and five datasets to recalculate.' })
  }
  for (const datasetId of datasetIds) {
    const analytics = await recalculateDatasetAnalytics(datasetId, response.locals.user.id)
    if (!analytics) throw appError('NOT_FOUND')
  }
  response.json({ recalculated: datasetIds.length })
}))

app.get('/api/datasets/:datasetId/analytics', asyncRoute(async (request, response) => {
  const analytics = await getDatasetAnalytics(String(request.params.datasetId ?? ''), response.locals.user.id)
  if (!analytics) {
    throw appError('NOT_FOUND')
  }
  response.json({ analytics })
}))

app.get('/api/datasets/:datasetId', asyncRoute(async (request, response) => {
  const dataset = await getDataset(String(request.params.datasetId ?? ''), response.locals.user.id)
  if (!dataset) {
    throw appError('NOT_FOUND')
  }
  response.json({ dataset })
}))

app.post('/api/analyses', asyncRoute(async (request, response) => {
  const requestedDatasetIds: string[] = Array.isArray(request.body?.datasetIds)
    ? request.body.datasetIds.filter((id: unknown): id is string => typeof id === 'string')
    : typeof request.body?.datasetId === 'string' ? [request.body.datasetId] : []
  const datasetIds = [...new Set<string>(requestedDatasetIds.map((id) => id.trim()).filter(Boolean))]
  const mission = typeof request.body?.mission === 'string' && request.body.mission.trim()
    ? request.body.mission.trim().slice(0, 1_000)
    : 'Forecast revenue and demand over the validated forecast horizon, identify the most material business risk, and recommend the best next action using the detected time frequency.'
  if (datasetIds.length === 0 || datasetIds.length > 5 || datasetIds.some((id) => !isUuid(id))) {
    throw appError('VALIDATION_ERROR', { message: 'Choose between one and five datasets before deploying the AI Team.' })
  }
  const analysisId = await createAnalysis(response.locals.user.id, datasetIds, mission)
  void runAnalysis(analysisId).catch((error: unknown) => {
    const normalized = normalizeError(error)
    console.error(`[AI] Analysis ${analysisId} stopped with ${normalized.code}.`)
  })
  response.status(202).json({ analysisId, status: 'queued' })
}))

app.get('/api/analyses/latest/current', asyncRoute(async (_request, response) => {
  const analysis = await getLatestAnalysis(response.locals.user.id)
  response.json({ analysis })
}))

app.get('/api/analysis-contexts', asyncRoute(async (_request, response) => {
  response.json({ contexts: await listAnalysisContexts(response.locals.user.id) })
}))

app.post('/api/analyses/:analysisId/retry', asyncRoute(async (request, response) => {
  const analysisId = await retryAnalysis(response.locals.user.id, String(request.params.analysisId ?? ''))
  void runAnalysis(analysisId).catch((error: unknown) => {
    const normalized = normalizeError(error)
    console.error(`[AI] Retried analysis ${analysisId} stopped with ${normalized.code}.`)
  })
  response.status(202).json({ analysisId, status: 'queued' })
}))

app.get('/api/analyses/:analysisId', asyncRoute(async (request, response) => {
  const analysis = await getAnalysis(String(request.params.analysisId ?? ''), response.locals.user.id)
  if (!analysis) {
    throw appError('NOT_FOUND')
  }
  response.json({ analysis })
}))

app.get('/api/team/conversations', asyncRoute(async (request, response) => {
  const analysisId = typeof request.query.analysisId === 'string' ? request.query.analysisId : undefined
  if (analysisId && !isUuid(analysisId)) throw appError('VALIDATION_ERROR')
  const context = await getMeetingContext(response.locals.user.id, analysisId)
  if (!context) throw appError('ANALYSIS_REQUIRED')
  const conversations = await listConversations(response.locals.user.id, context.datasets.map((dataset) => dataset.id))
  response.json({ conversations, context })
}))

app.get('/api/team/conversations/:conversationId/context', asyncRoute(async (request, response) => {
  const conversationId = String(request.params.conversationId ?? '')
  if (!isUuid(conversationId)) throw appError('VALIDATION_ERROR')
  const context = await getConversationLinkContext(response.locals.user.id, conversationId)
  if (!context) throw appError('NOT_FOUND')
  response.json({ context: { analysisId: context.analysis_id, contextKey: context.context_key, datasetIds: context.dataset_ids } })
}))

app.get('/api/team/conversations/:conversationId', asyncRoute(async (request, response) => {
  const conversationId = String(request.params.conversationId ?? '')
  if (!isUuid(conversationId)) throw appError('VALIDATION_ERROR')
  const analysisId = typeof request.query.analysisId === 'string' ? request.query.analysisId : undefined
  if (analysisId && !isUuid(analysisId)) throw appError('VALIDATION_ERROR')
  const context = await getMeetingContext(response.locals.user.id, analysisId)
  if (!context) throw appError('ANALYSIS_REQUIRED')
  const conversation = await getConversation(response.locals.user.id, conversationId, context.datasets.map((dataset) => dataset.id))
  if (!conversation) throw appError('NOT_FOUND')
  response.json({ conversation })
}))

app.get('/api/team/jobs/:jobId', asyncRoute(async (request, response) => {
  const jobId = String(request.params.jobId ?? '')
  if (!isUuid(jobId)) throw appError('VALIDATION_ERROR')
  const job = await getMeetingJob(response.locals.user.id, jobId)
  if (!job) throw appError('NOT_FOUND')
  response.json({ job })
}))

app.post('/api/team/jobs/:jobId/cancel', asyncRoute(async (request, response) => {
  const jobId = String(request.params.jobId ?? '')
  if (!isUuid(jobId)) throw appError('VALIDATION_ERROR')
  const requested = await requestMeetingJobCancellation(response.locals.user.id, jobId)
  const job = requested ?? await getMeetingJob(response.locals.user.id, jobId)
  if (!job) throw appError('NOT_FOUND')
  if (requested && job.status !== 'cancelled') cancelRunningMeetingJob(jobId)
  response.status(requested ? 202 : 200).json({ job })
}))

app.post('/api/team/jobs/:jobId/retry', asyncRoute(async (request, response) => {
  const jobId = String(request.params.jobId ?? '')
  if (!isUuid(jobId)) throw appError('VALIDATION_ERROR')
  const job = await retryMeetingJob(response.locals.user.id, jobId)
  if (!job) throw appError('ANALYSIS_IN_PROGRESS', { message: 'This meeting cannot be retried in its current state.' })
  void runMeetingJob(jobId)
  response.status(202).json({ job })
}))

app.post('/api/team/ask', asyncRoute(async (request, response) => {
  const question = typeof request.body?.question === 'string' ? request.body.question.trim() : ''
  const target = isMeetingTarget(request.body?.target) ? request.body.target : 'all'
  const suppliedConversationId = typeof request.body?.conversationId === 'string' ? request.body.conversationId : undefined
  const suppliedAnalysisId = typeof request.body?.analysisId === 'string' ? request.body.analysisId : undefined
  if (suppliedConversationId && !isUuid(suppliedConversationId)) throw appError('VALIDATION_ERROR')
  if (suppliedAnalysisId && !isUuid(suppliedAnalysisId)) throw appError('VALIDATION_ERROR')
  const conversationId = suppliedConversationId
  const analysisId = suppliedAnalysisId
  if (question.length < 3 || question.length > 600) {
    throw appError('VALIDATION_ERROR', { message: 'Ask a question between 3 and 600 characters.' })
  }
  const result = await enqueueTeamMeeting(response.locals.user.id, question, target, conversationId, analysisId)
  void runMeetingJob(result.job.id)
  response.status(202).json(result)
}))

// In production the built frontend (dist/) is served by this same process, so a single
// deploy (e.g. one Render Web Service) exposes both the UI and the API on one origin.
// In development the frontend is served by Vite, and dist/ is usually absent, so this is skipped.
const clientDir = fileURLToPath(new URL('../dist', import.meta.url))
const clientIndex = fileURLToPath(new URL('../dist/index.html', import.meta.url))
if (existsSync(clientIndex)) {
  app.use(express.static(clientDir))
  app.use((request, response, next) => {
    if (request.method === 'GET' && !request.path.startsWith('/api/')) response.sendFile(clientIndex)
    else next()
  })
}

app.use((_request, _response, next) => next(appError('ROUTE_NOT_FOUND')))

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next
  const normalized = normalizeError(error)
  if (normalized.status >= 500) console.error(safeRequestFailureLog(normalized, response.locals.requestId))
  sendErrorResponse(response, normalized, response.locals.requestId)
}

app.use(errorHandler)

async function start() {
  if (config.databaseUrl) await migrate()
  if (config.databaseUrl) {
    const recovered = await recoverInterruptedAnalyses()
    if (recovered > 0) console.warn(`[AI] Marked ${recovered} interrupted analysis job(s) as retryable.`)
    const recoveryTimer = setInterval(() => {
      void recoverInterruptedAnalyses().catch((error: unknown) => {
        const normalized = normalizeError(error)
        console.error(`[AI] Analysis recovery sweep stopped with ${normalized.code}.`)
      })
    }, 60_000)
    recoveryTimer.unref()
    const meetingStaleBefore = () => new Date(Date.now() - config.meetingJobTimeoutMs - 60_000).toISOString()
    // In-process workers cannot survive a server restart, so reclaim every active meeting immediately.
    await recoverableMeetingJobs(new Date().toISOString())
    const queuedMeetings = await listQueuedMeetingJobs()
    for (const job of queuedMeetings) void runMeetingJob(job.id)
    const meetingRecoveryTimer = setInterval(() => {
      void recoverableMeetingJobs(meetingStaleBefore())
        .then(() => listQueuedMeetingJobs())
        .then((jobs) => { for (const job of jobs) void runMeetingJob(job.id) })
        .catch((error: unknown) => {
          const normalized = normalizeError(error)
          console.error(JSON.stringify({ event: 'meeting_recovery_failed', code: normalized.code }))
        })
    }, 60_000)
    meetingRecoveryTimer.unref()
  }
  const host = process.env.HOST ?? '0.0.0.0'
  app.listen(config.port, host, () => {
    const status = configurationStatus()
    console.log(`AI Forecast API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${config.port}`)
    if (!status.database || !status.openai) console.log('Configuration required: copy .env.example to .env and add Neon/inference credentials.')
  })
}

start().catch((error: unknown) => {
  console.error('API failed to start:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
