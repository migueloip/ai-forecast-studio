import { randomUUID } from 'node:crypto'
import { query } from './db.js'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export interface NotificationInput {
  type: string
  title: string
  message: string
  severity?: NotificationSeverity
  actionUrl?: string | null
  metadata?: Record<string, unknown>
}

interface NotificationRow extends Record<string, unknown> {
  id: string
  type: string
  title: string
  message: string
  severity: NotificationSeverity
  action_url: string | null
  metadata: Record<string, unknown>
  read_at: string | null
  created_at: string
}

function safeActionUrl(value?: string | null) {
  return value?.startsWith('/app') || value === '/onboarding' ? value : null
}

export async function createNotification(userId: string, input: NotificationInput) {
  const sourceId = typeof input.metadata?.jobId === 'string' ? input.metadata.jobId
    : typeof input.metadata?.analysisId === 'string' ? input.metadata.analysisId
      : typeof input.metadata?.decisionId === 'string' ? input.metadata.decisionId : null
  const dedupeKey = sourceId ? `${input.type}:${sourceId}` : null
  const rows = await query<NotificationRow>(
    `insert into notifications (id, user_id, type, title, message, severity, action_url, metadata, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     on conflict (user_id, dedupe_key) where dedupe_key is not null do update
       set title=excluded.title, message=excluded.message, severity=excluded.severity,
           action_url=excluded.action_url, metadata=excluded.metadata
     returning id, type, title, message, severity, action_url, metadata, read_at, created_at`,
    [randomUUID(), userId, input.type.slice(0, 80), input.title.slice(0, 160), input.message.slice(0, 500), input.severity ?? 'info', safeActionUrl(input.actionUrl), JSON.stringify(input.metadata ?? {}), dedupeKey],
  )
  return rows[0]!
}

export async function notifySafely(userId: string, input: NotificationInput) {
  try {
    return await createNotification(userId, input)
  } catch (error) {
    console.error('Notification could not be persisted:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function listNotifications(userId: string, limit = 30) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
  const [notifications, counts] = await Promise.all([
    query<NotificationRow>(
      `select id, type, title, message, severity, action_url, metadata, read_at, created_at
       from notifications where user_id = $1 order by created_at desc limit $2`,
      [userId, safeLimit],
    ),
    query<{ unread_count: number }>('select count(*)::integer as unread_count from notifications where user_id = $1 and read_at is null', [userId]),
  ])
  return { notifications, unreadCount: counts[0]?.unread_count ?? 0 }
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const rows = await query<NotificationRow>(
    `update notifications set read_at = coalesce(read_at, now())
     where id::text = $1 and user_id = $2
     returning id, type, title, message, severity, action_url, metadata, read_at, created_at`,
    [notificationId, userId],
  )
  return rows[0] ?? null
}

export async function markAllNotificationsRead(userId: string) {
  const result = await query<{ id: string }>(
    'update notifications set read_at = now() where user_id = $1 and read_at is null returning id',
    [userId],
  )
  return result.length
}
