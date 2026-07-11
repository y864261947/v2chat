import { describe, expect, it } from 'vitest'
import { __backupTesting } from './v2chatBackup'

const manifest = {
  type: 'manifest' as const,
  manifest: {
    format: 'V2CHAT-BACKUP' as const,
    version: 1 as const,
    createdAt: '2026-07-10T00:00:00.000Z',
    counts: {
      sessions: 1, messages: 1, characters: 0, blobs: 1,
      sessionMeta: 0, imageGenerations: 0, taskSessions: 0, estimatedBytes: 100,
    },
  },
}

describe('V2CHAT-BACKUP v1', () => {
  it('round trips chunked AES-GCM records', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const records = [
      manifest,
      { type: 'value' as const, key: 'session:1', value: { id: '1', messages: [{ text: '你好' }] } },
      { type: 'blob' as const, key: 'audio:1', value: `data:audio/mpeg;base64,${'YQ=='.repeat(400_000)}` },
    ]
    const encoded = await __backupTesting.encode(records, key)
    const decoded = await __backupTesting.decode(encoded.blob, key)
    expect(decoded.slice(0, -1)).toEqual(records)
    expect(decoded.at(-1)).toEqual({ type: 'end', recordCount: records.length })
    expect(encoded.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects wrong keys and tampered ciphertext', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const encoded = await __backupTesting.encode([manifest], key)
    await expect(__backupTesting.decode(encoded.blob, crypto.getRandomValues(new Uint8Array(32)))).rejects.toBeTruthy()

    const bytes = new Uint8Array(await encoded.blob.arrayBuffer())
    bytes[bytes.length - 1] ^= 1
    await expect(__backupTesting.decode(new Blob([bytes]), key)).rejects.toBeTruthy()
  })

  it('removes credentials without deleting normal token statistics', () => {
    expect(__backupTesting.scrubSecrets({
      apiKey: 'secret', refresh_token: 'secret', password: 'secret', tokenCount: 42,
      nested: { ttsApiKey: 'secret', text: 'keep me' },
    })).toEqual({ tokenCount: 42, nested: { text: 'keep me' } })
  })
})
