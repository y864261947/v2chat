import { getMessageText } from '@shared/utils/message'
import { V2API_BASE_URL, V2API_DEFAULT_TTS_MODEL, V2API_DEFAULT_TTS_VOICE } from '@shared/v2api'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { apiRequest } from '@/utils/request'
import type { Message } from '@shared/types'

const VOICE_INTENT_PATTERN =
  /(发语音|语音回复|用语音|语音回答|读出来|念出来|朗读|用声音|voice reply|audio reply|speak|read it aloud)/i

export function hasVoiceReplyIntent(message?: Message): boolean {
  if (!message) return false
  return VOICE_INTENT_PATTERN.test(getMessageText(message, false, false))
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    chunks.push(String.fromCharCode(...chunk))
  }
  return btoa(chunks.join(''))
}

export async function generateV2APISpeech(params: {
  apiKey: string
  input: string
  sessionId: string
  messageId: string
  model?: string
  voice?: string
}) {
  if (!params.apiKey.trim()) {
    throw new Error('V2API API Key is required for speech generation.')
  }
  if (!params.input.trim()) {
    throw new Error('No assistant text available for speech generation.')
  }

  const response = await apiRequest.post(
    `${V2API_BASE_URL}/audio/speech`,
    {
      Authorization: `Bearer ${params.apiKey}`,
    },
    JSON.stringify({
      model: params.model || V2API_DEFAULT_TTS_MODEL,
      voice: params.voice || V2API_DEFAULT_TTS_VOICE,
      input: params.input,
      response_format: 'mp3',
    }),
    {
      retry: 0,
      useProxy: false,
    }
  )

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg'
  const base64 = arrayBufferToBase64(await response.arrayBuffer())
  const storageKey = StorageKeyGenerator.audio(`${params.sessionId}:${params.messageId}`)
  await storage.setBlob(storageKey, `data:${mimeType};base64,${base64}`)

  return {
    storageKey,
    mimeType,
  }
}
