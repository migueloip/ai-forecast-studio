import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { encryptApiKey, decryptApiKey, validNvidiaModel } from './ai-credentials.js'
import { config } from './config.js'

const originalEncryptionKey = config.credentialEncryptionKey

beforeEach(() => {
  config.credentialEncryptionKey = Buffer.alloc(32, 7).toString('base64')
})

afterEach(() => {
  config.credentialEncryptionKey = originalEncryptionKey
})

test('encrypts and decrypts an NVIDIA API key without storing plaintext', () => {
  const encrypted = encryptApiKey('user-a', 'nvapi-private-value-1234567890')
  assert.equal(encrypted.ciphertext.includes('nvapi-private-value'), false)
  assert.equal(decryptApiKey('user-a', {
    api_key_ciphertext: encrypted.ciphertext,
    api_key_iv: encrypted.iv,
    api_key_auth_tag: encrypted.authTag,
  }), 'nvapi-private-value-1234567890')
})

test('binds encrypted credentials to the owning user', () => {
  const encrypted = encryptApiKey('user-a', 'nvapi-private-value-1234567890')
  assert.throws(() => decryptApiKey('user-b', {
    api_key_ciphertext: encrypted.ciphertext,
    api_key_iv: encrypted.iv,
    api_key_auth_tag: encrypted.authTag,
  }))
})

test('accepts NVIDIA catalog model identifiers and rejects arbitrary values', () => {
  assert.equal(validNvidiaModel('openai/gpt-oss-120b'), true)
  assert.equal(validNvidiaModel('meta/llama-3.3-70b-instruct'), true)
  assert.equal(validNvidiaModel('https://attacker.example/model'), false)
})
