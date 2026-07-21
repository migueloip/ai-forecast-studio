import 'dotenv/config'

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function reasoningEffort(value: string | undefined): 'low' | 'medium' | 'high' {
  return value === 'medium' || value === 'high' ? value : 'low'
}

const usingLegacyNvidiaKey = Boolean(process.env.api_key)
const defaultOrigins = 'http://localhost:5173,http://127.0.0.1:5173'

export const config = {
  port: positiveInteger(process.env.PORT ?? process.env.API_PORT, 8787),
  appOrigins: (process.env.APP_ORIGIN ?? defaultOrigins).split(',').map((origin) => origin.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? '',
  aiApiKey: process.env.AI_API_KEY ?? process.env.NVIDIA_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.api_key ?? '',
  aiBaseUrl: process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? (usingLegacyNvidiaKey ? 'https://integrate.api.nvidia.com/v1' : 'https://api.openai.com/v1'),
  aiModel: process.env.AI_MODEL ?? (usingLegacyNvidiaKey ? 'openai/gpt-oss-120b' : process.env.OPENAI_MODEL ?? 'gpt-5.4-mini'),
  aiTimeoutMs: positiveInteger(process.env.AI_TIMEOUT_MS, 300_000),
  aiMaxRetries: nonNegativeInteger(process.env.AI_MAX_RETRIES, 1),
  aiMaxOutputTokens: positiveInteger(process.env.AI_MAX_OUTPUT_TOKENS, 1_200),
  aiBriefingMaxTokens: positiveInteger(process.env.AI_BRIEFING_MAX_TOKENS, 1_600),
  aiReasoningEffort: reasoningEffort(process.env.AI_REASONING_EFFORT),
  meetingJobTimeoutMs: positiveInteger(process.env.MEETING_JOB_TIMEOUT_MS, 360_000),
  maxUploadBytes: positiveInteger(process.env.MAX_UPLOAD_MB, 25) * 1024 * 1024,
  maxDatasetRows: positiveInteger(process.env.MAX_DATASET_ROWS, 50_000),
}

export function configurationStatus() {
  return {
    database: Boolean(config.databaseUrl),
    openai: Boolean(config.aiApiKey),
    model: config.aiModel,
    provider: new URL(config.aiBaseUrl).hostname,
  }
}
