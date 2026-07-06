import { ModelProviderEnum } from './types/provider'

export const V2API_BASE_URL = 'https://v2api.top/v1'
export const V2API_DEFAULT_CHAT_MODEL = 'gpt-4o-mini'
export const V2API_DEFAULT_TTS_MODEL = 'tts-1'
export const V2API_DEFAULT_TTS_VOICE = 'alloy'

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
