import NiceModal, { useModal } from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  FileButton,
  Flex,
  Input,
  Select,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { chatSessionSettings, pictureSessionSettings } from '@shared/defaults'
import {
  createMessage,
  isChatSession,
  isPictureSession,
  ModelProviderEnum,
  type ImageSource,
  type MessageContentParts,
  type Session,
  type SessionBackgroundAppearance,
  type SessionSettings,
} from '@shared/types'
import {
  type GoogleThinkingLevel,
  getDefaultGoogleThinkingLevel,
  getGoogleThinkingMode,
  getSupportedGoogleThinkingLevels,
} from '@shared/utils/google-thinking'
import {
  IconAdjustments,
  IconInfoCircle,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconUser,
  IconVolume,
} from '@tabler/icons-react'
import { pick } from 'lodash'
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AssistantAvatar } from '@/components/common/Avatar'
import LazyNumberInput from '@/components/common/LazyNumberInput'
import MaxContextMessageCountSlider from '@/components/common/MaxContextMessageCountSlider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SegmentedControl from '@/components/common/SegmentedControl'
import SliderWithInput from '@/components/common/SliderWithInput'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import ImageStyleSelect from '@/components/ImageStyleSelect'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { createModel } from '@/adapters'
import { trackingEvent } from '@/packages/event'
import { generateText } from '@/packages/model-calls'
import { buildCharacterSystemPrompt, getTavernCharacterById, TAVERN_VOICE_OPTIONS } from '@/packages/tavernCharacters'
import { generateSpeech } from '@/packages/v2api-tts'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { updateSession } from '@/stores/chatStore'
import { getSessionMeta, mergeSettings } from '@/stores/sessionHelpers'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'
import { getMessageText } from '../../shared/utils/message'

const DEFAULT_BACKGROUND_APPEARANCE: SessionBackgroundAppearance = { opacity: 0.78, dim: 0.2, blur: 2 }

const SessionSettingsModal = NiceModal.create(
  ({ session, disableAutoSave = false }: { session: Session; disableAutoSave?: boolean }) => {
    const modal = useModal()
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()

    const [editingData, setEditingData] = useState<Session | null>(session || null)
    useEffect(() => {
      if (!session) {
        setEditingData(null)
      } else {
        setEditingData({
          ...session,
          settings: session.settings ? { ...session.settings } : undefined,
        })
      }
    }, [session])

    const [systemPrompt, setSystemPrompt] = useState('')
    const [voicePreviewUrl, setVoicePreviewUrl] = useState('')
    const [voicePreviewError, setVoicePreviewError] = useState('')
    const [isGeneratingVoicePreview, setIsGeneratingVoicePreview] = useState(false)
    const [isSummarizingMemory, setIsSummarizingMemory] = useState(false)
    const [memorySummaryError, setMemorySummaryError] = useState('')
    const linkedCharacter = useMemo(
      () => getTavernCharacterById(editingData?.characterId),
      [editingData?.characterId]
    )
    useEffect(() => {
      if (!session) {
        setSystemPrompt('')
        setVoicePreviewUrl('')
        setVoicePreviewError('')
        setMemorySummaryError('')
      } else {
        const systemMessage = session.messages.find((m) => m.role === 'system')
        setSystemPrompt(systemMessage ? getMessageText(systemMessage) : '')
        setVoicePreviewUrl('')
        setVoicePreviewError('')
        setMemorySummaryError('')
      }
    }, [session])

    const onReset = (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      setEditingData((_editingData) =>
        _editingData
          ? {
              ..._editingData,
              settings: pick(_editingData.settings, ['provider', 'modelId']),
            }
          : _editingData
      )
    }

    useEffect(() => {
      if (session) {
        trackingEvent('chat_config_window', { event_category: 'screen_view' })
      }
    }, [session])

    const onCancel = () => {
      if (session) {
        setEditingData({
          ...session,
        })
      }
      modal.resolve()
      modal.hide()
    }

    const applySessionChanges = (target: Session) => {
      target.name = (target.name ?? '').trim() || session.name
      const trimmed = systemPrompt.trim()
      const messages = Array.isArray(target.messages) ? [...target.messages] : []
      if (trimmed === '') {
        target.messages = messages.filter((m) => m.role !== 'system')
      } else {
        const idx = messages.findIndex((m) => m.role === 'system')
        if (idx >= 0) {
          const sys = { ...messages[idx], contentParts: [{ type: 'text' as const, text: trimmed }] }
          target.messages = [...messages.slice(0, idx), sys, ...messages.slice(idx + 1)]
        } else {
          target.messages = [createMessage('system', trimmed), ...messages]
        }
      }
      return target
    }
    const onSave = () => {
      if (!session || !editingData) {
        return
      }

      const savedData = withTavernMemoryUpdatedAt(editingData, session)

      if (!disableAutoSave) {
        void updateSession(savedData.id, (s) => {
          const merged = {
            ...(s ?? {}),
            ...getSessionMeta(savedData),
            settings: savedData.settings,
          } as Session

          return applySessionChanges(merged)
        })
      } else {
        applySessionChanges(savedData)
      }

      // setChatConfigDialogSessionId(null)
      modal.resolve(savedData)
      modal.hide()
    }

    const onPreviewVoice = async () => {
      if (!session || !editingData) return
      setVoicePreviewError('')
      setIsGeneratingVoicePreview(true)
      try {
        const selectedVoice = editingData.characterVoiceId || undefined
        const text = `${editingData.name || '我'}在这里。今晚的故事，就从这一句话开始。`
        const audio = await generateSpeech({
          input: text,
          sessionId: editingData.id,
          messageId: `voice-preview-${Date.now()}`,
          voice: selectedVoice,
        })
        const dataUrl = await storage.getBlob(audio.storageKey)
        if (!dataUrl) {
          throw new Error('试听音频保存失败')
        }
        setVoicePreviewUrl(dataUrl)
      } catch (error) {
        setVoicePreviewError(error instanceof Error ? error.message : '试听生成失败')
      } finally {
        setIsGeneratingVoicePreview(false)
      }
    }

    const onSummarizeTavernMemory = async () => {
      if (!session || !editingData) return
      const recentMessages = buildRecentRoleplayTranscript(session)
      if (!recentMessages) {
        const message = '最近聊天内容太少，先多聊几句再整理剧情记忆'
        setMemorySummaryError(message)
        addToast(message)
        return
      }

      setMemorySummaryError('')
      setIsSummarizingMemory(true)
      try {
        const mergedSettings = mergeSettings(settingsStore.getState().getSettings(), editingData.settings, editingData.type)
        const model = await createModel(mergedSettings)
        const result = await generateText(model, [
          createMessage(
            'system',
            [
              'You summarize tavern roleplay continuity for V2Chat.',
              'Return only compact JSON with these string fields: relationship, currentScene, memory.',
              'relationship: user-character relationship, forms of address, boundaries, agreements, emotional state.',
              'currentScene: current place, time, atmosphere, and immediate situation.',
              'memory: important events, clues, promises, user preferences, unresolved plot hooks.',
              'Write in Simplified Chinese. Keep each field concise and useful for future roleplay.',
              'Do not invent facts that are not supported by the conversation.',
            ].join('\n')
          ),
          createMessage(
            'user',
            [
              `角色名称：${editingData.name || session.name}`,
              editingData.characterDescription ? `角色描述：${editingData.characterDescription}` : '',
              editingData.characterRelationship ? `已有关系笔记：${editingData.characterRelationship}` : '',
              editingData.currentScene ? `已有当前场景：${editingData.currentScene}` : '',
              editingData.characterMemory ? `已有长期记忆：${editingData.characterMemory}` : '',
              `最近聊天：\n${recentMessages}`,
              '请输出 JSON，不要输出解释。',
            ]
              .filter(Boolean)
              .join('\n\n')
          ),
        ])
        const summary = parseTavernMemorySummary(getTextFromMessageParts(result.contentParts))
        setEditingData({
          ...editingData,
          characterRelationship: summary.relationship || editingData.characterRelationship,
          currentScene: summary.currentScene || editingData.currentScene,
          characterMemory: summary.memory || editingData.characterMemory,
          characterMemoryUpdatedAt: Date.now(),
        })
        addToast('已整理剧情记忆，保存后生效')
      } catch (error) {
        const message = error instanceof Error ? error.message : '剧情记忆整理失败'
        setMemorySummaryError(message)
        addToast(message)
      } finally {
        setIsSummarizingMemory(false)
      }
    }

    const onSyncFromCharacterLibrary = () => {
      if (!editingData || !linkedCharacter) return
      const avatarPatch =
        linkedCharacter.avatar?.type === 'storage-key'
          ? { assistantAvatarKey: linkedCharacter.avatar.storageKey, picUrl: undefined }
          : linkedCharacter.avatar?.type === 'url'
            ? { assistantAvatarKey: undefined, picUrl: linkedCharacter.avatar.url }
            : { assistantAvatarKey: undefined, picUrl: undefined }

      setEditingData({
        ...editingData,
        ...avatarPatch,
        conversationMode: 'roleplay',
        name: linkedCharacter.name,
        characterId: linkedCharacter.id,
        characterDescription: linkedCharacter.description,
        characterTags: linkedCharacter.tags,
        characterVoiceId: linkedCharacter.voiceId,
        backgroundImage: linkedCharacter.backgroundImage,
        standingImage: linkedCharacter.standingImage,
      })
      setSystemPrompt(
        buildCharacterSystemPrompt(linkedCharacter, {
          relationship: editingData.characterRelationship,
          memory: editingData.characterMemory,
          currentScene: editingData.currentScene,
        })
      )
      setVoicePreviewUrl('')
      setVoicePreviewError('')
      addToast('已同步角色库内容，保存后生效')
    }

    if (!session || !editingData) {
      return null
    }

    const characterSummary =
      getSessionSettingsSummary(editingData.characterDescription, editingData.name) ||
      '整理角色资料、聊天背景、立绘和专属音色。'

    return (
      <AdaptiveModal
        opened={modal.visible}
        onClose={() => {
          modal.resolve()
          modal.hide()
        }}
        // fullScreen={isSmallScreen}
        centered
        size="lg"
        title="当前窗口：角色与场景"
        onFocus={(e) => e.stopPropagation()}
        trapFocus={false}
        // fullWidth
      >
        <div className="v2chat-session-settings">
          <Flex className="v2chat-session-settings__hero" align="center" gap="md">
            <FileButton
              accept="image/png,image/jpeg"
              onChange={(file) => {
                if (file) {
                  const key = StorageKeyGenerator.picture(`assistant-avatar:${session?.id}`)
                  handleImageInputAndSave(
                    file,
                    key,
                    () => setEditingData((prev) => ({ ...prev, assistantAvatarKey: key }) as typeof prev),
                    (k, v) => storage.setBlob(k, v)
                  )
                }
              }}
            >
              {(props) => (
                <Flex className="v2chat-session-settings__avatar">
                  <AssistantAvatar
                    size={isSmallScreen ? 64 : 76}
                    avatarKey={editingData.assistantAvatarKey}
                    picUrl={editingData.picUrl}
                    sessionType={editingData.type}
                    {...props}
                  />

                  {editingData.assistantAvatarKey && (
                    <ActionIcon
                      color="chatbox-error"
                      size={24}
                      radius="xl"
                      bottom={0}
                      right={0}
                      className="absolute"
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditingData({ ...editingData, assistantAvatarKey: undefined })
                      }}
                      aria-label="移除头像"
                    >
                      <ScalableIcon icon={IconTrash} size={18} />
                    </ActionIcon>
                  )}
                </Flex>
              )}
            </FileButton>

            <Stack gap={8} className="min-w-0 flex-1">
              <Flex gap={8} align="center" wrap="wrap">
                <Text fw={800} size="lg" lineClamp={1}>
                  {editingData.name || '未命名角色'}
                </Text>
                {editingData.characterTags?.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="light" color="chatbox-brand" radius="sm">
                    {tag}
                  </Badge>
                ))}
              </Flex>
              <Text size="sm" opacity={0.68} lineClamp={1}>
                {characterSummary}
              </Text>
            </Stack>
          </Flex>

          {editingData.characterId && (
            <Box className="v2chat-session-settings__sync-card">
              <Flex align="center" justify="space-between" gap="sm" wrap="wrap">
                <Stack gap={2} className="min-w-0">
                  <Text fw={800} size="sm">
                    角色库同步
                  </Text>
                  <Text size="xs" opacity={0.7}>
                    {linkedCharacter
                      ? `已绑定角色库：${linkedCharacter.name}。可同步名称、设定、标签、头像、背景、立绘和音色。`
                      : '角色库中找不到这张角色卡，当前聊天会保留已有设定。'}
                  </Text>
                </Stack>
                <Button
                  size="compact-sm"
                  variant="light"
                  color="chatbox-brand"
                  disabled={!linkedCharacter}
                  leftSection={<IconRefresh size={14} />}
                  onClick={onSyncFromCharacterLibrary}
                >
                  从角色库同步
                </Button>
              </Flex>
            </Box>
          )}

          <Tabs defaultValue="profile" className="v2chat-session-settings__tabs">
            <Tabs.List grow>
              <Tabs.Tab value="profile" leftSection={<IconUser size={15} />}>
                角色资料
              </Tabs.Tab>
              <Tabs.Tab value="scene" leftSection={<IconPhoto size={15} />}>
                场景外观
              </Tabs.Tab>
              <Tabs.Tab value="voice" leftSection={<IconVolume size={15} />}>
                语音
              </Tabs.Tab>
              <Tabs.Tab value="advanced" leftSection={<IconAdjustments size={15} />}>
                高级
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="profile" pt="md">
              <Stack gap="md">
                <Stack gap="xs">
                  <Text fw={700}>角色名称</Text>
                  <Input
                    placeholder="输入角色名称"
                    autoFocus={!isSmallScreen}
                    value={editingData.name}
                    onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
                    classNames={{
                      input: '!text-chatbox-tint-primary',
                    }}
                  />
                </Stack>

                <Textarea
                  label="角色描述"
                  description="用于角色库卡片、右侧立绘说明，也会辅助生成图片与语音风格。"
                  placeholder="写下角色身份、性格、关系、外貌或当前设定。"
                  autosize
                  minRows={4}
                  maxRows={10}
                  value={editingData.characterDescription || ''}
                  onChange={(event) => setEditingData({ ...editingData, characterDescription: event.target.value })}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                />

                <Box className="v2chat-session-settings__memory-card">
                  <Flex align="center" justify="space-between" gap="sm" wrap="wrap">
                    <Stack gap={2} className="min-w-0">
                      <Text fw={800} size="sm">
                        剧情记忆
                      </Text>
                      <Text size="xs" opacity={0.7}>
                        从最近聊天提炼关系、场景和伏笔，先填入下方表单，保存后用于后续回复。
                      </Text>
                    </Stack>
                    <Button
                      size="compact-sm"
                      variant="light"
                      color="chatbox-brand"
                      leftSection={<IconSparkles size={14} />}
                      loading={isSummarizingMemory}
                      onClick={() => void onSummarizeTavernMemory()}
                    >
                      整理剧情记忆
                    </Button>
                  </Flex>
                  {memorySummaryError && (
                    <Text size="xs" c="red" mt={6}>
                      {memorySummaryError}
                    </Text>
                  )}
                </Box>

                <Textarea
                  label="关系笔记"
                  description="记录用户与角色的关系、称呼、亲密度、约定和禁忌，只影响当前聊天。"
                  placeholder="例如：用户是角色的旧友；角色习惯称呼用户为旅人；不要主动跳过剧情。"
                  autosize
                  minRows={3}
                  maxRows={8}
                  value={editingData.characterRelationship || ''}
                  onChange={(event) => setEditingData({ ...editingData, characterRelationship: event.target.value })}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                />

                <Textarea
                  label="当前场景"
                  description="给模型一个稳定的当前地点、时间、氛围和正在发生的事。"
                  placeholder="例如：深夜酒馆二楼，窗外下雨，两人刚谈到失踪的委托人。"
                  autosize
                  minRows={2}
                  maxRows={6}
                  value={editingData.currentScene || ''}
                  onChange={(event) => setEditingData({ ...editingData, currentScene: event.target.value })}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                />

                <Textarea
                  label="长期记忆"
                  description="放关键伏笔、已发生事件和角色需要记住的偏好。建议短句分行。"
                  placeholder="例如：用户不喜欢太长回复；角色知道钥匙藏在壁炉后；上次剧情停在码头。"
                  autosize
                  minRows={3}
                  maxRows={10}
                  value={editingData.characterMemory || ''}
                  onChange={(event) => setEditingData({ ...editingData, characterMemory: event.target.value })}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                />

                <Input.Wrapper label="标签" description="用逗号分隔，例如：校园, NSFW, 甜虐">
                  <Input
                    placeholder="校园, 剧情, 女性"
                    value={(editingData.characterTags || []).join(', ')}
                    onChange={(event) =>
                      setEditingData({
                        ...editingData,
                        characterTags: event.target.value
                          .split(/[,，]/)
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                    classNames={{
                      input: '!text-chatbox-tint-primary',
                    }}
                  />
                </Input.Wrapper>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="scene" pt="md">
              <Stack gap="md">
                <SessionImageSlot
                  title="聊天背景"
                  description="绑定到当前角色会话，聊天时作为背景显示。支持 JPG/PNG，建议横图。"
                  source={editingData.backgroundImage}
                  appearance={editingData.backgroundAppearance || DEFAULT_BACKGROUND_APPEARANCE}
                  previewClassName="v2chat-session-settings__image-preview--wide"
                  accept="image/png,image/jpeg"
                  uploadLabel="上传"
                  onUpload={(file) => {
                    if (file.size > 5 * 1024 * 1024) {
                      addToast(t('Support jpg or png file smaller than 5MB'))
                      return
                    }
                    const key = StorageKeyGenerator.picture(`session-bg:${session.id}`)
                    handleImageInputAndSave(
                      file,
                      key,
                      () => setEditingData({ ...editingData, backgroundImage: { type: 'storage-key', storageKey: key } }),
                      (k, v) => storage.setBlob(k, v)
                    )
                  }}
                  onRemove={() => {
                    removeImageSource(editingData.backgroundImage)
                    setEditingData({ ...editingData, backgroundImage: undefined })
                  }}
                />

                {editingData.backgroundImage && (
                  <Box className="v2chat-session-settings__background-controls">
                    <Stack gap="md">
                      <BackgroundAppearanceSlider
                        label="背景强度"
                        value={Math.round((editingData.backgroundAppearance?.opacity ?? DEFAULT_BACKGROUND_APPEARANCE.opacity) * 100)}
                        min={20}
                        max={100}
                        suffix="%"
                        onChange={(value) =>
                          setEditingData({
                            ...editingData,
                            backgroundAppearance: {
                              ...(editingData.backgroundAppearance || DEFAULT_BACKGROUND_APPEARANCE),
                              opacity: value / 100,
                            },
                          })
                        }
                      />
                      <BackgroundAppearanceSlider
                        label="暗化遮罩"
                        value={Math.round((editingData.backgroundAppearance?.dim ?? DEFAULT_BACKGROUND_APPEARANCE.dim) * 100)}
                        min={0}
                        max={70}
                        suffix="%"
                        onChange={(value) =>
                          setEditingData({
                            ...editingData,
                            backgroundAppearance: {
                              ...(editingData.backgroundAppearance || DEFAULT_BACKGROUND_APPEARANCE),
                              dim: value / 100,
                            },
                          })
                        }
                      />
                      <BackgroundAppearanceSlider
                        label="背景模糊"
                        value={editingData.backgroundAppearance?.blur ?? DEFAULT_BACKGROUND_APPEARANCE.blur}
                        min={0}
                        max={16}
                        suffix="px"
                        onChange={(value) =>
                          setEditingData({
                            ...editingData,
                            backgroundAppearance: {
                              ...(editingData.backgroundAppearance || DEFAULT_BACKGROUND_APPEARANCE),
                              blur: value,
                            },
                          })
                        }
                      />
                    </Stack>
                  </Box>
                )}

                <SessionImageSlot
                  title="角色立绘"
                  description="显示在聊天右侧和沉浸模式里。推荐透明 PNG，后续可接 Live2D。"
                  source={editingData.standingImage}
                  previewClassName="v2chat-session-settings__image-preview--standing"
                  accept="image/png,image/jpeg,image/webp"
                  uploadLabel="上传"
                  onUpload={(file) => {
                    if (file.size > 8 * 1024 * 1024) {
                      addToast('图片不能超过 8MB')
                      return
                    }
                    const key = StorageKeyGenerator.picture(`session-standing:${session.id}`)
                    handleImageInputAndSave(
                      file,
                      key,
                      () => setEditingData({ ...editingData, standingImage: { type: 'storage-key', storageKey: key } }),
                      (k, v) => storage.setBlob(k, v)
                    )
                  }}
                  onRemove={() => {
                    removeImageSource(editingData.standingImage)
                    setEditingData({ ...editingData, standingImage: undefined })
                  }}
                />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="voice" pt="md">
              <Stack gap="md">
                {isChatSession(session) && (
                  <>
                    <Select
                      label="角色音色"
                      description="本会话生成语音条时优先使用此音色；清空后跟随全局 TTS 设置。"
                      placeholder="跟随全局设置"
                      clearable
                      searchable
                      leftSection={<IconVolume size={16} />}
                      data={[
                        ...(editingData.characterVoiceId &&
                        !TAVERN_VOICE_OPTIONS.some((item) => item.value === editingData.characterVoiceId)
                          ? [
                              {
                                value: editingData.characterVoiceId,
                                label: `自定义音色 (${editingData.characterVoiceId})`,
                              },
                            ]
                          : []),
                        ...TAVERN_VOICE_OPTIONS,
                      ]}
                      value={editingData.characterVoiceId || null}
                      onChange={(value) => {
                        setVoicePreviewUrl('')
                        setVoicePreviewError('')
                        setEditingData({ ...editingData, characterVoiceId: value || undefined })
                      }}
                      classNames={{
                        input: '!text-chatbox-tint-primary',
                      }}
                    />

                    <Box className="v2chat-session-settings__voice-preview">
                      <Flex align="center" justify="space-between" gap="sm" wrap="wrap">
                        <Stack gap={2} className="min-w-0">
                          <Text fw={800} size="sm">
                            试听角色音色
                          </Text>
                          <Text size="xs" opacity={0.68}>
                            用当前音色生成一句短台词，确认声音是否适合这个角色。
                          </Text>
                        </Stack>
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="chatbox-brand"
                          leftSection={<IconVolume size={14} />}
                          loading={isGeneratingVoicePreview}
                          onClick={() => void onPreviewVoice()}
                        >
                          生成试听
                        </Button>
                      </Flex>
                      {voicePreviewUrl && (
                        <audio controls src={voicePreviewUrl} className="v2chat-session-settings__voice-player" />
                      )}
                      {voicePreviewError && (
                        <Text size="xs" c="red" mt={6}>
                          {voicePreviewError}
                        </Text>
                      )}
                    </Box>
                  </>
                )}

                <Box className="v2chat-session-settings__note">
                  <Text fw={700} size="sm">
                    对话中怎么触发？
                  </Text>
                  <Text size="sm" opacity={0.72}>
                    用户说“用语音回答我”“读出来”“发语音”等请求时，V2Chat 会把 AI 的简短回复转成语音条。
                  </Text>
                </Box>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="advanced" pt="md">
              <Stack gap="md">
                <Textarea
                  label="角色设定提示词"
                  placeholder={t('Copilot Prompt Demo') || ''}
                  autosize
                  minRows={3}
                  maxRows={12}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                  styles={{
                    input: { touchAction: 'manipulation' },
                  }}
                />

                <Stack gap="xs">
                  <Flex align="center" justify="space-between">
                    <Text fw={700}>模型参数</Text>
                    <Button size="compact-sm" color="chatbox-brand" variant="transparent" onClick={onReset} fw={600}>
                      重置
                    </Button>
                  </Flex>

                  <Box p="sm" className="border border-solid border-chatbox-border-primary rounded-md">
                    {isChatSession(session) && (
                      <ChatConfig
                        settings={editingData.settings}
                        onSettingsChange={(d) =>
                          setEditingData((_data) => {
                            if (_data) {
                              return {
                                ..._data,
                                settings: {
                                  ..._data?.settings,
                                  ...d,
                                },
                              }
                            } else {
                              return null
                            }
                          })
                        }
                      />
                    )}
                    {isPictureSession(session) && <PictureConfig dataEdit={editingData} setDataEdit={setEditingData} />}
                  </Box>
                </Stack>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </div>

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onCancel}>取消</AdaptiveModal.CloseButton>
          <Button onClick={onSave}>保存</Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default SessionSettingsModal

function getSessionSettingsSummary(description?: string, characterName?: string) {
  if (!description) return ''

  const name = characterName?.trim() || '角色'
  const normalized = description
    .replace(/<\{\{char\}\}>/gi, ' ')
    .replace(/\{\{char\}\}/gi, name)
    .replace(/\{\{user\}\}/gi, '用户')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/^---+$/gm, ' ')
    .replace(/^[-*]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return ''
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized
}

type TavernMemorySummary = {
  relationship?: string
  currentScene?: string
  memory?: string
}

function buildRecentRoleplayTranscript(session: Session) {
  const messages = (session.messages || [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-24)
    .map((message) => {
      const role = message.role === 'user' ? '用户' : '角色'
      const text = getMessageText(message, false, false).replace(/\s+/g, ' ').trim()
      if (!text) return ''
      return `${role}: ${text.length > 900 ? `${text.slice(0, 900)}...` : text}`
    })
    .filter(Boolean)

  if (messages.length < 2) return ''
  const transcript = messages.join('\n')
  return transcript.length > 9000 ? transcript.slice(-9000) : transcript
}

function getTextFromMessageParts(parts: MessageContentParts) {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

function parseTavernMemorySummary(rawText: string): TavernMemorySummary {
  const cleaned = rawText
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const jsonText = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    throw new Error('模型没有返回可识别的剧情记忆 JSON')
  }

  const relationship = pickSummaryField(parsed, ['relationship', 'relationshipNotes', '关系笔记', '关系'])
  const currentScene = pickSummaryField(parsed, ['currentScene', 'scene', '当前场景', '场景'])
  const memory = pickSummaryField(parsed, ['memory', 'longTermMemory', '长期记忆', '记忆'])

  if (!relationship && !currentScene && !memory) {
    throw new Error('没有提炼到可用的剧情记忆')
  }

  return { relationship, currentScene, memory }
}

function pickSummaryField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value)) {
      const text = value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
        .join('\n')
      if (text) return text
    }
  }
  return ''
}

function withTavernMemoryUpdatedAt(editingData: Session, originalSession: Session): Session {
  const hasMemory = [editingData.characterRelationship, editingData.currentScene, editingData.characterMemory].some(
    (value) => Boolean(value?.trim())
  )
  if (!hasMemory) {
    return { ...editingData, characterMemoryUpdatedAt: undefined }
  }

  const memoryChanged =
    normalizeMemoryField(editingData.characterRelationship) !== normalizeMemoryField(originalSession.characterRelationship) ||
    normalizeMemoryField(editingData.currentScene) !== normalizeMemoryField(originalSession.currentScene) ||
    normalizeMemoryField(editingData.characterMemory) !== normalizeMemoryField(originalSession.characterMemory)

  if (!memoryChanged && editingData.characterMemoryUpdatedAt) {
    return editingData
  }

  return {
    ...editingData,
    characterMemoryUpdatedAt: Date.now(),
  }
}

function normalizeMemoryField(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function removeImageSource(source?: ImageSource) {
  if (source?.type === 'storage-key') {
    storage.removeItem(source.storageKey)
  }
}

function SessionImageSlot({
  title,
  description,
  source,
  appearance,
  previewClassName,
  accept,
  uploadLabel,
  onUpload,
  onRemove,
}: {
  title: string
  description: string
  source?: ImageSource
  appearance?: SessionBackgroundAppearance
  previewClassName: string
  accept: string
  uploadLabel: string
  onUpload: (file: File) => void
  onRemove: () => void
}) {
  const previewStyle = appearance
    ? ({
        '--v2chat-preview-opacity': appearance.opacity,
        '--v2chat-preview-dim': appearance.dim,
        '--v2chat-preview-blur': `${appearance.blur}px`,
      } as CSSProperties)
    : undefined
  return (
    <Box className="v2chat-session-settings__image-slot">
      <Flex align="flex-start" justify="space-between" gap="sm" wrap="wrap">
        <Stack gap={2} className="min-w-0">
          <Text fw={800} size="sm">
            {title}
          </Text>
          <Text size="xs" opacity={0.68}>
            {description}
          </Text>
        </Stack>

        <Flex gap="xs">
          <FileButton accept={accept} onChange={(file) => file && onUpload(file)}>
            {(props) => (
              <Button {...props} variant="default" size="compact-sm">
                <ScalableIcon icon={IconUpload} size={12} className="mr-xs" />
                {uploadLabel}
              </Button>
            )}
          </FileButton>
          {source && (
            <Button color="chatbox-error" variant="subtle" size="compact-sm" onClick={onRemove}>
              移除
            </Button>
          )}
        </Flex>
      </Flex>

      <div
        className={`v2chat-session-settings__image-preview ${previewClassName}${appearance ? ' is-background' : ''}`}
        style={previewStyle}
      >
        {source?.type === 'storage-key' ? (
          <ImageInStorage storageKey={source.storageKey} className="v2chat-session-settings__image" />
        ) : source?.type === 'url' ? (
          <img src={source.url} alt="" className="v2chat-session-settings__image" />
        ) : (
          <div className="v2chat-session-settings__image-empty">
            <IconPhoto size={22} />
            <span>尚未绑定图片</span>
          </div>
        )}
        {appearance && source && <div className="v2chat-session-settings__image-scrim" />}
      </div>
    </Box>
  )
}

function BackgroundAppearanceSlider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <Stack gap={5}>
      <Flex align="center" justify="space-between" gap="sm">
        <Text size="xs" fw={700}>
          {label}
        </Text>
        <Text size="xs" c="chatbox-tertiary">
          {value}
          {suffix}
        </Text>
      </Flex>
      <Slider aria-label={label} value={value} min={min} max={max} step={1} label={null} onChange={onChange} />
    </Stack>
  )
}

interface ThinkingBudgetConfigProps {
  currentBudgetTokens: number
  isEnabled: boolean
  onConfigChange: (config: { budgetTokens: number; enabled: boolean }) => void
  tooltipText: string
  minValue?: number
  maxValue?: number
}

function ThinkingBudgetConfig({
  currentBudgetTokens,
  isEnabled,
  onConfigChange,
  tooltipText,
  minValue = 1024,
  maxValue = 10000,
}: ThinkingBudgetConfigProps) {
  const { t } = useTranslation()

  // Define preset values in one place
  const PRESET_VALUES = useMemo(() => [2048, 5120, 10240], [])

  const thinkingBudgetOptions = useMemo(
    () => [
      { label: t('Disabled'), value: 'disabled' },
      { label: `${t('Low')} (2K)`, value: PRESET_VALUES[0].toString() },
      { label: `${t('Medium')} (5K)`, value: PRESET_VALUES[1].toString() },
      { label: `${t('High')} (10K)`, value: PRESET_VALUES[2].toString() },
      { label: t('Custom'), value: 'custom' },
    ],
    [t, PRESET_VALUES]
  )

  // Add state to track custom mode selection
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [userSelectedCustom, setUserSelectedCustom] = useState(false)

  // Initialize custom mode based on current budget tokens
  useEffect(() => {
    if (isEnabled) {
      const matchesPreset = PRESET_VALUES.includes(currentBudgetTokens)
      // Only auto-set custom mode if user hasn't manually selected custom and value doesn't match presets
      if (!matchesPreset && !isCustomMode && !userSelectedCustom) {
        setIsCustomMode(true)
      }
      // Don't override user's manual custom selection even if value matches preset
    } else {
      // Only reset if currently in custom mode
      if (isCustomMode || userSelectedCustom) {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
      }
    }
  }, [isEnabled, currentBudgetTokens, PRESET_VALUES, isCustomMode, userSelectedCustom])

  // Determine current segment value
  const getCurrentSegmentValue = useCallback(() => {
    if (!isEnabled) return 'disabled'

    if (isCustomMode || userSelectedCustom) return 'custom'

    const matchingPreset = PRESET_VALUES.find((preset) => preset === currentBudgetTokens)
    return matchingPreset ? matchingPreset.toString() : 'custom'
  }, [isEnabled, isCustomMode, userSelectedCustom, PRESET_VALUES, currentBudgetTokens])

  const handleThinkingConfigChange = useCallback(
    (value: string) => {
      if (value === 'disabled') {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
        onConfigChange({ budgetTokens: 0, enabled: false })
      } else if (value === 'custom') {
        setIsCustomMode(true)
        setUserSelectedCustom(true) // Mark that user manually selected custom
        // For disabled to custom switch, use a reasonable default
        const customValue = currentBudgetTokens > 0 ? currentBudgetTokens : minValue || PRESET_VALUES[0]
        onConfigChange({ budgetTokens: customValue, enabled: true })
      } else {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
        onConfigChange({ budgetTokens: parseInt(value), enabled: true })
      }
    },
    [currentBudgetTokens, minValue, PRESET_VALUES, onConfigChange]
  )

  const handleCustomBudgetChange = useCallback(
    (v: number | undefined) => {
      onConfigChange({ budgetTokens: v || minValue, enabled: true })
    },
    [minValue, onConfigChange]
  )

  const currentSegmentValue = getCurrentSegmentValue()

  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Budget')}
        </Text>
        <Tooltip
          label={tooltipText}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <div style={{ minWidth: 0, overflowX: 'auto' }}>
        <SegmentedControl
          key="thinking-budget-control"
          value={currentSegmentValue}
          onChange={handleThinkingConfigChange}
          data={thinkingBudgetOptions}
        />
      </div>

      {currentSegmentValue === 'custom' && (
        <SliderWithInput
          min={minValue}
          max={maxValue}
          step={1}
          value={currentBudgetTokens}
          onChange={handleCustomBudgetChange}
        />
      )}
    </Stack>
  )
}

interface ThinkingLevelConfigProps {
  currentLevel: GoogleThinkingLevel
  supportedLevels: GoogleThinkingLevel[]
  onLevelChange: (thinkingLevel: GoogleThinkingLevel) => void
  tooltipText: string
}

function ThinkingLevelConfig({ currentLevel, supportedLevels, onLevelChange, tooltipText }: ThinkingLevelConfigProps) {
  const { t } = useTranslation()

  const thinkingLevelOptions = useMemo(
    () =>
      supportedLevels.map((level) => ({
        label:
          level === 'minimal'
            ? t('Minimal')
            : level === 'low'
              ? t('Low')
              : level === 'medium'
                ? t('Medium')
                : t('High'),
        value: level,
      })),
    [supportedLevels, t]
  )

  const handleThinkingLevelChange = useCallback(
    (value: string) => {
      onLevelChange(value as GoogleThinkingLevel)
    },
    [onLevelChange]
  )

  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Level')}
        </Text>
        <Tooltip
          label={tooltipText}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <div style={{ minWidth: 0, overflowX: 'auto' }}>
        <SegmentedControl
          key={`thinking-level-control:${supportedLevels.join(',')}`}
          value={currentLevel}
          onChange={handleThinkingLevelChange}
          data={thinkingLevelOptions}
          fullWidth={false}
        />
      </div>
    </Stack>
  )
}

function ClaudeProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.claude

  const handleConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        claude: {
          thinking: {
            type: config.enabled ? 'enabled' : 'disabled',
            budgetTokens: config.budgetTokens,
          },
        },
      },
    })
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions?.thinking?.budgetTokens || 1024}
      isEnabled={providerOptions?.thinking?.type === 'enabled'}
      onConfigChange={handleConfigChange}
      tooltipText={t('Thinking Budget only works for 3.7 or later models')}
      minValue={1024}
      maxValue={10000}
    />
  )
}

function OpenAIProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.openai

  // Memoize options to prevent recreation on every render
  const reasoningEffortOptions = useMemo(
    () => [
      { label: t('Disabled'), value: 'null' },
      { label: t('Low'), value: 'low' },
      { label: t('Medium'), value: 'medium' },
      { label: t('High'), value: 'high' },
    ],
    [t]
  )

  const handleReasoningEffortChange = useCallback(
    (value: string) => {
      const reasoningEffort = value === 'null' ? undefined : (value as 'low' | 'medium' | 'high')
      onSettingsChange({
        providerOptions: {
          openai: { reasoningEffort },
        },
      })
    },
    [onSettingsChange]
  )

  // Simplify value calculation to avoid instability
  const currentValue = useMemo(() => {
    const effort = providerOptions?.reasoningEffort
    return effort === undefined ? 'null' : effort
  }, [providerOptions?.reasoningEffort])

  return (
    <Stack gap="md">
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Effort')}
        </Text>
        <Tooltip
          label={t('Thinking Effort only works for OpenAI o-series models')}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <SegmentedControl
        key="reasoning-effort-control"
        value={currentValue}
        onChange={handleReasoningEffortChange}
        data={reasoningEffortOptions}
      />
    </Stack>
  )
}

function GoogleProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const modelId = settings?.modelId || ''
  const providerOptions = settings?.providerOptions?.google
  const thinkingMode = getGoogleThinkingMode(modelId)
  const supportedLevels = useMemo(() => getSupportedGoogleThinkingLevels(modelId), [modelId])

  const handleBudgetConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: config.budgetTokens, includeThoughts: config.enabled } },
      },
    })
  }

  const handleLevelChange = useCallback(
    (thinkingLevel: GoogleThinkingLevel) => {
      onSettingsChange({
        providerOptions: {
          google: { thinkingConfig: { thinkingLevel, includeThoughts: true } },
        },
      })
    },
    [onSettingsChange]
  )

  const currentThinkingLevel = useMemo(() => {
    const thinkingLevel = providerOptions?.thinkingConfig?.thinkingLevel

    if (supportedLevels.length === 0) {
      return undefined
    }

    if (thinkingLevel && supportedLevels.includes(thinkingLevel)) {
      return thinkingLevel
    }

    return getDefaultGoogleThinkingLevel(modelId)
  }, [modelId, providerOptions?.thinkingConfig?.thinkingLevel, supportedLevels])

  if (thinkingMode === 'level' && currentThinkingLevel) {
    return (
      <ThinkingLevelConfig
        currentLevel={currentThinkingLevel}
        supportedLevels={supportedLevels}
        onLevelChange={handleLevelChange}
        tooltipText={t('Thinking Level only works for Gemini 3 models')}
      />
    )
  }

  if (thinkingMode !== 'budget') {
    return null
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions?.thinkingConfig?.thinkingBudget || 0}
      isEnabled={(providerOptions?.thinkingConfig?.thinkingBudget || 0) > 0}
      onConfigChange={handleBudgetConfigChange}
      tooltipText={t('Thinking Budget only works for Gemini 2.5 models')}
      minValue={0}
      maxValue={10000}
    />
  )
}

export function ChatConfig({
  settings,
  onSettingsChange,
}: {
  settings: Session['settings']
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const globalSettingsStream = useSettingsStore((s) => s.stream)

  return (
    <Stack gap="md">
      <MaxContextMessageCountSlider
        value={settings?.maxContextMessageCount ?? chatSessionSettings().maxContextMessageCount!}
        onChange={(v) => onSettingsChange({ maxContextMessageCount: v })}
      />

      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            {t('Temperature')}
          </Text>
          <Tooltip
            label={t(
              'Modify the creativity of AI responses; the higher the value, the more random and intriguing the answers become, while a lower value ensures greater stability and reliability.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <SliderWithInput value={settings?.temperature} onChange={(v) => onSettingsChange({ temperature: v })} max={2} />
      </Stack>

      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            Top P
          </Text>
          <Tooltip
            label={t(
              'The topP parameter controls the diversity of AI responses: lower values make the output more focused and predictable, while higher values allow for more varied and creative replies.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <SliderWithInput value={settings?.topP} onChange={(v) => onSettingsChange({ topP: v })} max={1} />
      </Stack>

      <Flex justify="space-between" align="center">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            {t('Max Output Tokens')}
          </Text>
          <Tooltip
            label={t(
              'Set the maximum number of tokens for model output. Please set it within the acceptable range of the model, otherwise errors may occur.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <LazyNumberInput
          width={96}
          value={settings?.maxTokens}
          onChange={(v) => onSettingsChange({ maxTokens: typeof v === 'number' ? v : undefined })}
          min={0}
          step={1024}
          allowDecimal={false}
          placeholder={t('Not set') || ''}
        />
      </Flex>

      {settings?.provider !== ModelProviderEnum.ChatboxAI && (
        <Stack gap="xs" py="xs">
          <Flex align="center" justify="space-between" gap="xs">
            <Text size="sm" fw="600">
              {t('Stream output')}
            </Text>
            <Switch
              checked={settings?.stream ?? globalSettingsStream ?? true}
              onChange={(v) => onSettingsChange({ stream: v.target.checked })}
            />
          </Flex>
        </Stack>
      )}

      {settings?.provider === ModelProviderEnum.Claude && (
        <ClaudeProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
      )}
      {settings?.provider === ModelProviderEnum.OpenAI && (
        <OpenAIProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
      )}
      {settings?.provider === ModelProviderEnum.Gemini && (
        <GoogleProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
      )}
    </Stack>
  )
}

function PictureConfig(props: { dataEdit: Session; setDataEdit: (data: Session) => void }) {
  const { t } = useTranslation()
  const { dataEdit, setDataEdit } = props
  const globalSettings = settingsStore.getState().getSettings()
  const sessionSettings = mergeSettings(globalSettings, dataEdit.settings || {}, dataEdit.type || 'chat')
  const updateSettingsEdit = (updated: Partial<SessionSettings>) => {
    setDataEdit({
      ...dataEdit,
      settings: {
        ...(dataEdit.settings || {}),
        ...updated,
      },
    })
  }
  return (
    <Stack gap="md" className="my-4">
      <ImageStyleSelect
        value={sessionSettings.dalleStyle || pictureSessionSettings().dalleStyle!}
        onChange={(v) => updateSettingsEdit({ dalleStyle: v })}
        className={sessionSettings.dalleStyle === undefined ? 'opacity-50' : ''}
      />
      <Stack>
        <Text size="sm" fw="600">
          {t('Number of Images per Reply')}
        </Text>
        <Slider
          value={sessionSettings.imageGenerateNum || pictureSessionSettings().imageGenerateNum!}
          onChange={(v) => updateSettingsEdit({ imageGenerateNum: v })}
          min={1}
          max={10}
          step={1}
          marks={Array.from({ length: 10 }).map((_, i) => ({
            value: i + 1,
          }))}
        />
      </Stack>
    </Stack>
  )
}
