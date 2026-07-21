import { randomUUID } from 'node:crypto'
import { query } from './db.js'
import type { DatasetProfile, DatasetRecord } from './ingestion.js'
import { buildDatasetAnalytics } from './analytics.js'
import type { DatasetAnalytics } from './analytics.js'
import { enrichForecastIntelligence } from './forecast-intelligence.js'

interface DatasetRow extends Record<string, unknown> {
  id: string
  workspace_id: string
  filename: string
  file_type: string
  row_count: number
  column_count: number
  columns: DatasetProfile['columns']
  summary: DatasetProfile
  analytics: DatasetAnalytics | null
  file_size_bytes: number | null
  created_at: string
  display_name: string | null
  archived_at: string | null
}

export interface DatasetHistoryRow extends Record<string, unknown> {
  id: string
  filename: string
  display_name: string | null
  file_type: string
  row_count: number
  column_count: number
  file_size_bytes: number | null
  completeness: number
  date_range: DatasetProfile['dateRange']
  key_metrics: string[]
  analysis_count: number
  latest_analysis_status: string | null
  latest_forecast_confidence: number | null
  note: string
  archived_at: string | null
  created_at: string
}

async function getOrCreateWorkspace(userId: string, name = 'Northstar Retail') {
  const existing = await query<{ id: string }>('select id from workspaces where owner_user_id = $1 and name = $2 order by created_at asc limit 1', [userId, name])
  if (existing[0]) return existing[0].id
  const id = randomUUID()
  await query('insert into workspaces (id, name, business_type, owner_user_id) values ($1, $2, $3, $4)', [id, name, 'retail', userId])
  return id
}

export async function findDatasetBySourceHash(userId: string, sourceHash: string) {
  const datasets = await query<DatasetRow>(
    `select d.* from datasets d join workspaces w on w.id = d.workspace_id
     where w.owner_user_id = $1 and d.source_hash = $2
     order by d.created_at desc limit 1`,
    [userId, sourceHash],
  )
  return datasets[0] ?? null
}

export async function persistDataset(userId: string, filename: string, fileType: string, records: DatasetRecord[], profile: DatasetProfile, sourceHash?: string, fileSizeBytes?: number) {
  if (sourceHash) {
    const existing = await findDatasetBySourceHash(userId, sourceHash)
    if (existing) return { dataset: existing, reused: true }
  }
  const workspaceId = await getOrCreateWorkspace(userId)
  const datasetId = randomUUID()
  const analytics = await enrichForecastIntelligence(buildDatasetAnalytics(records, profile), profile)
  try {
    await query(
      `insert into datasets (id, workspace_id, filename, file_type, row_count, column_count, columns, summary, analytics, source_hash, file_size_bytes)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
      [datasetId, workspaceId, filename, fileType, profile.rowCount, profile.columnCount, JSON.stringify(profile.columns), JSON.stringify(profile), JSON.stringify(analytics), sourceHash ?? null, fileSizeBytes ?? null],
    )
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
    if (sourceHash && code === '23505') {
      const existing = await findDatasetBySourceHash(userId, sourceHash)
      if (existing) return { dataset: existing, reused: true }
    }
    throw error
  }

  const chunkSize = 500
  for (let start = 0; start < records.length; start += chunkSize) {
    const chunk = records.slice(start, start + chunkSize).map((payload, index) => ({ rowIndex: start + index, payload }))
    await query(
      `insert into dataset_rows (dataset_id, row_index, payload)
       select $1::uuid, (item->>'rowIndex')::integer, item->'payload'
       from jsonb_array_elements($2::jsonb) as item`,
      [datasetId, JSON.stringify(chunk)],
    )
  }
  return { dataset: await getDataset(datasetId, userId), reused: false }
}

export async function listDatasets(userId: string, includeArchived = false) {
  return query<DatasetHistoryRow>(
    `select d.id, d.filename, d.display_name, d.file_type, d.row_count, d.column_count, d.file_size_bytes,
       coalesce((d.summary->>'completeness')::double precision, 0) as completeness,
       d.summary->'dateRange' as date_range,
       coalesce(d.summary->'keyMetrics', '[]'::jsonb) as key_metrics,
       (select count(*)::integer from analysis_datasets ad where ad.dataset_id = d.id) as analysis_count,
       (select a.status from analysis_datasets ad join analyses a on a.id = ad.analysis_id
        where ad.dataset_id = d.id order by a.created_at desc limit 1) as latest_analysis_status,
       (d.analytics->'forecasts'->'metrics'->'revenue'->>'confidence')::double precision as latest_forecast_confidence,
       coalesce((select dn.note from dataset_notes dn where dn.dataset_id = d.id and dn.user_id = $1), '') as note,
       d.archived_at, d.created_at
     from datasets d join workspaces w on w.id = d.workspace_id
     where w.owner_user_id = $1 and ($2::boolean or d.archived_at is null) order by d.created_at desc`,
    [userId, includeArchived],
  )
}

export async function getDataset(datasetId: string, userId?: string) {
  const datasets = userId
    ? await query<DatasetRow>(
      `select d.* from datasets d join workspaces w on w.id = d.workspace_id
       where d.id = $1 and w.owner_user_id = $2`,
      [datasetId, userId],
    )
    : await query<DatasetRow>('select * from datasets where id = $1', [datasetId])
  return datasets[0] ?? null
}

export async function getDatasetContext(datasetId: string, userId?: string) {
  const dataset = await getDataset(datasetId, userId)
  if (!dataset) return null
  return { dataset, sampleRows: dataset.summary.sampleRows }
}

export async function getDatasetAnalytics(datasetId: string, userId: string) {
  const dataset = await getDataset(datasetId, userId)
  if (!dataset) return null
  if (dataset.analytics?.version === 5 && dataset.analytics.intelligence?.status === 'ready' && dataset.analytics.intelligence.engineVersion === '2.0') return dataset.analytics
  return buildAndPersistDatasetAnalytics(dataset)
}

async function buildAndPersistDatasetAnalytics(dataset: DatasetRow) {
  const rows = await query<{ payload: DatasetRecord }>('select payload from dataset_rows where dataset_id = $1 order by row_index asc', [dataset.id])
  const analytics = await enrichForecastIntelligence(buildDatasetAnalytics(rows.map((row) => row.payload), dataset.summary), dataset.summary)
  await query('update datasets set analytics = $2::jsonb where id = $1', [dataset.id, JSON.stringify(analytics)])
  return analytics
}

export async function recalculateDatasetAnalytics(datasetId: string, userId: string) {
  const dataset = await getDataset(datasetId, userId)
  if (!dataset) return null
  return buildAndPersistDatasetAnalytics(dataset)
}

export async function getLatestDataset(userId: string) {
  const datasets = await query<DatasetRow>(
    `with active_analysis as (
       select a.dataset_id from analyses a
       join datasets source on source.id = a.dataset_id
       join workspaces source_workspace on source_workspace.id = source.workspace_id
       where source_workspace.owner_user_id = $1
       order by a.created_at desc limit 1
     )
     select d.* from datasets d join workspaces w on w.id = d.workspace_id
     where w.owner_user_id = $1 and d.archived_at is null
     order by (d.id = (select dataset_id from active_analysis)) desc nulls last, d.created_at desc limit 1`,
    [userId],
  )
  return datasets[0] ?? null
}

export async function renameDataset(userId: string, datasetId: string, displayName: string) {
  const rows = await query<DatasetRow>(
    `update datasets d set display_name = $3
     from workspaces w where d.workspace_id = w.id and d.id = $1 and w.owner_user_id = $2
     returning d.*`,
    [datasetId, userId, displayName],
  )
  return rows[0] ?? null
}

export async function archiveDataset(userId: string, datasetId: string, archived: boolean) {
  const rows = await query<DatasetRow>(
    `update datasets d set archived_at = case when $3 then now() else null end
     from workspaces w where d.workspace_id = w.id and d.id = $1 and w.owner_user_id = $2
     returning d.*`,
    [datasetId, userId, archived],
  )
  return rows[0] ?? null
}

export async function deleteDataset(userId: string, datasetId: string) {
  const rows = await query<{ id: string }>(
    `delete from datasets d using workspaces w
     where d.workspace_id = w.id and d.id = $1 and w.owner_user_id = $2 returning d.id`,
    [datasetId, userId],
  )
  return Boolean(rows[0])
}

export async function updateDatasetMapping(userId: string, datasetId: string, mapping: Array<{ name: string; role: DatasetProfile['columns'][number]['role'] }>) {
  const dataset = await getDataset(datasetId, userId)
  if (!dataset) return null
  const roles = new Map(mapping.map((item) => [item.name, item.role]))
  if (mapping.some((item) => !dataset.columns.some((column) => column.name === item.name))) return null
  const columns = dataset.columns.map((column) => ({ ...column, role: roles.get(column.name) ?? column.role }))
  const summary = { ...dataset.summary, columns }
  const rows = await query<DatasetRow>(
    `update datasets set columns = $2::jsonb, summary = $3::jsonb, analytics = null where id = $1 returning *`,
    [datasetId, JSON.stringify(columns), JSON.stringify(summary)],
  )
  await query(
    `update analyses set invalidated_at = now(), updated_at = now()
     where id in (select analysis_id from analysis_datasets where dataset_id = $1)`,
    [datasetId],
  )
  return rows[0] ?? null
}
