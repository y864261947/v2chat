import { getMessageText } from '@shared/utils/message'
import {
  getV2ChatServiceBaseUrl,
  V2API_DEFAULT_ELEVENLABS_VOICE,
  V2API_DEFAULT_TRANSCRIPTION_MODEL,
} from '@shared/v2api'
import type { Message } from '@shared/types'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { v2chatAuthenticatedFetch } from '@/stores/v2chatAccountStore'

const VOICE_INTENT_PATTERN =
  /(发(一条|一段|个)?语音|发送(一条|一段|个)?语音|回(一条|一段|个)?语音|回复(一条|一段|个)?语音|语音条|语音消息|语音回复|用语音|语音回答|读出来|念出来|朗读|用声音|你能.*(语音|声音).*吗|给我.*(语音|声音)|voice reply|voice message|audio reply|audio message|speak|read it aloud)/i

export function hasVoiceReplyIntent(message?: Message): boolean {
  if (!message) return false
  return VOICE_INTENT_PATTERN.test(getMessageText(message, false, false))
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
  }
  return btoa(chunks.join(''))
}

async function gatewayError(response: Response, fallback: string) {
  const text = await response.text().catch(() => '')
  if (!text) return fallback
  try {
    const payload = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return payload.error?.message || payload.message || fallback
  } catch {
    return fallback
  }
}

export async function generateSpeech(params: {
  input: string
  sessionId: string
  messageId: string
  voice?: string
}) {
  const input = params.input.trim()
  if (!input) throw new Error('没有可用于生成语音的回复内容。')

  const response = await v2chatAuthenticatedFetch(`${getV2ChatServiceBaseUrl()}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      voice: params.voice || V2API_DEFAULT_ELEVENLABS_VOICE,
      response_format: 'mp3',
    }),
  })
  if (!response.ok) {
    throw new Error(await gatewayError(response, `语音生成失败（HTTP ${response.status}）`))
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg'
  const storageKey = StorageKeyGenerator.audio(`${params.sessionId}:${params.messageId}`)
  const base64 = arrayBufferToBase64(await response.arrayBuffer())
  await storage.setBlob(storageKey, `data:${mimeType};base64,${base64}`)

  return { storageKey, mimeType }
}

export async function transcribeAudio(params: {
  audio: Blob
  fileName?: string
  durationMs?: number
}) {
  const formData = new FormData()
  const fileName = params.fileName || `recording-${Date.now()}.webm`
  formData.append('file', new File([params.audio], fileName, { type: params.audio.type || 'audio/webm' }))
  formData.append('model', V2API_DEFAULT_TRANSCRIPTION_MODEL)
  formData.append('response_format', 'json')

  const response = await v2chatAuthenticatedFetch(`${getV2ChatServiceBaseUrl()}/audio/transcriptions`, {
    method: 'POST',
    headers: params.durationMs ? { 'X-Audio-Duration-Ms': String(params.durationMs) } : undefined,
    body: formData,
  })
  if (!response.ok) {
    throw new Error(await gatewayError(response, `语音转写失败（HTTP ${response.status}）`))
  }

  const data = (await response.json()) as { text?: string; error?: { message?: string } }
  if (data.error?.message) throw new Error(data.error.message)
  return (data.text || '').trim()
}
