import { Badge, Button, Flex, PasswordInput, SegmentedControl, Select, Stack, Text, Title } from '@mantine/core'
import { fetchRemoteModels } from '@shared/models/openai-compatible'
import { ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
import {
  V2API_BASE_URL,
  V2API_DEFAULT_CHAT_MODEL,
  guessV2APIModelCapabilities,
} from '@shared/v2api'
import { IconRefresh, IconUserCircle } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { uniqBy } from 'lodash'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import {
  getV2ChatBYOKKey,
  getV2ChatAPIBaseURL,
  hydrateV2ChatCredentials,
  initializeV2ChatAccount,
  setV2ChatBYOKKey,
  updateV2ChatModels,
  useV2ChatAccount,
  v2chatAuthenticatedFetch,
} from '@/stores/v2chatAccountStore'

export const Route = createFileRoute('/settings/v2api')({ component: RouteComponent })

function visibleChatModel(model: ProviderModelInfo) {
  return !/embedding|rerank|tts|audio|whisper|speech|transcrib|image|video/i.test(model.modelId)
}

function selectData(models: ProviderModelInfo[]) {
  return uniqBy(models, 'modelId').map((model) => ({
    value: model.modelId,
    label: model.nickname ? `${model.nickname} (${model.modelId})` : model.modelId,
  }))
}

export function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const mode = useSettingsStore((state) => state.v2api?.mode || 'account')
  const models = useSettingsStore((state) => state.providers?.[ModelProviderEnum.V2APIOpenAI]?.models || [])
  const currentModel = useSettingsStore((state) => state.defaultChatModel?.model || V2API_DEFAULT_CHAT_MODEL)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const accountStatus = useV2ChatAccount((state) => state.status)
  const user = useV2ChatAccount((state) => state.user)
  const wallet = useV2ChatAccount((state) => state.wallet)
  const [byokKey, setByokKey] = useState('')
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    void getV2ChatBYOKKey().then(setByokKey)
  }, [])

  const chatModels = useMemo(() => models.filter(visibleChatModel), [models])

  const changeMode = async (nextMode: string) => {
    if (nextMode !== 'account' && nextMode !== 'byok') return
    setSettings((draft) => {
      draft.v2api = { ...draft.v2api, mode: nextMode }
    })
    await hydrateV2ChatCredentials()
    if (nextMode === 'account') await initializeV2ChatAccount()
  }

  const changeBYOKKey = (value: string) => {
    setByokKey(value)
    void setV2ChatBYOKKey(value)
  }

  const fetchModels = async () => {
    if (mode === 'byok' && !byokKey.trim()) {
      addToast(t('Please enter API Key first'))
      return
    }
    setFetching(true)
    try {
      if (mode === 'account') await initializeV2ChatAccount()
      const dependencies = await createModelDependencies()
      const fetched = await fetchRemoteModels(
        {
          apiHost: mode === 'account' ? getV2ChatAPIBaseURL() : V2API_BASE_URL,
          apiKey: mode === 'account' ? 'v2chat-account' : byokKey.trim(),
          useProxy: false,
          customFetch: mode === 'account' ? v2chatAuthenticatedFetch : undefined,
        },
        dependencies
      )
      const nextModels = uniqBy(
        fetched.filter(visibleChatModel).map((model) => ({
          ...model,
          capabilities: model.capabilities?.length
            ? model.capabilities
            : guessV2APIModelCapabilities(model.modelId),
        })),
        'modelId'
      )
      if (!nextModels.length) throw new Error(String(t('No eligible models available')))
      updateV2ChatModels(nextModels)
      addToast(t('Models fetched successfully'))
    } catch (error) {
      addToast(`${t('Failed to fetch models')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setFetching(false)
    }
  }

  return (
    <Stack p="md" gap="xl" maw={720}>
      <Flex align="center" gap="xs">
        <Title order={5}>V2API</Title>
        <Badge variant="light">V2Chat</Badge>
      </Flex>

      <Stack gap="xs">
        <Text fw={600}>连接方式</Text>
        <SegmentedControl
          value={mode}
          onChange={(value) => void changeMode(value)}
          data={[
            { value: 'account', label: '账号积分' },
            { value: 'byok', label: '自带 Key' },
          ]}
        />
      </Stack>

      {mode === 'account' ? (
        <Flex
          align="center"
          justify="space-between"
          gap="md"
          wrap="wrap"
          p="md"
          className="rounded-md border border-solid border-chatbox-border-primary bg-chatbox-background-secondary"
        >
          <Stack gap={2}>
            <Text fw={600}>{user?.kind === 'member' ? user.email : '游客试用'}</Text>
            <Text size="sm" c="chatbox-secondary">
              {accountStatus === 'error' ? '账号服务暂时不可用' : `可用积分 ${wallet?.balance ?? 0}`}
            </Text>
          </Stack>
          <Button
            variant="light"
            leftSection={<ScalableIcon icon={IconUserCircle} size={16} />}
            onClick={() => navigate({ to: '/settings/account' as never })}
          >
            账号与积分
          </Button>
        </Flex>
      ) : (
        <Stack gap="xxs">
          <Text fw={600}>{t('API Key')}</Text>
          <PasswordInput value={byokKey} onChange={(event) => changeBYOKKey(event.currentTarget.value)} />
          <Text size="xs" c="chatbox-tertiary">
            Key 仅保存在本机安全存储，BYOK 对话不扣 V2Chat 积分。
          </Text>
        </Stack>
      )}

      <Stack gap="xs">
        <Flex justify="space-between" align="center" gap="md">
          <Stack gap={0}>
            <Text fw={600}>{t('Model')}</Text>
            <Text size="xs" c="chatbox-tertiary">
              统一展示当前账号分组可用模型
            </Text>
          </Stack>
          <Button
            loading={fetching}
            variant="light"
            size="compact-sm"
            leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
            onClick={() => void fetchModels()}
          >
            获取模型
          </Button>
        </Flex>

        <Select
          searchable
          data={selectData(chatModels)}
          value={currentModel}
          nothingFoundMessage={t('No eligible models available')}
          onChange={(model) => {
            if (!model) return
            setSettings((draft) => {
              draft.defaultChatModel = { provider: ModelProviderEnum.V2APIOpenAI, model }
              const vision = chatModels.find((item) => item.modelId === model && item.capabilities?.includes('vision'))
                ? model
                : chatModels.find((item) => item.capabilities?.includes('vision'))?.modelId || model
              draft.ocrModel = { provider: ModelProviderEnum.V2APIOpenAI, model: vision }
              draft.v2api = { ...draft.v2api, defaultVisionModel: vision }
            })
          }}
        />
      </Stack>

      <Text size="xs" c="chatbox-tertiary">
        {mode === 'account' ? `服务地址：${getV2ChatAPIBaseURL()}` : `V2API 地址：${V2API_BASE_URL}`}
      </Text>
    </Stack>
  )
}
