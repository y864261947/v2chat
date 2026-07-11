import { fetchRemoteModels } from '@shared/models/openai-compatible'
import { ModelProviderEnum, type ProviderModelInfo, type Settings } from '@shared/types'
import {
  getV2APITestTTSApiKey,
  guessV2APIModelCapabilities,
  V2API_BASE_URL,
  V2API_DEFAULT_ELEVENLABS_BASE_URL,
  V2API_DEFAULT_ELEVENLABS_MODEL,
  V2API_DEFAULT_ELEVENLABS_VOICE,
  V2API_DEFAULT_GROQ_TTS_BASE_URL,
  V2API_DEFAULT_GROQ_TTS_MODEL,
  V2API_DEFAULT_GROQ_TTS_VOICE,
  V2API_DEFAULT_IMAGE_BASE_URL,
  V2API_DEFAULT_IMAGE_MODEL,
  V2API_DEFAULT_TRANSCRIPTION_BASE_URL,
  V2API_DEFAULT_TRANSCRIPTION_MODEL,
  V2API_DEFAULT_TTS_BASE_URL,
  V2API_DEFAULT_TTS_MODEL,
  V2API_DEFAULT_TTS_PROVIDER,
  V2API_DEFAULT_TTS_VOICE,
  V2API_LEGACY_TEST_API_KEYS,
  V2API_PROVIDER_IDS,
  V2API_TEST_API_KEY,
  V2API_TEST_GROQ_API_KEY,
  V2API_TEST_IMAGE_API_KEY,
} from '@shared/v2api'
import { uniqBy } from 'lodash'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

type TTSProvider = 'openai-compatible' | 'elevenlabs' | 'groq'

function getTTSProviderDefaults(provider: TTSProvider) {
  if (provider === 'elevenlabs') {
    return {
      baseUrl: V2API_DEFAULT_ELEVENLABS_BASE_URL,
      model: V2API_DEFAULT_ELEVENLABS_MODEL,
      voice: V2API_DEFAULT_ELEVENLABS_VOICE,
    }
  }
  if (provider === 'groq') {
    return {
      baseUrl: V2API_DEFAULT_GROQ_TTS_BASE_URL,
      model: V2API_DEFAULT_GROQ_TTS_MODEL,
      voice: V2API_DEFAULT_GROQ_TTS_VOICE,
    }
  }
  return {
    baseUrl: V2API_DEFAULT_TTS_BASE_URL,
    model: V2API_DEFAULT_TTS_MODEL,
    voice: V2API_DEFAULT_TTS_VOICE,
  }
}

function getSharedApiKey(settings: Settings): string {
  for (const providerId of V2API_PROVIDER_IDS) {
    const key = settings.providers?.[providerId]?.apiKey
    if (key && !V2API_LEGACY_TEST_API_KEYS.includes(key)) return key
  }
  return V2API_TEST_API_KEY
}

function updateAllV2APIKeys(settings: Settings, apiKey: string) {
  settings.providers = {
    ...(settings.providers || {}),
  }
  for (const providerId of V2API_PROVIDER_IDS) {
    settings.providers[providerId] = {
      ...(settings.providers[providerId] || {}),
      apiHost: V2API_BASE_URL,
      apiKey,
    }
  }
}

function keepV2APISettings(
  settings: Settings,
  patch: Partial<NonNullable<Settings['v2api']>>
): NonNullable<Settings['v2api']> {
  const provider = (patch.ttsProvider || settings.v2api?.ttsProvider || V2API_DEFAULT_TTS_PROVIDER) as TTSProvider
  const defaults = getTTSProviderDefaults(provider)
  return {
    mode: settings.v2api?.mode || 'account',
    defaultVisionModel: settings.v2api?.defaultVisionModel,
    ttsProvider: provider,
    ttsBaseUrl: settings.v2api?.ttsBaseUrl || defaults.baseUrl,
    ttsApiKey: settings.v2api?.ttsApiKey || getV2APITestTTSApiKey(provider),
    ttsModel: settings.v2api?.ttsModel || defaults.model,
    ttsVoice: settings.v2api?.ttsVoice || defaults.voice,
    transcriptionBaseUrl: settings.v2api?.transcriptionBaseUrl || V2API_DEFAULT_TRANSCRIPTION_BASE_URL,
    transcriptionApiKey: settings.v2api?.transcriptionApiKey || V2API_TEST_GROQ_API_KEY,
    transcriptionModel: settings.v2api?.transcriptionModel || V2API_DEFAULT_TRANSCRIPTION_MODEL,
    imageBaseUrl: settings.v2api?.imageBaseUrl || V2API_DEFAULT_IMAGE_BASE_URL,
    imageApiKey: settings.v2api?.imageApiKey || V2API_TEST_IMAGE_API_KEY,
    imageModel: settings.v2api?.imageModel || V2API_DEFAULT_IMAGE_MODEL,
    ...patch,
    protocol: 'openai',
  }
}

function isVisibleChatModel(model: ProviderModelInfo) {
  return !/embedding|rerank|tts|audio|whisper|speech|transcrib|image|video/i.test(model.modelId)
}

async function fetchV2APIModels(apiKey: string): Promise<ProviderModelInfo[]> {
  const dependencies = await createModelDependencies()
  const fetched = await fetchRemoteModels(
    {
      apiHost: V2API_BASE_URL,
      apiKey,
      useProxy: false,
    },
    dependencies
  )

  return uniqBy(
    fetched
      .filter(isVisibleChatModel)
      .map((model) => ({
        ...model,
        capabilities: model.capabilities?.length ? model.capabilities : guessV2APIModelCapabilities(model.modelId),
      })),
    'modelId'
  )
}

export function useV2APIModelRefresh() {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [fetching, setFetching] = useState(false)
  const apiKey = useMemo(() => getSharedApiKey(settings), [settings])

  const refreshModels = useCallback(async () => {
    if (!apiKey.trim()) {
      addToast(t('Please enter API Key first'))
      return
    }

    setFetching(true)
    try {
      const nextModels = await fetchV2APIModels(apiKey)
      if (!nextModels.length) {
        addToast(t('Failed to fetch models'))
        return
      }

      setSettings((draft) => {
        updateAllV2APIKeys(draft, apiKey)
        for (const providerId of V2API_PROVIDER_IDS) {
          draft.providers![providerId] = {
            ...(draft.providers?.[providerId] || {}),
            apiHost: V2API_BASE_URL,
            apiKey,
            models: nextModels,
          }
        }

        const nextDefaultModel =
          nextModels.find((model) => model.modelId === draft.defaultChatModel?.model)?.modelId || nextModels[0].modelId
        const nextVisionModel =
          nextModels.find((model) => model.capabilities?.includes('vision'))?.modelId || nextDefaultModel

        draft.defaultChatModel = {
          provider: ModelProviderEnum.V2APIOpenAI,
          model: nextDefaultModel,
        }
        draft.ocrModel = {
          provider: ModelProviderEnum.V2APIOpenAI,
          model: nextVisionModel,
        }
        draft.v2api = keepV2APISettings(draft, {
          defaultVisionModel: nextVisionModel,
        })
      })
      addToast(t('Models fetched successfully'))
    } catch (error) {
      console.error('Failed to fetch V2API models', error)
      addToast(`${t('Failed to fetch models')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setFetching(false)
    }
  }, [apiKey, setSettings, t])

  return {
    apiKey,
    fetching,
    refreshModels,
  }
}
