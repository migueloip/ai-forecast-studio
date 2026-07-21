import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Request, RequestHandler, Response } from 'express'
import { query } from './db.js'
import { appError } from './errors/index.js'

const scrypt = promisify(scryptCallback)
const sessionCookie = 'forecast_session'
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1_000
type TokenType = 'browser' | 'api'

interface UserRow extends Record<string, unknown> {
  id: string
  email: string
  full_name: string
  password_hash: string
  created_at: string
}

export interface PublicUser {
  id: string
  email: string
  fullName: string
  createdAt: string
}

function publicUser(user: UserRow): PublicUser {
  return { id: user.id, email: user.email, fullName: user.full_name, createdAt: user.created_at }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltEncoded, hashEncoded] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltEncoded || !hashEncoded) return false
  const expected = Buffer.from(hashEncoded, 'base64url')
  const actual = await scrypt(password, Buffer.from(saltEncoded, 'base64url'), expected.length) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function bearerToken(request: Request) {
  const authorization = request.headers.authorization
  if (!authorization) return null
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{40,200})$/)
  return match?.[1] ?? null
}

function requestToken(request: Request) {
  if (request.headers.authorization) return bearerToken(request)
  return cookieMap(request)[sessionCookie] ?? null
}

function cookieMap(request: Request) {
  const header = request.headers.cookie ?? ''
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=')
    return separator < 0 ? [part, ''] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
  }))
}

function setSessionCookie(response: Response, token: string, expires: Date) {
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  })
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' })
}

export async function registerUser(fullName: string, email: string, password: string) {
  const id = randomUUID()
  const normalizedEmail = normalizeEmail(email)
  const passwordHash = await hashPassword(password)
  try {
    const users = await query<UserRow>(
      `insert into users (id, email, full_name, password_hash)
       values ($1, $2, $3, $4)
       returning *`,
      [id, normalizedEmail, fullName.trim(), passwordHash],
    )
    return publicUser(users[0]!)
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      throw appError('ACCOUNT_EXISTS', { cause: error })
    }
    throw error
  }
}

export async function authenticateUser(email: string, password: string) {
  const users = await query<UserRow>('select * from users where lower(email) = $1 limit 1', [normalizeEmail(email)])
  const user = users[0]
  if (!user || !(await verifyPassword(password, user.password_hash))) return null
  return publicUser(user)
}

export async function createSession(response: Response | null, userId: string, tokenType: TokenType = 'browser', label?: string) {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + sessionLifetimeMs)
  await query('delete from sessions where user_id = $1 and (expires_at <= now() or revoked_at is not null)', [userId])
  await query('insert into sessions (token_hash, user_id, expires_at, token_type, label) values ($1, $2, $3, $4, $5)', [tokenHash(token), userId, expires.toISOString(), tokenType, label?.trim().slice(0, 80) || null])
  if (response && tokenType === 'browser') setSessionCookie(response, token, expires)
  return { token, expiresAt: expires.toISOString() }
}

export async function destroySession(request: Request, response: Response) {
  const token = requestToken(request)
  if (token) await query('update sessions set revoked_at = now() where token_hash = $1', [tokenHash(token)])
  clearSessionCookie(response)
}

export async function currentUser(request: Request) {
  const token = requestToken(request)
  if (!token) return null
  const users = await query<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and s.revoked_at is null limit 1`,
    [tokenHash(token)],
  )
  return users[0] ? publicUser(users[0]) : null
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  try {
    const user = await currentUser(request)
    if (!user) {
      next(appError('AUTH_REQUIRED'))
      return
    }
    response.locals.user = user
    response.locals.authMethod = request.headers.authorization ? 'bearer' : 'cookie'
    next()
  } catch (error) {
    next(error)
  }
}
