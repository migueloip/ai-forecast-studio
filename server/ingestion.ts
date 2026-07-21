import { parse as parseCsv } from 'csv-parse/sync'
import { readSheet } from 'read-excel-file/node'

export type CellValue = string | number | boolean | null
export type DatasetRecord = Record<string, CellValue>

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
  sampleRows: DatasetRecord[]
  redactedColumns: string[]
}

const sensitiveColumnPattern = /(^|_)(name|email|phone|mobile|address|street|ssn|tax_id|customer_id|user_id)($|_)/i

function normalizeValue(value: unknown): CellValue {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed)
      if (Number.isFinite(numeric)) return numeric
    }
    return trimmed
  }
  return JSON.stringify(value)
}

function normalizeRecord(record: Record<string, unknown>): DatasetRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key.trim(), normalizeValue(value)]))
}

export async function parseDataset(filename: string, buffer: Buffer): Promise<DatasetRecord[]> {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension === 'csv') {
    const records = parseCsv(buffer, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as Record<string, unknown>[]
    return records.map(normalizeRecord)
  }

  if (extension === 'json') {
    const parsed = JSON.parse(buffer.toString('utf8')) as unknown
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : null
    if (!rows) throw new Error('JSON files must contain an array of records or an object with a data array.')
    return rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Every JSON row must be an object.')
      return normalizeRecord(row as Record<string, unknown>)
    })
  }

  if (extension === 'xlsx') {
    const rows = await readSheet(buffer)
    if (rows.length < 2) throw new Error('The Excel workbook must include a header row and at least one data row.')
    const headers = rows[0]?.map((value, index) => String(value ?? `column_${index + 1}`).trim()) ?? []
    return rows.slice(1).map((row) => normalizeRecord(Object.fromEntries(headers.map((header, index) => [header, row[index]]))))
  }

  throw new Error('Unsupported format. Upload a CSV, XLSX, or JSON file.')
}

function isDateValue(value: CellValue) {
  if (typeof value !== 'string' || !value.trim()) return false
  if (!/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

function inferType(values: CellValue[]): ColumnProfile['type'] {
  const populated = values.filter((value) => value !== null)
  if (!populated.length) return 'string'
  const threshold = Math.max(1, Math.ceil(populated.length * .8))
  if (populated.filter((value) => typeof value === 'number').length >= threshold) return 'number'
  if (populated.filter((value) => typeof value === 'boolean').length >= threshold) return 'boolean'
  if (populated.filter(isDateValue).length >= threshold) return 'date'
  return 'string'
}

function inferRole(name: string, type: ColumnProfile['type']): ColumnProfile['role'] {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (type === 'date' || /(^|_)(date|day|week|month|timestamp|time)($|_)/.test(normalized)) return 'date'
  if (/(revenue|sales|net_sales|turnover|income)/.test(normalized)) return 'revenue'
  if (/(quantity|qty|units|demand|orders)/.test(normalized)) return 'demand'
  if (/(inventory|stock|on_hand|available)/.test(normalized)) return 'inventory'
  if (/(price|unit_price|selling_price)/.test(normalized)) return 'price'
  if (/(cost|cogs|expense)/.test(normalized)) return 'cost'
  return type === 'number' ? 'metric' : 'dimension'
}

function toIsoDate(value: CellValue) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function monthOf(value: CellValue) {
  const date = toIsoDate(value)
  return date ? date.slice(0, 7) : null
}

function redactRow(row: DatasetRecord) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !sensitiveColumnPattern.test(key))) as DatasetRecord
}

export function profileDataset(records: DatasetRecord[]): DatasetProfile {
  if (!records.length) throw new Error('The dataset does not contain any records.')
  const columnNames = [...new Set(records.flatMap((record) => Object.keys(record)))]
  const sample = records.slice(0, 1_000)
  const columns = columnNames.map((name): ColumnProfile => {
    const values = sample.map((record) => record[name] ?? null)
    const populated = values.filter((value) => value !== null)
    const type = inferType(values)
    return {
      name,
      type,
      role: inferRole(name, type),
      completeness: Math.round((populated.length / values.length) * 1_000) / 10,
      uniqueCount: new Set(populated.map(String)).size,
    }
  })

  const dateColumn = columns.find((column) => column.role === 'date')
  const dateValues = dateColumn
    ? records.map((record) => toIsoDate(record[dateColumn.name] ?? null)).filter((value): value is string => Boolean(value)).sort()
    : []
  const numericColumns = columns.filter((column) => column.type === 'number' && column.role !== 'price').slice(0, 5)
  const buckets = new Map<string, Record<string, number>>()

  if (dateColumn) {
    for (const record of records) {
      const period = monthOf(record[dateColumn.name] ?? null)
      if (!period) continue
      const values = buckets.get(period) ?? {}
      for (const column of numericColumns) {
        const value = record[column.name]
        if (typeof value === 'number') values[column.name] = (values[column.name] ?? 0) + value
      }
      buckets.set(period, values)
    }
  }

  const totalCells = records.length * Math.max(columnNames.length, 1)
  const populatedCells = records.reduce((total, row) => total + columnNames.filter((name) => row[name] !== null && row[name] !== undefined).length, 0)
  const redactedColumns = columnNames.filter((name) => sensitiveColumnPattern.test(name))

  return {
    rowCount: records.length,
    columnCount: columnNames.length,
    completeness: Math.round((populatedCells / totalCells) * 1_000) / 10,
    dateRange: dateValues.length ? { start: dateValues[0]!, end: dateValues.at(-1)! } : null,
    columns,
    keyMetrics: columns.filter((column) => ['revenue', 'demand', 'inventory', 'cost'].includes(column.role)).map((column) => column.name),
    timeSeries: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-36).map(([period, values]) => ({ period, values })),
    sampleRows: records.slice(0, 20).map(redactRow),
    redactedColumns,
  }
}

export function createSampleDataset() {
  const records: DatasetRecord[] = []
  const products = [
    { name: 'Product A', price: 42, stock: 1_850 },
    { name: 'Product B', price: 29, stock: 2_600 },
    { name: 'Product C', price: 65, stock: 1_200 },
  ]
  const start = new Date('2024-01-01T00:00:00Z')

  for (let day = 0; day < 730; day += 1) {
    const date = new Date(start.getTime() + day * 86_400_000)
    const month = date.getUTCMonth()
    const weekend = [0, 6].includes(date.getUTCDay())
    for (const [index, product] of products.entries()) {
      const seasonal = month === 11 ? 1.34 : month >= 8 ? 1.12 : 1
      const trend = 1 + day / 4_000
      const quantity = Math.round((18 + index * 5 + (day % 7)) * seasonal * trend * (weekend ? 1.22 : 1))
      const unitPrice = product.price + (day > 500 ? 2 : 0)
      const stock = Math.max(40, product.stock - ((day * quantity) % product.stock))
      records.push({
        order_date: date.toISOString().slice(0, 10),
        product: product.name,
        quantity,
        unit_price: unitPrice,
        net_sales: quantity * unitPrice,
        stock_on_hand: stock,
        cost: Math.round(quantity * unitPrice * .58),
        channel: weekend ? 'Store' : day % 3 === 0 ? 'Online' : 'Store',
      })
    }
  }
  return records
}
