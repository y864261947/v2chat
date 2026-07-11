import { ModelProviderEnum } from './types/provider'

export const V2API_BASE_URL = 'https://v2api.top/v1'
export const V2CHAT_SERVICE_BASE_URL = 'https://chat.v2api.top/v1'
export const V2API_DEFAULT_CHAT_MODEL = 'gpt-4o-mini'
// Compatibility exports remain empty so older modules compile without shipping credentials.
export const V2API_TEST_API_KEY = ''
export const V2API_LEGACY_TEST_API_KEYS: string[] = []
export const V2API_TEST_IMAGE_API_KEY = ''
export const V2API_TEST_ELEVENLABS_API_KEY = ''
export const V2API_TEST_GROQ_API_KEY = ''
export const V2API_DEFAULT_TTS_PROVIDER = 'elevenlabs'
export const V2API_DEFAULT_TTS_BASE_URL = 'https://api.openai.com/v1'
export const V2API_DEFAULT_TTS_MODEL = 'tts-1'
export const V2API_DEFAULT_TTS_VOICE = 'alloy'
export const V2API_DEFAULT_ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1'
export const V2API_DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2'
export const V2API_DEFAULT_ELEVENLABS_VOICE = 'EXAVITQu4vr4xnSDxMaL'
export const V2API_DEFAULT_GROQ_TTS_BASE_URL = 'https://api.groq.com/openai/v1'
export const V2API_DEFAULT_GROQ_TTS_MODEL = 'playai-tts'
export const V2API_DEFAULT_GROQ_TTS_VOICE = 'Fritz-PlayAI'
export const V2API_DEFAULT_TRANSCRIPTION_BASE_URL = 'https://api.groq.com/openai/v1'
export const V2API_DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'
export const V2API_DEFAULT_IMAGE_BASE_URL = 'https://v2api.top/v1'
export const V2API_DEFAULT_IMAGE_MODEL = 'gpt-image-2'

const RETIRED_TEST_KEY_HASHES = new Set([
  '194db5c07f8d97ea0bedd932f9678b38adc48f054f4eafaf6a8de4ae90b64062',
  'ae31b4cbfe1c777d3dd238febf360211b12135b5679143e40b19e734cf54a811',
  '7a46081c87a482171878279b8e34d3b19775fbc49f50afd91cb01facaafc4ae0',
  '0ba4f2bace287e28f0626392ba430375f1329500193d458a1fc20f4fa91e389a',
  '2dd9cf88c387173f5b36a1c2a5b741810cdce5749542b0890f2b68322b16027e',
])

export function getV2ChatServiceBaseUrl(options?: { allowLocalPreview?: boolean }) {
  const allowLocalPreview = options?.allowLocalPreview ?? true
  if (
    allowLocalPreview &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return window.localStorage.getItem('v2chat-api-base-url') || 'http://127.0.0.1:8080/v1'
  }
  return V2CHAT_SERVICE_BASE_URL
}

export async function isRetiredV2ChatTestKey(value?: string) {
  if (!value?.trim() || typeof crypto === 'undefined' || !crypto.subtle) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.trim()))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return RETIRED_TEST_KEY_HASHES.has(hash)
}

export function getV2APITestTTSApiKey(provider?: string) {
  if (provider === 'groq') return V2API_TEST_GROQ_API_KEY
  if (provider === 'elevenlabs') return V2API_TEST_ELEVENLABS_API_KEY
  return V2API_TEST_API_KEY
}

export const V2API_PROVIDER_IDS = [
  ModelProviderEnum.V2APIOpenAI,
  ModelProviderEnum.V2APIClaude,
  ModelProviderEnum.V2APIGemini,
] as const

export type V2APIProviderId = (typeof V2API_PROVIDER_IDS)[number]

export function isV2APIProvider(providerId?: string): providerId is V2APIProviderId {
  return V2API_PROVIDER_IDS.includes(providerId as V2APIProviderId)
}

export function getV2APIProviderForProtocol(protocol: 'openai' | 'claude' | 'gemini'): V2APIProviderId {
  if (protocol === 'claude') return ModelProviderEnum.V2APIClaude
  if (protocol === 'gemini') return ModelProviderEnum.V2APIGemini
  return ModelProviderEnum.V2APIOpenAI
}

export function guessV2APIModelCapabilities(modelId: string) {
  const id = modelId.toLowerCase()
  const capabilities: Array<'vision' | 'reasoning' | 'tool_use' | 'web_search'> = ['tool_use']

  if (
    /vision|vl|image|gpt-4o|gpt-4\.1|claude-3|claude-opus|claude-sonnet|claude-haiku|gemini/.test(id) &&
    !/embedding|tts|audio|whisper|speech|rerank/.test(id)
  ) {
    capabilities.push('vision')
  }

  if (/o\d|reason|thinking|r1|claude|gemini-2\.5|gemini-3/.test(id)) {
    capabilities.push('reasoning')
  }

  return [...new Set(capabilities)]
}
