import { neon } from '@neondatabase/serverless'
import { config } from './config.js'

let client: ReturnType<typeof neon> | undefined

export class ConfigurationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ConfigurationError'
  }
}

function getClient() {
  if (!config.databaseUrl) {
    throw new ConfigurationError('DATABASE_URL is not configured. Add your Neon pooled connection string to .env.')
  }
  client ??= neon(config.databaseUrl)
  return client
}

export async function query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
  return getClient().query(text, values) as Promise<T[]>
}

export async function databaseIsReachable() {
  if (!config.databaseUrl) return false
  try {
    await query('select 1 as ok')
    return true
  } catch {
    return false
  }
}
