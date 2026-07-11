import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Avatar, Box, Button, Divider, Flex, Group, Modal, Popover, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import type { ImageSource, Message, ModelProvider, Session } from '@shared/types'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCards,
  IconDeviceFloppy,
  IconLayoutSidebarLeftExpand,
  IconMapPin,
  IconNotes,
  IconPhoto,
  IconPhotoOff,
  IconRefresh,
  IconSettings,
  IconSparkles,
  IconUserCircle,
  IconUsers,
  IconVolume,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { JK_PAGE_NAMES } from '@/analytics/jk-events'
import { ChatboxWelcomeCard } from '@/components/common/ChatboxWelcomeCard'
import { ImageInStorage } from '@/components/Image'
import MessageList, { type MessageListRef } from '@/components/chat/MessageList'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import InputBox from '@/components/InputBox/InputBox'
import Header from '@/components/layout/Header'
import Page from '@/components/layout/Page'
import { useProviders } from '@/hooks/useProviders'
import { defaultSessionsForCN, defaultSessionsForEN } from '@/packages/initial_data'
import { summarizeTavernMemoryFromSession } from '@/packages/tavernMemory'
import { TAVERN_VOICE_OPTIONS } from '@/packages/tavernCharacters'
import ThreadHistoryDrawer from '@/components/session/ThreadHistoryDrawer'
import * as remote from '@/packages/remote'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { updateSession as updateSessionStore, useSession } from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import * as scrollActions from '@/stores/scrollActions'
import { modifyMessage, removeCurrentThread, startNewThread, submitNewUserMessage } from '@/stores/sessionActions'
import { getAllMessageList } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import { getHomeWelcomeCardMode } from '@/utils/homeWelcomeCard'

export const Route = createFileRoute('/session/$sessionId')({
  component: RouteComponent,
})

const builtInTemplateSessionIds = new Set(
  [...defaultSessionsForEN, ...defaultSessionsForCN].map((session) => session.id)
)

const DEFAULT_BACKGROUND_APPEARANCE = { opacity: 0.78, dim: 0.2, blur: 2 }

function RouteComponent() {
  const { t } = useTranslation()
  const { sessionId: currentSessionId } = Route.useParams()
  const navigate = useNavigate()
  const { session: currentSession, isFetching } = useSession(currentSessionId)
  const { providers } = useProviders()
  const hasLicense = useSettingsStore((s) => Boolean(s.licenseKey))
  const hasExpiredLicense = useSettingsStore((s) => s.hasExpiredLicense)
  const isLoggedIn = useAuthInfoStore((s) => Boolean(s.accessToken && s.refreshToken))
  const widthFull = useUIStore((s) => s.widthFull)
  const tavernImmersiveMode = useUIStore((s) => s.tavernImmersiveMode)
  const setTavernImmersiveMode = useUIStore((s) => s.setTavernImmersiveMode)
  const tavernStageVisible = useUIStore((s) => s.tavernStageVisible)
  const setTavernStageVisible = useUIStore((s) => s.setTavernStageVisible)
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const [memoryManagerOpened, setMemoryManagerOpened] = useState(false)
  const setLastUsedChatModel = useStore(lastUsedModelStore, (state) => state.setChatModel)
  const setLastUsedPictureModel = useStore(lastUsedModelStore, (state) => state.setPictureModel)
  const welcomeCardMode = useMemo(
    () => getHomeWelcomeCardMode({ providerCount: providers.length, isLoggedIn, hasLicense, hasExpiredLicense }),
    [providers.length, isLoggedIn, hasLicense, hasExpiredLicense]
  )

  const currentMessageList = useMemo(() => (currentSession ? getAllMessageList(currentSession) : []), [currentSession])
  const shouldShowTemplateWelcomeCard = useMemo(
    () => Boolean(currentSession && builtInTemplateSessionIds.has(currentSession.id) && welcomeCardMode !== 'none'),
    [currentSession, welcomeCardMode]
  )
  const lastGeneratingMessage = useMemo(
    () => currentMessageList.find((m: Message) => m.generating),
    [currentMessageList]
  )

  const messageListRef = useRef<MessageListRef>(null)

  const goHome = useCallback(() => {
    navigate({ to: '/', replace: true })
  }, [navigate])

  useEffect(() => {
    setTimeout(() => {
      scrollActions.scrollToBottom('auto') // 每次启动时自动滚动到底部
    }, 200)
  }, [])

  useEffect(() => {
    if (tavernImmersiveMode && showSidebar) {
      setShowSidebar(false)
    }
  }, [tavernImmersiveMode, showSidebar, setShowSidebar])

  // currentSession变化时（包括session settings变化），存下当前的settings作为新Session的默认值
  useEffect(() => {
    if (currentSession) {
      if (currentSession.type === 'chat' && currentSession.settings) {
        const { provider, modelId } = currentSession.settings
        if (provider && modelId) {
          setLastUsedChatModel(provider, modelId)
        }
      }
      if (currentSession.type === 'picture' && currentSession.settings) {
        const { provider, modelId } = currentSession.settings
        if (provider && modelId) {
          setLastUsedPictureModel(provider, modelId)
        }
      }
    }
  }, [currentSession?.settings, currentSession?.type, currentSession, setLastUsedChatModel, setLastUsedPictureModel])

  const onSelectModel = useCallback(
    (provider: ModelProvider, modelId: string) => {
      if (!currentSession) {
        return
      }
      void updateSessionStore(currentSession.id, {
        settings: {
          ...(currentSession.settings || {}),
          provider,
          modelId,
        },
      })
    },
    [currentSession]
  )

  const onStartNewThread = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void startNewThread(currentSession.id)
    if (currentSession.copilotId) {
      void remote
        .recordCopilotUsage({ id: currentSession.copilotId, action: 'create_thread' })
        .catch((error) => console.warn('[recordCopilotUsage] failed', error))
    }
    return true
  }, [currentSession])

  const onRollbackThread = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void removeCurrentThread(currentSession.id)
    return true
  }, [currentSession])

  const onSubmit = useCallback(
    async ({
      constructedMessage,
      needGenerating = true,
      onUserMessageReady,
    }: {
      constructedMessage: Message
      needGenerating?: boolean
      onUserMessageReady?: () => void
    }) => {
      messageListRef.current?.setIsNewMessage(true)

      if (!currentSession) {
        return
      }
      messageListRef.current?.scrollToBottom('instant')

      if (currentSession.copilotId) {
        void remote
          .recordCopilotUsage({ id: currentSession.copilotId, action: 'create_message' })
          .catch((error) => console.warn('[recordCopilotUsage] failed', error))
      }

      await submitNewUserMessage(currentSession.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [currentSession]
  )

  const onClickSessionSettings = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void NiceModal.show('session-settings', {
      session: currentSession,
    })
    return true
  }, [currentSession])

  const onStopGenerating = useCallback(() => {
    if (!currentSession) {
      return false
    }
    if (lastGeneratingMessage?.generating) {
      lastGeneratingMessage?.cancel?.()
      void modifyMessage(currentSession.id, { ...lastGeneratingMessage, generating: false }, true)
    }
    return true
  }, [currentSession, lastGeneratingMessage])

  const model = useMemo(() => {
    if (!currentSession?.settings?.modelId || !currentSession?.settings?.provider) {
      return undefined
    }
    return {
      provider: currentSession.settings.provider,
      modelId: currentSession.settings.modelId,
    }
  }, [currentSession?.settings?.provider, currentSession?.settings?.modelId])

  return currentSession ? (
    <div
      className={clsx(
        'v2chat-session v2chat-session--social v2chat-session--simple',
        currentSession.backgroundImage && 'v2chat-session--has-background',
        tavernImmersiveMode && 'v2chat-session--immersive'
      )}
    >
      <SessionBackground session={currentSession} />
      {tavernImmersiveMode ? (
        <Flex className="v2chat-immersive-bar title-bar" align="center" justify="space-between" gap="sm">
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="xl"
            onClick={() => setShowSidebar(true)}
            aria-label="显示侧栏"
          >
            <IconLayoutSidebarLeftExpand size={18} />
          </ActionIcon>
          <Text fw={700} lineClamp={1} className="min-w-0">
            {currentSession.name}
          </Text>
          <Tooltip label="退出沉浸">
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={() => {
                setTavernImmersiveMode(false)
                setShowSidebar(true)
              }}
              aria-label="退出沉浸"
            >
              <IconArrowsMinimize size={18} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      ) : (
        <>
          <Header session={currentSession} model={model} onSelectModel={onSelectModel} />
          <TavernRoleStatusBar
            session={currentSession}
            stageVisible={tavernStageVisible}
            onToggleStage={() => setTavernStageVisible(!tavernStageVisible)}
            onOpenMemory={() => setMemoryManagerOpened(true)}
          />
          <Box className="v2chat-floating-tools">
            <CharacterQuickPanel
              session={currentSession}
              onOpenSettings={onClickSessionSettings}
              onOpenLibrary={() => navigate({ to: '/' })}
              onOpenMemory={() => setMemoryManagerOpened(true)}
            />
            <Tooltip label="沉浸模式">
              <ActionIcon
                className="v2chat-immersive-toggle"
                variant="filled"
                color="dark"
                radius="xl"
                onClick={() => setTavernImmersiveMode(true)}
                aria-label="沉浸模式"
              >
                <IconArrowsMaximize size={18} />
              </ActionIcon>
            </Tooltip>
          </Box>
        </>
      )}

      <div className="v2chat-session__main">
        <div className="v2chat-session__conversation">
          {/* MessageList 设置 key，确保每个 session 对应新的 MessageList 实例 */}
          <div className="v2chat-session__messages">
            <MessageList
              ref={messageListRef}
              key={`message-list${currentSessionId}`}
              currentSession={currentSession}
            />
          </div>

          <Box className="v2chat-session__input relative">
            {shouldShowTemplateWelcomeCard && (
              // absolute — taken out of flow, doesn't affect layout of siblings
              // bottom: '100%' — positioned right above the parent box's top edge (like a tooltip anchoring upward)
              <Box className="pointer-events-none absolute left-0 right-0 z-10" style={{ bottom: '100%' }} px="sm" mb="sm">
                <Box className={widthFull ? 'w-full' : 'max-w-4xl mx-auto'}>
                  <ChatboxWelcomeCard
                    mode={welcomeCardMode}
                    pageName={JK_PAGE_NAMES.CHAT_PAGE}
                    className="pointer-events-auto w-full"
                  />
                </Box>
              </Box>
            )}

            <TavernMemorySignal session={currentSession} onOpenMemory={() => setMemoryManagerOpened(true)} />

            {/* <ScrollButtons /> */}
            <ErrorBoundary name="session-inputbox">
              <InputBox
                key={`input-box${currentSession.id}`}
                sessionId={currentSession.id}
                sessionType={currentSession.type}
                model={model}
                onStartNewThread={onStartNewThread}
                onRollbackThread={onRollbackThread}
                onSelectModel={onSelectModel}
                onClickSessionSettings={onClickSessionSettings}
                generating={!!lastGeneratingMessage}
                onSubmit={onSubmit}
                onStopGenerating={onStopGenerating}
              />
            </ErrorBoundary>
          </Box>
        </div>
        <CharacterStage session={currentSession} immersive={tavernImmersiveMode} visible={tavernStageVisible} />
      </div>
      <TavernMemoryManagerModal
        session={currentSession}
        opened={memoryManagerOpened}
        onClose={() => setMemoryManagerOpened(false)}
      />
      <ThreadHistoryDrawer session={currentSession} />
    </div>
  ) : (
    !isFetching && (
      <Page title="">
        <div className="flex flex-1 flex-col items-center justify-center min-h-[60vh]">
          <div className="text-2xl font-semibold text-gray-700 mb-4">{t('Conversation not found')}</div>
          <Button variant="outline" onClick={goHome}>
            {t('Back to HomePage')}
          </Button>
        </div>
      </Page>
    )
  )
}

function TavernRoleStatusBar({
  session,
  stageVisible,
  onToggleStage,
  onOpenMemory,
}: {
  session: Session
  stageVisible: boolean
  onToggleStage: () => void
  onOpenMemory: () => void
}) {
  if (session.type && session.type !== 'chat') {
    return null
  }

  const memoryState = getTavernMemoryState(session)
  const scene = compactPanelText(session.currentScene) || '场景待整理'
  const relationship = compactPanelText(session.characterRelationship) || '关系待记录'
  const hasVoice = Boolean(session.characterVoiceId)
  const hasBackground = Boolean(session.backgroundImage)
  const hasStanding = Boolean(session.standingImage)

  return (
    <div className="v2chat-role-status">
      <Flex align="center" gap="sm" className="v2chat-role-status__identity">
        <Avatar size={42} radius="xl" src={session.picUrl} className="v2chat-role-status__avatar">
          {session.assistantAvatarKey ? (
            <ImageInStorage storageKey={session.assistantAvatarKey} className="v2chat-role-status__avatar-image" />
          ) : (
            session.name.slice(0, 1) || 'V'
          )}
        </Avatar>
        <div className="min-w-0">
          <Flex align="center" gap={7} className="min-w-0">
            <Text fw={900} size="sm" lineClamp={1} className="v2chat-role-status__name">
              {session.name}
            </Text>
            {session.characterTags?.slice(0, 2).map((tag) => (
              <span key={tag} className="v2chat-role-status__tag">
                {tag}
              </span>
            ))}
          </Flex>
          <Text size="xs" lineClamp={1} className="v2chat-role-status__scene">
            {scene}
          </Text>
        </div>
      </Flex>

      <Flex align="center" gap={8} className="v2chat-role-status__context">
        <span className="v2chat-role-status__relation">{relationship}</span>
        <button type="button" className={clsx('v2chat-role-status__memory', `is-${memoryState.status}`)} onClick={onOpenMemory}>
          <IconSparkles size={13} />
          <span>{memoryState.badge}</span>
        </button>
      </Flex>

      <Flex align="center" gap={6} className="v2chat-role-status__capabilities">
        <RoleStatusCapability icon={<IconVolume size={13} />} label="音色" active={hasVoice} />
        <RoleStatusCapability icon={<IconPhoto size={13} />} label="背景" active={hasBackground} />
        <button
          type="button"
          className={clsx('v2chat-role-status__capability v2chat-role-status__stage-toggle', stageVisible && 'is-active')}
          onClick={onToggleStage}
          aria-label={stageVisible ? '隐藏立绘' : '显示立绘'}
        >
          {stageVisible ? <IconCards size={13} /> : <IconPhotoOff size={13} />}
          <span>{stageVisible ? (hasStanding ? '立绘' : '占位') : '隐藏'}</span>
        </button>
      </Flex>
    </div>
  )
}

function RoleStatusCapability({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <span className={clsx('v2chat-role-status__capability', active && 'is-active')}>
      {icon}
      <span>{label}</span>
    </span>
  )
}

function CharacterStage({ session, immersive, visible }: { session: Session; immersive: boolean; visible: boolean }) {
  if (session.type && session.type !== 'chat') {
    return null
  }

  const shouldShowStage = visible && Boolean(session.characterId || session.standingImage)
  if (!shouldShowStage) {
    return null
  }

  const tags = session.characterTags?.slice(0, 3) ?? []

  return (
    <aside className={clsx('v2chat-character-stage', immersive && 'v2chat-character-stage--immersive')}>
      <div className="v2chat-character-stage__frame">
        {session.standingImage ? (
          <ImageSourceView source={session.standingImage} />
        ) : (
          <div className="v2chat-character-stage__placeholder">
            <div>
              <div className="v2chat-character-stage__placeholder-mark">{session.name.slice(0, 1) || 'V'}</div>
              <Text fw={900} size="sm" mt={12}>
                立绘待设置
              </Text>
              <Text size="xs" mt={4} opacity={0.74}>
                可在角色设置中绑定 PNG 立绘
              </Text>
            </div>
          </div>
        )}
        <div className="v2chat-character-stage__live2d">Live2D 预留</div>
      </div>
      <div className="v2chat-character-stage__plate">
        <Text fw={800} size="sm" lineClamp={1}>
          {session.name}
        </Text>
        <Text size="xs" mt={4} lineClamp={2} opacity={0.78}>
          {session.currentScene || session.characterDescription || '当前场景待整理'}
        </Text>
        {tags.length > 0 ? (
          <Flex gap={6} mt={10} wrap="wrap">
            {tags.map((tag) => (
              <span key={tag} className="v2chat-character-stage__tag">
                {tag}
              </span>
            ))}
          </Flex>
        ) : null}
      </div>
    </aside>
  )
}

function SessionBackground({ session }: { session: Session }) {
  if (!session.backgroundImage) return null
  const appearance = { ...DEFAULT_BACKGROUND_APPEARANCE, ...session.backgroundAppearance }
  const style = {
    '--v2chat-session-background-opacity': appearance.opacity,
    '--v2chat-session-background-dim': appearance.dim,
    '--v2chat-session-background-blur': `${appearance.blur}px`,
  } as CSSProperties

  return (
    <div className="v2chat-session__background" style={style} aria-hidden="true">
      <div className="v2chat-session__background-image">
        <ImageSourceView source={session.backgroundImage} className="v2chat-session__background-media" />
      </div>
      <div className="v2chat-session__background-scrim" />
    </div>
  )
}

function CharacterQuickPanel({
  session,
  onOpenSettings,
  onOpenLibrary,
  onOpenMemory,
}: {
  session: Session
  onOpenSettings: () => boolean | Promise<boolean>
  onOpenLibrary: () => void
  onOpenMemory: () => void
}) {
  const [opened, setOpened] = useState(false)
  const tags = session.characterTags?.slice(0, 4) ?? []
  const voiceLabel =
    session.characterVoiceId && TAVERN_VOICE_OPTIONS.find((option) => option.value === session.characterVoiceId)?.label
  const hasBackground = Boolean(session.backgroundImage)
  const hasStanding = Boolean(session.standingImage)
  const memoryState = getTavernMemoryState(session)
  const openSettings = () => {
    setOpened(false)
    return onOpenSettings()
  }

  return (
    <Popover width={292} position="left-start" shadow="lg" radius="md" withArrow opened={opened} onChange={setOpened}>
      <Popover.Target>
        <Tooltip label="角色与场景">
          <ActionIcon
            className="v2chat-character-panel-trigger"
            variant="filled"
            color="dark"
            radius="xl"
            aria-label="角色与场景"
            onClick={() => setOpened((value) => !value)}
          >
            <IconUserCircle size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="v2chat-character-panel">
        <Stack gap="sm">
          <Flex align="center" justify="space-between" gap="sm">
            <div className="min-w-0">
              <Text fw={800} size="sm" lineClamp={1}>
                {session.name}
              </Text>
              <Text size="xs" opacity={0.64} lineClamp={1}>
                当前角色会话
              </Text>
            </div>
            <ActionIcon variant="light" color="chatbox-brand" radius="xl" onClick={openSettings} aria-label="编辑会话">
              <IconSettings size={16} />
            </ActionIcon>
          </Flex>

          {session.characterDescription ? (
            <Text size="xs" lineClamp={3} className="v2chat-character-panel__description">
              {session.characterDescription}
            </Text>
          ) : null}

          {tags.length > 0 ? (
            <Flex gap={6} wrap="wrap">
              {tags.map((tag) => (
                <span key={tag} className="v2chat-character-panel__tag">
                  {tag}
                </span>
              ))}
            </Flex>
          ) : null}

          <Divider />

          <Box className="v2chat-character-panel__memory">
            <Flex align="center" justify="space-between" gap="xs" mb={8}>
              <Flex align="center" gap={6} className="min-w-0">
                <span className="v2chat-character-panel__memory-icon">
                  <IconSparkles size={14} />
                </span>
                <Text size="xs" fw={800}>
                  剧情记忆
                </Text>
              </Flex>
              <span
                className={clsx(
                  'v2chat-character-panel__memory-badge',
                  memoryState.hasMemory && 'is-active',
                  memoryState.status === 'suggested' && 'is-suggested',
                  memoryState.status === 'stale' && 'is-stale'
                )}
              >
                {memoryState.badge}
              </span>
            </Flex>

            {memoryState.hasMemory ? (
              <Stack gap={6}>
                {memoryState.items.map((item) => (
                  <CharacterPanelMemoryItem key={item.label} {...item} />
                ))}
              </Stack>
            ) : (
              <Text size="xs" className="v2chat-character-panel__memory-empty">
                聊一段剧情后，可以整理关系、场景和伏笔，让角色后续回复更连贯。
              </Text>
            )}

            {memoryState.panelHint ? (
              <Text size="xs" mt={8} className="v2chat-character-panel__memory-suggestion">
                {memoryState.panelHint}
              </Text>
            ) : null}
          </Box>

          <Stack gap={8}>
            <CharacterPanelStatus
              icon={<IconVolume size={15} />}
              label="角色音色"
              value={voiceLabel || session.characterVoiceId || '跟随全局'}
              active={Boolean(session.characterVoiceId)}
            />
            <CharacterPanelStatus
              icon={<IconPhoto size={15} />}
              label="聊天背景"
              value={hasBackground ? '已绑定' : '未设置'}
              active={hasBackground}
            />
            <CharacterPanelStatus
              icon={<IconCards size={15} />}
              label="右侧立绘"
              value={hasStanding ? '已绑定' : '未设置'}
              active={hasStanding}
            />
          </Stack>

          <Flex gap="xs">
            <Button
              size="xs"
              variant="light"
              color="chatbox-brand"
              fullWidth
              onClick={() => {
                setOpened(false)
                onOpenMemory()
              }}
            >
              管理记忆
            </Button>
            <Button
              size="xs"
              variant="default"
              fullWidth
              onClick={() => {
                setOpened(false)
                onOpenLibrary()
              }}
            >
              角色库
            </Button>
          </Flex>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

function TavernMemorySignal({
  session,
  onOpenMemory,
}: {
  session: Session
  onOpenMemory: () => void
}) {
  const memoryState = getTavernMemoryState(session)
  if (session.type && session.type !== 'chat') {
    return null
  }

  return (
    <div className={clsx('v2chat-memory-signal', `is-${memoryState.status}`)}>
      <div className="v2chat-memory-signal__main">
        <span className="v2chat-memory-signal__icon">
          <IconSparkles size={14} />
        </span>
        <div className="min-w-0">
          <Text size="xs" fw={800} className="v2chat-memory-signal__title" lineClamp={1}>
            {memoryState.title}
          </Text>
          <Text size="xs" className="v2chat-memory-signal__detail" lineClamp={1}>
            {memoryState.detail}
          </Text>
        </div>
      </div>
      <Button size="compact-xs" variant="subtle" color="chatbox-brand" onClick={onOpenMemory}>
        {memoryState.actionLabel}
      </Button>
    </div>
  )
}

function TavernMemoryManagerModal({
  session,
  opened,
  onClose,
}: {
  session: Session
  opened: boolean
  onClose: () => void
}) {
  const [relationship, setRelationship] = useState('')
  const [currentScene, setCurrentScene] = useState('')
  const [memory, setMemory] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const roleplayMessageCount = useMemo(() => getRoleplayMessageCount(session), [session])
  const canSummarize = roleplayMessageCount >= 2

  useEffect(() => {
    if (!opened) return
    setRelationship(session.characterRelationship || '')
    setCurrentScene(session.currentScene || '')
    setMemory(session.characterMemory || '')
  }, [opened, session.id, session.characterRelationship, session.currentScene, session.characterMemory])

  const saveMemory = useCallback(
    async (next?: { relationship?: string; currentScene?: string; memory?: string }) => {
      const nextRelationship = next?.relationship ?? relationship
      const nextScene = next?.currentScene ?? currentScene
      const nextMemory = next?.memory ?? memory
      const hasAnyMemory = Boolean(nextRelationship.trim() || nextScene.trim() || nextMemory.trim())
      setIsSaving(true)
      try {
        await updateSessionStore(session.id, {
          characterRelationship: nextRelationship.trim(),
          currentScene: nextScene.trim(),
          characterMemory: nextMemory.trim(),
          characterMemoryUpdatedAt: hasAnyMemory ? Date.now() : undefined,
        })
        toastActions.add(hasAnyMemory ? '角色记忆已保存' : '角色记忆已清空')
        return true
      } catch (error) {
        toastActions.add(error instanceof Error ? error.message : '角色记忆保存失败')
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [currentScene, memory, relationship, session.id]
  )

  const summarizeAndSave = useCallback(async () => {
    if (!canSummarize) {
      toastActions.add('至少需要 2 条用户/角色消息才能整理记忆')
      return
    }

    setIsSummarizing(true)
    try {
      const summary = await summarizeTavernMemoryFromSession(session, {
        inferCharacter: false,
        existingCharacterName: session.name,
      })
      const next = {
        relationship: summary.relationship || relationship,
        currentScene: summary.currentScene || currentScene,
        memory: summary.memory || memory,
      }
      setRelationship(next.relationship)
      setCurrentScene(next.currentScene)
      setMemory(next.memory)
      await saveMemory(next)
      toastActions.add('已根据当前聊天重新整理剧情记忆')
    } catch (error) {
      toastActions.add(error instanceof Error ? error.message : '剧情记忆整理失败')
    } finally {
      setIsSummarizing(false)
    }
  }, [canSummarize, currentScene, memory, relationship, saveMemory, session])

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="角色记忆管理"
      centered
      size="lg"
      className="v2chat-memory-manager"
    >
      <Stack gap="md">
        <Box className="v2chat-memory-manager__summary">
          <Flex align="center" justify="space-between" gap="sm">
            <div className="min-w-0">
              <Text fw={900} size="sm" lineClamp={1}>
                {session.name}
              </Text>
              <Text size="xs" className="v2chat-memory-manager__muted" lineClamp={1}>
                这些内容会作为隐藏上下文带入角色扮演，不会直接显示给模型当作普通消息。
              </Text>
            </div>
            <span className="v2chat-memory-manager__badge">{roleplayMessageCount} 条剧情消息</span>
          </Flex>
          <Text size="xs" mt={8} className="v2chat-memory-manager__muted">
            {session.characterMemoryUpdatedAt
              ? `上次整理：${formatMemoryUpdatedAt(session.characterMemoryUpdatedAt)}`
              : '还没有保存过剧情记忆'}
          </Text>
        </Box>

        <Textarea
          label="关系状态"
          description="称呼、亲密度、约定、边界、当前情绪"
          autosize
          minRows={3}
          maxRows={7}
          value={relationship}
          onChange={(event) => setRelationship(event.currentTarget.value)}
          placeholder="例如：用户是角色信任的旅伴，二人刚经历过一次冲突后的和解。"
        />
        <Textarea
          label="当前场景"
          description="地点、时间、氛围、眼前正在发生的事"
          autosize
          minRows={3}
          maxRows={7}
          value={currentScene}
          onChange={(event) => setCurrentScene(event.currentTarget.value)}
          placeholder="例如：雨夜的酒馆二楼，壁炉快熄灭，角色正在等待用户解释那封信。"
        />
        <Textarea
          label="长期记忆"
          description="重要事件、伏笔、偏好、承诺、未解决线索"
          autosize
          minRows={5}
          maxRows={10}
          value={memory}
          onChange={(event) => setMemory(event.currentTarget.value)}
          placeholder="例如：用户不喜欢被强行推进剧情；角色曾承诺保护一枚旧钥匙；城北钟楼仍有未解线索。"
        />

        <Group justify="space-between" gap="xs" className="v2chat-memory-manager__footer">
          <Button
            variant="light"
            color="chatbox-brand"
            leftSection={<IconRefresh size={16} />}
            loading={isSummarizing}
            disabled={!canSummarize || isSaving}
            onClick={summarizeAndSave}
          >
            AI 重新整理
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              关闭
            </Button>
            <Button
              color="chatbox-brand"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={isSaving}
              disabled={isSummarizing}
              onClick={async () => {
                const saved = await saveMemory()
                if (saved) onClose()
              }}
            >
              保存记忆
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}

function CharacterPanelMemoryItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value?: string
}) {
  return (
    <Flex align="flex-start" gap={7} className={clsx('v2chat-character-panel__memory-item', !value && 'is-empty')}>
      <span className="v2chat-character-panel__memory-item-icon">{icon}</span>
      <div className="min-w-0 flex-1">
        <Text size="xs" fw={800} className="v2chat-character-panel__memory-label">
          {label}
        </Text>
        <Text size="xs" lineClamp={2} className="v2chat-character-panel__memory-value">
          {value || '待整理'}
        </Text>
      </div>
    </Flex>
  )
}

function CharacterPanelStatus({
  icon,
  label,
  value,
  active,
}: {
  icon: React.ReactNode
  label: string
  value: string
  active: boolean
}) {
  return (
    <Flex align="center" gap="xs" className="v2chat-character-panel__status">
      <span className={clsx('v2chat-character-panel__status-icon', active && 'is-active')}>{icon}</span>
      <Text size="xs" fw={700} className="min-w-0 flex-1">
        {label}
      </Text>
      <Text size="xs" opacity={0.68} lineClamp={1} className="min-w-0 max-w-[130px]">
        {value}
      </Text>
    </Flex>
  )
}

type TavernMemoryStatus = 'active' | 'empty' | 'suggested' | 'stale'

function getTavernMemoryState(session: Session) {
  const items = [
    {
      icon: <IconMapPin size={14} />,
      label: '当前场景',
      value: compactPanelText(session.currentScene),
    },
    {
      icon: <IconUsers size={14} />,
      label: '关系',
      value: compactPanelText(session.characterRelationship),
    },
    {
      icon: <IconNotes size={14} />,
      label: '长期记忆',
      value: compactPanelText(session.characterMemory),
    },
  ]
  const rememberedCount = items.filter((item) => item.value).length
  const hasMemory = rememberedCount > 0
  const roleplayMessages = (session.messages || []).filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  )
  const messagesAfterMemoryUpdate = session.characterMemoryUpdatedAt
    ? roleplayMessages.filter((message) => (message.timestamp || 0) > (session.characterMemoryUpdatedAt || 0)).length
    : 0
  const shouldSuggestMemory = !hasMemory && roleplayMessages.length >= 8
  const shouldRefreshMemory = hasMemory && messagesAfterMemoryUpdate >= 10

  if (shouldRefreshMemory) {
    return {
      actionLabel: '更新',
      badge: '建议更新',
      detail: `上次整理后又聊了 ${messagesAfterMemoryUpdate} 条，建议更新关系和当前场景。`,
      hasMemory,
      items,
      panelHint: `上次整理后又聊了 ${messagesAfterMemoryUpdate} 条，可以更新剧情记忆。`,
      status: 'stale' as TavernMemoryStatus,
      title: '角色记忆已带入，建议更新',
    }
  }

  if (hasMemory) {
    return {
      actionLabel: '查看',
      badge: '已接入',
      detail: '关系、当前场景和长期记忆会作为隐藏上下文发送给模型。',
      hasMemory,
      items,
      panelHint: '发送消息时会自动带入这些记忆，模型不会直接看到这条提示。',
      status: 'active' as TavernMemoryStatus,
      title: '本轮已带入角色记忆',
    }
  }

  if (shouldSuggestMemory) {
    return {
      actionLabel: '整理',
      badge: '可整理',
      detail: '最近对话已经足够整理一次剧情记忆。',
      hasMemory,
      items,
      panelHint: '最近对话已经足够整理一次剧情记忆。',
      status: 'suggested' as TavernMemoryStatus,
      title: '可以整理剧情记忆',
    }
  }

  return {
    actionLabel: '设置',
    badge: '未记录',
    detail: '继续聊几轮后，可以把关系、场景和伏笔整理成长期记忆。',
    hasMemory,
    items,
    panelHint: '',
    status: 'empty' as TavernMemoryStatus,
    title: '角色记忆未记录',
  }
}

function compactPanelText(value?: string) {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 96 ? `${text.slice(0, 96)}...` : text
}

function getRoleplayMessageCount(session: Session) {
  return (session.messages || []).filter((message) => message.role === 'user' || message.role === 'assistant').length
}

function formatMemoryUpdatedAt(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ImageSourceView({ source, className = 'v2chat-character-stage__image' }: { source: ImageSource; className?: string }) {
  if (source.type === 'storage-key') {
    return <ImageInStorage storageKey={source.storageKey} className={className} />
  }

  return <img src={source.url} alt="" className={className} />
}
