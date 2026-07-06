import { Badge, Button, Flex, PasswordInput, SegmentedControl, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { fetchRemoteModels } from '@shared/models/openai-compatible'
import { ModelProviderEnum, type ProviderModelInfo, type Settings } from '@shared/types'
import {
  getV2APIProviderForProtocol,
  guessV2APIModelCapabilities,
  isV2APIProvider,
  V2API_BASE_URL,
  V2API_DEFAULT_CHAT_MODEL,
  V2API_DEFAULT_TTS_MODEL,
  V2API_DEFAULT_TTS_VOICE,
  V2API_PROVIDER_IDS,
} from '@shared/v2api'
import { IconRefresh } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { uniqBy } from 'lodash'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

export const Route = createFileRoute('/settings/v2api')({
  component: RouteComponent,
})

type Protocol = 'openai' | 'claude' | 'gemini'

const protocolOptions = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Claude', value: 'claude' },
  { label: 'Gemini', value: 'gemini' },
]

function getSharedApiKey(settings: Settings): string {
  for (const providerId of V2API_PROVIDER_IDS) {
    const key = settings.providers?.[providerId]?.apiKey
    if (key) return key
  }
  return ''
}

function getProviderModels(settings: Settings, providerId: string): ProviderModelInfo[] {
  const models = settings.providers?.[providerId]?.models
  if (models?.length) return models
  if (providerId === ModelProviderEnum.V2APIClaude) {
    return [{ modelId: 'claude-sonnet-4-5', capabilities: ['vision', 'tool_use', 'reasoning'], type: 'chat' }]
  }
  if (providerId === ModelProviderEnum.V2APIGemini) {
    return [{ modelId: 'gemini-2.5-flash', capabilities: ['vision', 'tool_use', 'reasoning'], type: 'chat' }]
  }
  return [{ modelId: V2API_DEFAULT_CHAT_MODEL, capabilities: ['vision', 'tool_use'], type: 'chat' }]
}

function modelToSelectData(models: ProviderModelInfo[]) {
  return models.map((model) => ({
    value: model.modelId,
    label: model.nickname ? `${model.nickname} (${model.modelId})` : model.modelId,
  }))
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

export function RouteComponent() {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [fetching, setFetching] = useState(false)

  const protocol = (settings.v2api?.protocol || 'openai') as Protocol
  const providerId = getV2APIProviderForProtocol(protocol)
  const apiKey = getSharedApiKey(settings)
  const models = getProviderModels(settings, providerId)
  const chatModel =
    settings.defaultChatModel?.provider === providerId ? settings.defaultChatModel.model : models[0]?.modelId || ''
  const visionModel =
    settings.v2api?.defaultVisionModel ||
    (settings.ocrModel?.provider === providerId ? settings.ocrModel.model : undefined) ||
    models.find((model) => model.capabilities?.includes('vision'))?.modelId ||
    chatModel

  const modelSelectData = useMemo(() => modelToSelectData(models), [models])
  const visionModelSelectData = useMemo(
    () => modelToSelectData(models.filter((model) => model.capabilities?.includes('vision'))),
    [models]
  )

  const handleProtocolChange = (value: string) => {
    const nextProtocol = value as Protocol
    const nextProviderId = getV2APIProviderForProtocol(nextProtocol)
    const nextModels = getProviderModels(settings, nextProviderId)
    const nextModel = nextModels[0]?.modelId || V2API_DEFAULT_CHAT_MODEL

    setSettings((draft) => {
      draft.v2api = {
        protocol: nextProtocol,
        defaultVisionModel: draft.v2api?.defaultVisionModel,
        ttsModel: draft.v2api?.ttsModel || V2API_DEFAULT_TTS_MODEL,
        ttsVoice: draft.v2api?.ttsVoice || V2API_DEFAULT_TTS_VOICE,
      }
      updateAllV2APIKeys(draft, apiKey)
      draft.defaultChatModel = {
        provider: nextProviderId,
        model: nextModel,
      }
      draft.ocrModel = {
        provider: nextProviderId,
        model: nextModels.find((model) => model.capabilities?.includes('vision'))?.modelId || nextModel,
      }
    })
  }

  const handleApiKeyChange = (value: string) => {
    setSettings((draft) => updateAllV2APIKeys(draft, value))
  }

  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      addToast(t('Please enter API Key first'))
      return
    }

    setFetching(true)
    try {
      const dependencies = await createModelDependencies()
      const fetched = await fetchRemoteModels(
        {
          apiHost: V2API_BASE_URL,
          apiKey,
          useProxy: false,
        },
        dependencies
      )
      const nextModels = uniqBy(
        fetched
          .filter((model) => !/embedding|rerank|tts|audio|whisper|speech/i.test(model.modelId))
          .map((model) => ({
            ...model,
            capabilities: model.capabilities?.length
              ? model.capabilities
              : guessV2APIModelCapabilities(model.modelId),
          })),
        'modelId'
      )
      if (!nextModels.length) {
        addToast(t('Failed to fetch models'))
        return
      }

      setSettings((draft) => {
        draft.providers = {
          ...(draft.providers || {}),
          [providerId]: {
            ...(draft.providers?.[providerId] || {}),
            apiHost: V2API_BASE_URL,
            apiKey,
            models: nextModels,
          },
        }
        const previousDefaultModel = draft.defaultChatModel
        if (!previousDefaultModel || !isV2APIProvider(previousDefaultModel.provider)) {
          draft.defaultChatModel = {
            provider: providerId,
            model: nextModels[0].modelId,
          }
        }
        if (!draft.ocrModel || !isV2APIProvider(draft.ocrModel.provider)) {
          draft.ocrModel = {
            provider: providerId,
            model: nextModels.find((model) => model.capabilities?.includes('vision'))?.modelId || nextModels[0].modelId,
          }
        }
      })
      addToast(t('Models fetched successfully'))
    } catch (error) {
      console.error('Failed to fetch V2API models', error)
      addToast(`${t('Failed to fetch models')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setFetching(false)
    }
  }

  return (
    <Stack p="md" gap="xl">
      <Flex align="center" gap="xs">
        <Title order={5}>V2API</Title>
        <Badge variant="light">V2Chat</Badge>
      </Flex>

      <Stack gap="xxs">
        <Text fw={600}>{t('API Key')}</Text>
        <PasswordInput value={apiKey} onChange={(event) => handleApiKeyChange(event.currentTarget.value)} />
        <Text size="xs" c="chatbox-tertiary">
          Base URL: {V2API_BASE_URL}
        </Text>
      </Stack>

      <Stack gap="xxs">
        <Text fw={600}>{t('Protocol')}</Text>
        <SegmentedControl value={protocol} onChange={handleProtocolChange} data={protocolOptions} />
      </Stack>

      <Stack gap="xs">
        <Flex justify="space-between" align="center">
          <Text fw={600}>{t('Model')}</Text>
          <Button
            loading={fetching}
            variant="light"
            size="compact-sm"
            leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
            onClick={handleFetchModels}
          >
            {t('Fetch')}
          </Button>
        </Flex>
        <Select
          searchable
          data={modelSelectData}
          value={chatModel}
          onChange={(model) => {
            if (!model) return
            setSettings({
              defaultChatModel: {
                provider: providerId,
                model,
              },
            })
          }}
        />
        <TextInput
          label={t('Manual Model ID')}
          value={chatModel}
          onChange={(event) =>
            setSettings({
              defaultChatModel: {
                provider: providerId,
                model: event.currentTarget.value.trim(),
              },
            })
          }
        />
      </Stack>

      <Stack gap="xxs">
        <Text fw={600}>{t('Default Vision Model')}</Text>
        <Select
          searchable
          data={visionModelSelectData.length ? visionModelSelectData : modelSelectData}
          value={visionModel}
          onChange={(model) => {
            if (!model) return
            setSettings((draft) => {
              draft.v2api = {
                protocol,
                defaultVisionModel: model,
                ttsModel: draft.v2api?.ttsModel || V2API_DEFAULT_TTS_MODEL,
                ttsVoice: draft.v2api?.ttsVoice || V2API_DEFAULT_TTS_VOICE,
              }
              draft.ocrModel = {
                provider: providerId,
                model,
              }
            })
          }}
        />
      </Stack>

      <Stack gap="xxs">
        <Text fw={600}>{t('TTS')}</Text>
        <Flex gap="sm" wrap="wrap">
          <TextInput
            label={t('Model')}
            value={settings.v2api?.ttsModel || V2API_DEFAULT_TTS_MODEL}
            onChange={(event) =>
              setSettings((draft) => {
                draft.v2api = {
                  protocol,
                  defaultVisionModel: draft.v2api?.defaultVisionModel,
                  ttsModel: event.currentTarget.value.trim() || V2API_DEFAULT_TTS_MODEL,
                  ttsVoice: draft.v2api?.ttsVoice || V2API_DEFAULT_TTS_VOICE,
                }
              })
            }
          />
          <TextInput
            label={t('Voice')}
            value={settings.v2api?.ttsVoice || V2API_DEFAULT_TTS_VOICE}
            onChange={(event) =>
              setSettings((draft) => {
                draft.v2api = {
                  protocol,
                  defaultVisionModel: draft.v2api?.defaultVisionModel,
                  ttsModel: draft.v2api?.ttsModel || V2API_DEFAULT_TTS_MODEL,
                  ttsVoice: event.currentTarget.value.trim() || V2API_DEFAULT_TTS_VOICE,
                }
              })
            }
          />
        </Flex>
      </Stack>
    </Stack>
  )
}
