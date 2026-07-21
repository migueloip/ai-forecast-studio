import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import OpenAI from 'openai'
import { config } from './config.js'
import { ConfigurationError, query } from './db.js'
import { appError } from './errors/index.js'

export const nvidiaBaseUrl = 'https://integrate.api.nvidia.com/v1'
export const defaultNvidiaModel = 'openai/gpt-oss-120b'

interface CredentialRow extends Record<string, unknown> {
  provider: 'nvidia'
  api_key_ciphertext: string
  api_key_iv: string
  api_key_auth_tag: string
  key_hint: string
  model: string
  base_url: string
  updated_at: string
}

export interface AiProviderCredential {
  apiKey: string
  baseUrl: string
  model: string
  source: 'user' | 'server'
}

function encryptionKey() {
  const key = Buffer.from(config.credentialEncryptionKey, 'base64')
  if (key.length !== 32) {
    throw new ConfigurationError('CREDENTIAL_ENCRYPTION_KEY must be a stable base64-encoded 32-byte key.')
  }
  return key
}

export function credentialEncryptionReady() {
  try {
    return encryptionKey().length === 32
  } catch {
    return false
  }
}

function additionalData(userId: string) {
  return Buffer.from(`ai-forecast-studio:${userId}:nvidia:v1`)
}

export function encryptApiKey(userId: string, apiKey: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(additionalData(userId))
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  }
}

export function decryptApiKey(userId: string, encrypted: Pick<CredentialRow, 'api_key_ciphertext' | 'api_key_iv' | 'api_key_auth_tag'>) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encrypted.api_key_iv, 'base64url'))
    decipher.setAAD(additionalData(userId))
    decipher.setAuthTag(Buffer.from(encrypted.api_key_auth_tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.api_key_ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (error) {
    throw new ConfigurationError('The saved NVIDIA API key could not be decrypted with CREDENTIAL_ENCRYPTION_KEY.', { cause: error })
  }
}

function validApiKey(apiKey: string) {
  return apiKey.length >= 20 && apiKey.length <= 500 && !/\s/.test(apiKey)
}

export function validNvidiaModel(model: string) {
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(model) && model.length <= 160
}

async function credentialRow(userId: string) {
  const rows = await query<CredentialRow>(
    `select provider,api_key_ciphertext,api_key_iv,api_key_auth_tag,key_hint,model,base_url,updated_at
     from user_ai_credentials where user_id=$1`,
    [userId],
  )
  return rows[0] ?? null
}

export async function getAiCredentialStatus(userId: string) {
  const row = await credentialRow(userId)
  if (row) {
    return {
      configured: true,
      source: 'user' as const,
      provider: 'nvidia' as const,
      maskedKey: row.key_hint,
      model: row.model,
      baseUrl: row.base_url,
      encryptedAtRest: true,
      encryptionReady: credentialEncryptionReady(),
      updatedAt: row.updated_at,
    }
  }
  return {
    configured: Boolean(config.aiApiKey),
    source: config.aiApiKey ? 'server' as const : 'none' as const,
    provider: config.aiBaseUrl.includes('nvidia.com') ? 'nvidia' as const : 'server' as const,
    maskedKey: config.aiApiKey ? 'Configured by server' : null,
    model: config.aiModel,
    baseUrl: config.aiBaseUrl,
    encryptedAtRest: false,
    encryptionReady: credentialEncryptionReady(),
    updatedAt: null,
  }
}

export async function saveNvidiaCredential(userId: string, apiKey: string, model: string) {
  const normalizedKey = apiKey.trim()
  const normalizedModel = model.trim()
  if (!validApiKey(normalizedKey) || !validNvidiaModel(normalizedModel)) throw appError('VALIDATION_ERROR')
  const encrypted = encryptApiKey(userId, normalizedKey)
  const hint = `••••${normalizedKey.slice(-4)}`
  await query(
    `insert into user_ai_credentials
       (user_id,provider,api_key_ciphertext,api_key_iv,api_key_auth_tag,key_hint,model,base_url)
     values ($1,'nvidia',$2,$3,$4,$5,$6,$7)
     on conflict (user_id) do update set provider='nvidia',api_key_ciphertext=excluded.api_key_ciphertext,
       api_key_iv=excluded.api_key_iv,api_key_auth_tag=excluded.api_key_auth_tag,key_hint=excluded.key_hint,
       model=excluded.model,base_url=excluded.base_url,updated_at=now()`,
    [userId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, hint, normalizedModel, nvidiaBaseUrl],
  )
  return getAiCredentialStatus(userId)
}

export async function deleteAiCredential(userId: string) {
  await query('delete from user_ai_credentials where user_id=$1', [userId])
  return getAiCredentialStatus(userId)
}

export async function resolveAiProvider(userId: string): Promise<AiProviderCredential> {
  const row = await credentialRow(userId)
  if (row) {
    return {
      apiKey: decryptApiKey(userId, row),
      baseUrl: row.base_url,
      model: row.model,
      source: 'user',
    }
  }
  if (!config.aiApiKey) {
    throw new ConfigurationError('Add an NVIDIA API key in Settings or configure AI_API_KEY on the server.')
  }
  return { apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl, model: config.aiModel, source: 'server' }
}

export async function testNvidiaCredential(apiKey: string, model: string) {
  const normalizedKey = apiKey.trim()
  const normalizedModel = model.trim()
  if (!validApiKey(normalizedKey) || !validNvidiaModel(normalizedModel)) throw appError('VALIDATION_ERROR')
  const client = new OpenAI({ apiKey: normalizedKey, baseURL: nvidiaBaseUrl, timeout: Math.min(config.aiTimeoutMs, 20_000), maxRetries: 0 })
  try {
    await client.chat.completions.create({
      model: normalizedModel,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 1,
      stream: false,
    })
    return { ok: true, model: normalizedModel }
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : null
    if (status === 401 || status === 403) throw appError('AI_CREDENTIAL_INVALID', { cause: error })
    if (status === 400 || status === 404) throw appError('AI_MODEL_UNAVAILABLE', { cause: error })
    throw appError('AI_UNAVAILABLE', { cause: error })
  }
}
