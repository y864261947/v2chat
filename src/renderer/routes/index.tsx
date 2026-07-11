import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Drawer,
  FileButton,
  Flex,
  Group,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { createMessage, type ImageSource, type Session } from '@shared/types'
import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconDownload,
  IconEdit,
  IconFileImport,
  IconHeart,
  IconHeartFilled,
  IconInfoCircle,
  IconMessageCircle2,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { handleImageInputAndSave, ImageInStorage } from '@/components/Image'
import Page from '@/components/layout/Page'
import { navigateToSettings } from '@/modals/Settings'
import {
  createElevenLabsVoiceFromPreview,
  designElevenLabsVoice,
  type ElevenLabsVoicePreview,
} from '@/packages/elevenlabs-voices'
import {
  buildCharacterSystemPrompt,
  exportAllTavernCharacters,
  exportSillyTavernCharacter,
  exportTavernCharacter,
  TAVERN_VOICE_OPTIONS,
  type TavernCharacter,
  toggleTavernCharacterFavorite,
  upsertTavernCharacter,
  useTavernCharacters,
} from '@/packages/tavernCharacters'
import { isTavernColdStart } from '@/packages/tavernHome'
import { analyzeTavernImportFiles, type TavernImportBundle, type TavernImportChat } from '@/packages/tavernImport'
import { summarizeTavernMemoryFromSession, type TavernMemorySummary } from '@/packages/tavernMemory'
import { createRoleplaySession } from '@/packages/tavernSessions'
import tavernIconUrl from '@/static/tavern/icon.png'
import tavernSplashUrl from '@/static/tavern/splash.png'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import {
  createSession as createSessionStore,
  getSession,
  listAllSessionsMeta,
  updateSessionWithMessages,
  useSessionList,
} from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/session/crud'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import * as toastActions from '@/stores/toastActions'

const MAX_CHARACTER_IMAGE_SIZE = 8 * 1024 * 1024

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: zodValidator(
    z.object({
      copilotId: z.string().optional(),
      copilot: z.string().optional(),
      settings: z.string().optional(),
      action: z.enum(['new-character', 'characters']).optional(),
    })
  ),
})

function Index() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const characters = useTavernCharacters()
  const { sessionMetaList = [] } = useSessionList()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('最近')
  const [selectedCharacter, setSelectedCharacter] = useState<TavernCharacter | null>(null)
  const [editingCharacter, setEditingCharacter] = useState<TavernCharacter | null>(null)
  const [startChatAfterCharacterSave, setStartChatAfterCharacterSave] = useState(false)
  const [importBundle, setImportBundle] = useState<TavernImportBundle | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [summarizeImportedMemory, setSummarizeImportedMemory] = useState(true)
  const importInputRef = useRef<HTMLInputElement>(null)
  const showCharacterLibrary = search.action === 'characters'
  const isColdStart = isTavernColdStart(characters.length, sessionMetaList)

  const categoryTags = useMemo(
    () => Array.from(new Set(characters.flatMap((character) => character.tags))).slice(0, 12),
    [characters]
  )

  const filteredCharacters = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return characters
      .filter((character) => {
        const matchesKeyword =
          !keyword ||
          [character.name, character.subtitle, character.description, character.tags.join(' ')]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        const matchesTag =
          tag === '最近' || tag === '全部' || (tag === '收藏' ? character.favorite : character.tags.includes(tag))
        return matchesKeyword && matchesTag
      })
      .sort((a, b) =>
        tag === '最近'
          ? b.updatedAt - a.updatedAt
          : Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt
      )
  }, [characters, query, tag])

  const handleStartChat = async (character: TavernCharacter) => {
    try {
      await createRoleplaySession(character)
    } catch (error) {
      toastActions.add(error instanceof Error ? error.message : '无法创建角色对话')
    }
  }

  const openCharacterCreator = (startChat: boolean) => {
    setStartChatAfterCharacterSave(startChat)
    setEditingCharacter(createBlankCharacter())
  }

  useEffect(() => {
    if (search.action !== 'new-character') return
    setStartChatAfterCharacterSave(true)
    setEditingCharacter(createBlankCharacter())
    void navigate({
      to: '/',
      search: { action: undefined },
      replace: true,
    })
  }, [navigate, search.action])

  const handleImport = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      setIsImporting(true)
      const bundle = await analyzeTavernImportFiles(files)
      setImportBundle(bundle)
      if (!bundle.characters.length && !bundle.chats.length) {
        toastActions.add(bundle.errors[0] || '没有识别到可导入的资料')
      }
    } catch (error) {
      toastActions.add(error instanceof Error ? error.message : '资料导入解析失败')
    } finally {
      setIsImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const confirmImportBundle = async (bundle: TavernImportBundle) => {
    let characterCount = 0
    let chatCount = 0
    let memoryCount = 0
    let inferredCharacterCount = 0
    let memoryErrorCount = 0
    for (const character of bundle.characters) {
      upsertTavernCharacter(character)
      characterCount += 1
    }
    for (const chat of bundle.chats) {
      let linkedCharacter = findBestCharacterForImportedChat(chat, bundle.characters, characters)
      let session: Session = await createSessionFromImportedChat(chat, linkedCharacter)
      if (summarizeImportedMemory && chat.messages.length >= 2) {
        try {
          const summary = await summarizeTavernMemoryFromSession(session, {
            inferCharacter: !linkedCharacter,
            existingCharacterName: linkedCharacter?.name,
          })
          if (!linkedCharacter) {
            const inferredCharacter = createCharacterFromImportedMemorySummary(summary, chat)
            if (inferredCharacter) {
              upsertTavernCharacter(inferredCharacter)
              linkedCharacter = inferredCharacter
              inferredCharacterCount += 1
            }
          }
          session = await applyImportedMemorySummary(session, summary, linkedCharacter)
          memoryCount += 1
        } catch (error) {
          console.warn('[v2chat-import] failed to summarize imported memory', error)
          memoryErrorCount += 1
        }
      }
      if (chatCount === 0) {
        switchCurrentSession(session.id)
      }
      chatCount += 1
    }
    setImportBundle(null)
    toastActions.add(
      [
        `已导入 ${characterCount + inferredCharacterCount} 张角色卡、${chatCount} 段聊天记录`,
        memoryCount ? `整理了 ${memoryCount} 段剧情记忆` : '',
        memoryErrorCount ? `${memoryErrorCount} 段记忆整理失败，可稍后在会话里手动整理` : '',
      ]
        .filter(Boolean)
        .join('；')
    )
  }

  return (
    <Page
      title={
        <Text fw={900} size="md" className="v2chat-character-title">
          {showCharacterLibrary ? '角色管理' : 'V2Chat'}
        </Text>
      }
      right={
        showCharacterLibrary ? (
          <Menu position="bottom-end" shadow="md" width={230}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                size={34}
                radius="xl"
                loading={isImporting}
                className="v2chat-character-add"
                aria-label="添加角色或资料"
              >
                <ScalableIcon icon={IconPlus} size={21} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>添加内容</Menu.Label>
              <Menu.Item
                leftSection={<ScalableIcon icon={IconFileImport} size={17} />}
                onClick={() => importInputRef.current?.click()}
              >
                导入角色卡或聊天记录
              </Menu.Item>
              <Menu.Item
                leftSection={<ScalableIcon icon={IconPlus} size={17} />}
                onClick={() => openCharacterCreator(false)}
              >
                新建角色
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                leftSection={<ScalableIcon icon={IconDownload} size={17} />}
                onClick={() => void exportAllTavernCharacters()}
              >
                导出角色库
              </Menu.Item>
              <Menu.Item
                leftSection={<ScalableIcon icon={IconSettings} size={17} />}
                onClick={() => navigateToSettings('/v2api')}
              >
                V2API 设置
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : undefined
      }
      className={`v2chat-character-page ${showCharacterLibrary ? 'is-library' : 'is-idle'}`}
    >
      <div className="v2chat-character-home">
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.jsonl,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac,application/json,image/png,image/jpeg,image/webp,audio/*"
          multiple
          className="hidden"
          onChange={(event) => void handleImport(event.currentTarget.files)}
        />

        {isColdStart && !showCharacterLibrary && (
          <section className="v2chat-character-cold-start">
            <span className="v2chat-character-cold-start__icon" aria-hidden="true">
              <ScalableIcon icon={IconSparkles} size={26} />
            </span>
            <Text fw={900} size="lg">
              创建第一个角色
            </Text>
            <Text size="sm" className="v2chat-character-cold-start__copy">
              保存角色设定后会直接进入第一个独立对话窗口。
            </Text>
            <Button leftSection={<ScalableIcon icon={IconPlus} size={18} />} onClick={() => openCharacterCreator(true)}>
              新建角色
            </Button>
          </section>
        )}

        {!isColdStart && !showCharacterLibrary && <div className="v2chat-character-idle" aria-hidden="true" />}

        {showCharacterLibrary && (
          <section className="v2chat-character-library">
            <Flex align="end" justify="space-between" className="v2chat-character-section-heading">
              <div>
                <Text fw={850}>角色库</Text>
                <Text size="xs" c="dimmed">
                  {characters.length} 位角色
                </Text>
              </div>
              {!['最近', '全部', '收藏'].includes(tag) && (
                <Badge variant="light" color="gray">
                  {tag}
                </Badge>
              )}
            </Flex>

            <div className="v2chat-character-toolbar">
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索角色或设定"
                leftSection={<ScalableIcon icon={IconSearch} size={18} />}
                className="v2chat-character-search"
              />
              <Menu position="bottom-end" shadow="md" width={200}>
                <Menu.Target>
                  <ActionIcon
                    variant="default"
                    size={42}
                    radius="md"
                    className={
                      !['最近', '全部', '收藏'].includes(tag)
                        ? 'v2chat-character-filter is-active'
                        : 'v2chat-character-filter'
                    }
                    aria-label="筛选角色标签"
                  >
                    <ScalableIcon icon={IconAdjustmentsHorizontal} size={19} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>按标签筛选</Menu.Label>
                  {categoryTags.length ? (
                    categoryTags.map((item) => (
                      <Menu.Item
                        key={item}
                        leftSection={tag === item ? <ScalableIcon icon={IconCheck} size={15} /> : undefined}
                        onClick={() => setTag(item)}
                      >
                        {item}
                      </Menu.Item>
                    ))
                  ) : (
                    <Menu.Item disabled>暂无角色标签</Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </div>

            <div className="v2chat-character-tags" role="tablist" aria-label="角色范围">
              {['最近', '全部', '收藏'].map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={item === tag}
                  className={item === tag ? 'active' : ''}
                  onClick={() => setTag(item)}
                >
                  {item === '全部' ? '全部角色' : item}
                </button>
              ))}
            </div>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" className="v2chat-character-grid">
              {filteredCharacters.map((character) => (
                <CharacterCard
                  key={character.id}
                  character={character}
                  onStartChat={handleStartChat}
                  onPreview={() => setSelectedCharacter(character)}
                />
              ))}
            </SimpleGrid>
          </section>
        )}

        {showCharacterLibrary && !filteredCharacters.length && (
          <Stack align="center" justify="center" className="v2chat-character-empty">
            <Text fw={700}>没有找到角色</Text>
            <Text size="sm">换个关键词，或导入一张 SillyTavern 角色卡。</Text>
            <Button
              leftSection={<ScalableIcon icon={IconUpload} size={18} />}
              onClick={() => importInputRef.current?.click()}
            >
              导入角色卡或聊天记录
            </Button>
          </Stack>
        )}

        <ImportPreviewModal
          bundle={importBundle}
          opened={Boolean(importBundle)}
          summarizeMemory={summarizeImportedMemory}
          onSummarizeMemoryChange={setSummarizeImportedMemory}
          onClose={() => setImportBundle(null)}
          onConfirm={(bundle) => void confirmImportBundle(bundle)}
        />

        <CharacterPreviewDrawer
          character={selectedCharacter}
          opened={Boolean(selectedCharacter)}
          onClose={() => setSelectedCharacter(null)}
          onStartChat={(character) => void handleStartChat(character)}
          onEdit={(character) => {
            setSelectedCharacter(null)
            setStartChatAfterCharacterSave(false)
            setEditingCharacter(character)
          }}
        />

        <CharacterEditor
          character={editingCharacter}
          opened={Boolean(editingCharacter)}
          startChatAfterSave={startChatAfterCharacterSave}
          onClose={() => setEditingCharacter(null)}
          onSaved={(character) => {
            if (startChatAfterCharacterSave) {
              void handleStartChat(character)
            }
          }}
        />
      </div>
    </Page>
  )
}

function CharacterCard({
  character,
  onStartChat,
  onPreview,
}: {
  character: TavernCharacter
  onStartChat(character: TavernCharacter): void
  onPreview(): void
}) {
  const subtitle = cleanCharacterPreviewText(character.subtitle || character.scenario, 80) || '酒馆角色'
  const description = cleanCharacterPreviewText(character.description || character.scenario, 180) || '还没有角色描述。'

  return (
    <article
      className="v2chat-character-card"
      role="button"
      tabIndex={0}
      onClick={() => void onStartChat(character)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void onStartChat(character)
        }
      }}
    >
      <div className="v2chat-character-card__cover">
        {character.backgroundImage ? <ImageSourceView source={character.backgroundImage} /> : null}
        <div className="v2chat-character-card__shade" />
      </div>
      <div className="v2chat-character-card__body">
        <Flex gap="sm" align="center" justify="space-between">
          <Flex gap="sm" align="center" className="min-w-0">
            <Avatar size={56} radius={12} className="v2chat-character-card__avatar">
              {character.avatar ? <ImageSourceView source={character.avatar} /> : character.name.slice(0, 1)}
            </Avatar>
            <div className="min-w-0">
              <Text fw={800} size="lg" lineClamp={1}>
                {character.name}
              </Text>
              <Text size="sm" lineClamp={1} className="v2chat-character-card__subtitle">
                {subtitle}
              </Text>
            </div>
          </Flex>
          <Group gap={2} wrap="nowrap" className="v2chat-character-card__quick-actions">
            <ActionIcon
              variant="subtle"
              className="v2chat-character-card__favorite"
              aria-label={character.favorite ? '取消收藏角色' : '收藏角色'}
              onClick={(event) => {
                event.stopPropagation()
                toggleTavernCharacterFavorite(character.id)
              }}
            >
              <ScalableIcon icon={character.favorite ? IconHeartFilled : IconHeart} size={19} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              className="v2chat-character-card__details"
              aria-label="查看角色档案"
              onClick={(event) => {
                event.stopPropagation()
                onPreview()
              }}
            >
              <ScalableIcon icon={IconInfoCircle} size={19} />
            </ActionIcon>
          </Group>
        </Flex>
        <Text size="sm" lineClamp={3} className="v2chat-character-card__description">
          {description}
        </Text>
        <Group gap={6} className="v2chat-character-card__tags">
          {character.tags.slice(0, 4).map((item) => (
            <Badge key={item} variant="light">
              {item}
            </Badge>
          ))}
        </Group>
        <Group grow gap="xs" className="v2chat-character-card__actions">
          <Button
            leftSection={<ScalableIcon icon={IconMessageCircle2} size={18} />}
            onClick={(event) => {
              event.stopPropagation()
              void onStartChat(character)
            }}
          >
            开始聊天
          </Button>
          <Button
            variant="light"
            onClick={(event) => {
              event.stopPropagation()
              onPreview()
            }}
          >
            角色档案
          </Button>
        </Group>
      </div>
    </article>
  )
}

function cleanCharacterPreviewText(value?: string, maxLength = 160) {
  if (!value) return ''
  const withoutHtml = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|section|article|h\d|li|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\{\{(char|user)\}\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (withoutHtml.length <= maxLength) return withoutHtml
  return `${withoutHtml.slice(0, maxLength).trim()}...`
}

function CharacterPreviewDrawer({
  character,
  opened,
  onClose,
  onStartChat,
  onEdit,
}: {
  character: TavernCharacter | null
  opened: boolean
  onClose(): void
  onStartChat(character: TavernCharacter): void
  onEdit(character: TavernCharacter): void
}) {
  const title = cleanCharacterPreviewText(character?.subtitle || character?.scenario, 96) || '酒馆角色'
  const description = cleanCharacterPreviewText(character?.description, 900)
  const scenario = cleanCharacterPreviewText(character?.scenario, 520)
  const firstMessage = cleanCharacterPreviewText(character?.firstMessage, 520)
  const voiceLabel =
    character?.voiceId && TAVERN_VOICE_OPTIONS.find((item) => item.value === character.voiceId)?.label
      ? TAVERN_VOICE_OPTIONS.find((item) => item.value === character.voiceId)?.label
      : character?.voiceId
        ? '已绑定自定义音色'
        : '跟随全局音色'

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={character ? `${character.name} 的角色档案` : '角色档案'}
      classNames={{
        content: 'v2chat-character-preview',
        header: 'v2chat-character-preview__header',
        body: 'v2chat-character-preview__body',
      }}
    >
      {character && (
        <Stack gap="md">
          <Box className="v2chat-character-preview__cover">
            {character.backgroundImage ? <ImageSourceView source={character.backgroundImage} /> : null}
            <div className="v2chat-character-preview__cover-shade" />
            <div className="v2chat-character-preview__identity">
              <Avatar size={76} radius={16} className="v2chat-character-preview__avatar">
                {character.avatar ? <ImageSourceView source={character.avatar} /> : character.name.slice(0, 1)}
              </Avatar>
              <div className="min-w-0">
                <Text fw={900} size="xl" lineClamp={1}>
                  {character.name}
                </Text>
                <Text size="sm" lineClamp={2}>
                  {title}
                </Text>
              </div>
            </div>
          </Box>

          <Group gap={6}>
            {character.tags.slice(0, 8).map((tag) => (
              <Badge key={tag} variant="light">
                {tag}
              </Badge>
            ))}
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <CharacterPreviewSignal label="头像" active={Boolean(character.avatar)} />
            <CharacterPreviewSignal label="背景" active={Boolean(character.backgroundImage)} />
            <CharacterPreviewSignal label="立绘" active={Boolean(character.standingImage)} />
            <CharacterPreviewSignal label="音色" active={Boolean(character.voiceId)} />
          </SimpleGrid>

          <CharacterPreviewSection title="角色简介" empty="还没有角色描述。">
            {description}
          </CharacterPreviewSection>
          <CharacterPreviewSection title="初始场景" empty="还没有设置初始场景。">
            {scenario}
          </CharacterPreviewSection>
          <CharacterPreviewSection title="开场白" empty="还没有设置开场白。">
            {firstMessage}
          </CharacterPreviewSection>

          <Box className="v2chat-character-preview__media-row">
            <div>
              <Text size="xs" fw={900}>
                角色音色
              </Text>
              <Text size="sm">{voiceLabel}</Text>
            </div>
            <div>
              <Text size="xs" fw={900}>
                右侧立绘
              </Text>
              <Text size="sm">{character.standingImage ? '聊天页可显示角色舞台' : '尚未绑定立绘'}</Text>
            </div>
          </Box>

          <Group grow className="v2chat-character-preview__actions">
            <Button
              leftSection={<ScalableIcon icon={IconMessageCircle2} size={18} />}
              onClick={() => onStartChat(character)}
            >
              开始聊天
            </Button>
            <Button
              variant="light"
              leftSection={<ScalableIcon icon={IconEdit} size={18} />}
              onClick={() => onEdit(character)}
            >
              编辑角色
            </Button>
          </Group>
          <Group grow gap="xs">
            <Button
              variant="subtle"
              leftSection={<ScalableIcon icon={IconDownload} size={18} />}
              onClick={() => void exportTavernCharacter(character)}
            >
              导出 V2Chat
            </Button>
            <Button
              variant="subtle"
              leftSection={<ScalableIcon icon={IconInfoCircle} size={18} />}
              onClick={() => void exportSillyTavernCharacter(character)}
            >
              导出 ST
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  )
}

function CharacterPreviewSignal({ label, active }: { label: string; active: boolean }) {
  return (
    <Box className={active ? 'v2chat-character-preview__signal is-active' : 'v2chat-character-preview__signal'}>
      <span />
      <Text size="xs" fw={800}>
        {label}
      </Text>
    </Box>
  )
}

function CharacterPreviewSection({ title, empty, children }: { title: string; empty: string; children?: string }) {
  return (
    <Box className="v2chat-character-preview__section">
      <Text size="xs" fw={900}>
        {title}
      </Text>
      <Text size="sm" className={!children ? 'is-empty' : ''}>
        {children || empty}
      </Text>
    </Box>
  )
}

function ImportPreviewModal({
  bundle,
  opened,
  summarizeMemory,
  onSummarizeMemoryChange,
  onClose,
  onConfirm,
}: {
  bundle: TavernImportBundle | null
  opened: boolean
  summarizeMemory: boolean
  onSummarizeMemoryChange(value: boolean): void
  onClose(): void
  onConfirm(bundle: TavernImportBundle): void
}) {
  const canImport = Boolean(bundle && (bundle.characters.length > 0 || bundle.chats.length > 0))
  const hasChats = Boolean(bundle?.chats.length)

  return (
    <Modal opened={opened} onClose={onClose} title="导入资料预览" centered size="xl">
      {bundle && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <ImportStatCard
              label="角色卡"
              value={bundle.characters.length}
              description="SillyTavern / V2Chat / PNG 角色卡"
            />
            <ImportStatCard label="聊天记录" value={bundle.chats.length} description="JSON、Markdown、TXT、媒体附件" />
            <ImportStatCard
              label="未识别"
              value={bundle.errors.length}
              description="格式错误或暂不支持的文件"
              tone="warning"
            />
          </SimpleGrid>

          {bundle.characters.length > 0 && (
            <Stack gap="xs">
              <Text fw={800}>将导入角色</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {bundle.characters.slice(0, 6).map((character) => (
                  <Flex key={character.id} gap="sm" align="center" className="v2chat-import-preview-card">
                    <Avatar size={44} radius={10}>
                      {character.avatar ? <ImageSourceView source={character.avatar} /> : character.name.slice(0, 1)}
                    </Avatar>
                    <div className="min-w-0">
                      <Text fw={800} lineClamp={1}>
                        {character.name}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {cleanCharacterPreviewText(character.description || character.scenario, 120) ||
                          '未填写角色描述'}
                      </Text>
                    </div>
                  </Flex>
                ))}
              </SimpleGrid>
              {bundle.characters.length > 6 && (
                <Text size="xs" c="dimmed">
                  还有 {bundle.characters.length - 6} 张角色卡会一起导入。
                </Text>
              )}
            </Stack>
          )}

          {bundle.chats.length > 0 && (
            <Stack gap="xs">
              <Text fw={800}>将导入聊天记录</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {bundle.chats.slice(0, 6).map((chat) => (
                  <Box key={chat.id} className="v2chat-import-preview-card">
                    <Text fw={800} lineClamp={1}>
                      {chat.title}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {chat.messages.length} 条消息
                      {chat.participants.length ? ` · ${chat.participants.join(' / ')}` : ''}
                    </Text>
                    <Text size="xs" mt={4} lineClamp={2}>
                      {chat.messages[0]?.contentParts
                        .map((part) =>
                          part.type === 'text'
                            ? part.text
                            : part.type === 'audio'
                              ? '[语音]'
                              : part.type === 'image'
                                ? '[图片]'
                                : ''
                        )
                        .join(' ')
                        .trim() || '媒体消息'}
                    </Text>
                  </Box>
                ))}
              </SimpleGrid>
              {bundle.chats.length > 6 && (
                <Text size="xs" c="dimmed">
                  还有 {bundle.chats.length - 6} 段聊天记录会一起导入。
                </Text>
              )}
            </Stack>
          )}

          {hasChats && (
            <Flex className="v2chat-import-memory-option" align="center" justify="space-between" gap="md">
              <Flex gap="sm" align="center" className="min-w-0">
                <span className="v2chat-import-memory-option__icon">
                  <ScalableIcon icon={IconSparkles} size={18} />
                </span>
                <div className="min-w-0">
                  <Text fw={800} size="sm">
                    导入后整理剧情记忆
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    自动提炼关系、当前场景和长期记忆；没有角色卡时会尝试生成一个可编辑角色草稿。
                  </Text>
                </div>
              </Flex>
              <Switch
                checked={summarizeMemory}
                onChange={(event) => onSummarizeMemoryChange(event.currentTarget.checked)}
              />
            </Flex>
          )}

          {bundle.errors.length > 0 && (
            <Box className="v2chat-import-errors">
              <Text fw={800} size="sm">
                未识别内容
              </Text>
              {bundle.errors.slice(0, 4).map((error) => (
                <Text key={error} size="xs" c="dimmed">
                  {error}
                </Text>
              ))}
            </Box>
          )}

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              导入后会保留消息顺序和时间；JSON/base64 中的图片、音频会保存为本地消息附件。
            </Text>
            <Group>
              <Button variant="light" onClick={onClose}>
                取消
              </Button>
              <Button disabled={!canImport} onClick={() => bundle && onConfirm(bundle)}>
                确认导入
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

function ImportStatCard({
  label,
  value,
  description,
  tone,
}: {
  label: string
  value: number
  description: string
  tone?: 'warning'
}) {
  return (
    <Box className={tone === 'warning' ? 'v2chat-import-stat is-warning' : 'v2chat-import-stat'}>
      <Text size="xs" fw={800}>
        {label}
      </Text>
      <Text fw={900} size="xl">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
    </Box>
  )
}

function CharacterEditor({
  character,
  opened,
  startChatAfterSave,
  onClose,
  onSaved,
}: {
  character: TavernCharacter | null
  opened: boolean
  startChatAfterSave: boolean
  onClose(): void
  onSaved?(character: TavernCharacter): void | Promise<void>
}) {
  const isSmallScreen = useMediaQuery('(max-width: 640px)')
  const [draft, setDraft] = useState<TavernCharacter | null>(character)
  const [voicePreviews, setVoicePreviews] = useState<ElevenLabsVoicePreview[]>([])
  const [voicePreviewText, setVoicePreviewText] = useState('')
  const [designingVoice, setDesigningVoice] = useState(false)
  const [savingVoiceId, setSavingVoiceId] = useState<string | null>(null)
  const [syncExistingSessions, setSyncExistingSessions] = useState(false)

  useEffect(() => {
    setDraft(character)
    setVoicePreviews([])
    setVoicePreviewText('')
    setSyncExistingSessions(false)
  }, [character])

  const generateVoicePreviews = async () => {
    if (!draft) return
    const voiceDescription = (draft.voiceDescription || '').trim()
    if (voiceDescription.length < 20) {
      toastActions.add(`音色描述至少需要 20 个字符，当前 ${voiceDescription.length} 个字符`)
      return
    }
    try {
      setDesigningVoice(true)
      const result = await designElevenLabsVoice({
        voiceDescription,
      })
      setVoicePreviews(result.previews)
      setVoicePreviewText(result.text)
      toastActions.add(result.previews.length ? '已生成音色试听' : '没有生成可用试听音色')
    } catch (error) {
      toastActions.add(error instanceof Error ? error.message : '音色生成失败')
    } finally {
      setDesigningVoice(false)
    }
  }

  const bindGeneratedVoice = async (preview: ElevenLabsVoicePreview) => {
    if (!draft) return
    try {
      setSavingVoiceId(preview.generatedVoiceId)
      const created = await createElevenLabsVoiceFromPreview({
        voiceName: `${draft.name || 'V2Chat 角色'} Voice`,
        voiceDescription: draft.voiceDescription || '',
        generatedVoiceId: preview.generatedVoiceId,
        playedNotSelectedVoiceIds: voicePreviews
          .map((item) => item.generatedVoiceId)
          .filter((id) => id !== preview.generatedVoiceId),
      })
      setDraft({ ...draft, voiceId: created.voice_id })
      toastActions.add('已创建并绑定角色音色，保存角色后生效')
    } catch (error) {
      toastActions.add(error instanceof Error ? error.message : '绑定音色失败')
    } finally {
      setSavingVoiceId(null)
    }
  }

  const save = async () => {
    if (!draft?.name.trim()) {
      toastActions.add('角色名称不能为空')
      return
    }
    if (startChatAfterSave && !draft.description.trim()) {
      toastActions.add('请填写角色核心设定')
      return
    }
    const savedCharacter = { ...draft, tags: draft.tags.map((item) => item.trim()).filter(Boolean) }
    upsertTavernCharacter(savedCharacter)
    if (syncExistingSessions) {
      const syncedCount = await syncCharacterToExistingSessions(savedCharacter)
      if (syncedCount > 0) {
        toastActions.add(`已同步 ${syncedCount} 个角色会话`)
      }
    }
    onClose()
    await onSaved?.(savedCharacter)
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={startChatAfterSave ? '创建角色' : '角色档案'}
      centered
      size="xl"
      fullScreen={isSmallScreen}
      classNames={{
        content: 'v2chat-character-editor-modal',
        header: 'v2chat-character-editor-modal__header',
        title: 'v2chat-character-editor-modal__title',
        body: 'v2chat-character-editor-modal__body',
      }}
    >
      {draft && (
        <Stack gap="md" className="v2chat-character-editor">
          <Box className="v2chat-character-editor__dossier">
            {draft.backgroundImage ? <ImageSourceView source={draft.backgroundImage} /> : null}
            <div className="v2chat-character-editor__dossier-shade" />
            <Group align="flex-end" gap="sm" wrap="nowrap" className="v2chat-character-editor__identity">
              <Avatar size={72} radius={16} className="v2chat-character-editor__avatar">
                {draft.avatar ? <ImageSourceView source={draft.avatar} /> : draft.name.slice(0, 1)}
              </Avatar>
              <div className="min-w-0 flex-1">
                <Text className="v2chat-character-editor__eyebrow">角色档案</Text>
                <Text fw={900} size="xl" lineClamp={1}>
                  {draft.name || '未命名角色'}
                </Text>
                <Text size="sm" lineClamp={2} className="v2chat-character-editor__muted">
                  {draft.subtitle || draft.scenario || '整理角色身份、舞台资源和专属音色。'}
                </Text>
              </div>
            </Group>
          </Box>

          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" className="v2chat-character-editor__signals">
            <CharacterEditorSignal label="头像" detail="聊天头像" active={Boolean(draft.avatar)} />
            <CharacterEditorSignal label="背景" detail="聊天氛围" active={Boolean(draft.backgroundImage)} />
            <CharacterEditorSignal label="立绘" detail="沉浸舞台" active={Boolean(draft.standingImage)} />
            <CharacterEditorSignal label="音色" detail="语音回复" active={Boolean(draft.voiceId)} />
          </SimpleGrid>

          <CharacterEditorSection title="身份信息" description="角色在角色库和聊天页里展示的基础信息。">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                label="角色名称"
                required
                placeholder="例如：酒馆老板娘"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
              <TextInput
                label="一句话介绍"
                placeholder="一句话说明角色身份"
                value={draft.subtitle || ''}
                onChange={(event) => setDraft({ ...draft, subtitle: event.currentTarget.value })}
              />
            </SimpleGrid>
            <TextInput
              label="标签"
              description="用逗号分隔，例如：酒馆、剧情、长聊"
              value={draft.tags.join(', ')}
              onChange={(event) => setDraft({ ...draft, tags: event.currentTarget.value.split(/[,，]/) })}
            />
          </CharacterEditorSection>

          <CharacterEditorSection title="外观资源" description="头像、背景、立绘会同步到角色卡片、聊天背景和右侧舞台。">
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <CharacterImageField
                label="头像"
                description="角色卡片和聊天头像"
                source={draft.avatar}
                placeholder={draft.name.slice(0, 1)}
                category={`tavern-avatar:${draft.id}`}
                onChange={(source) => setDraft({ ...draft, avatar: source })}
              />
              <CharacterImageField
                label="背景"
                description="聊天背景和角色卡封面"
                source={draft.backgroundImage}
                category={`tavern-background:${draft.id}`}
                wide
                onChange={(source) => setDraft({ ...draft, backgroundImage: source })}
              />
              <CharacterImageField
                label="立绘"
                description="沉浸模式右侧角色图"
                source={draft.standingImage}
                category={`tavern-standing:${draft.id}`}
                contain
                onChange={(source) => setDraft({ ...draft, standingImage: source })}
              />
            </SimpleGrid>
          </CharacterEditorSection>

          <CharacterEditorSection title="角色本体" description="这些内容只定义 AI 扮演的角色，不代表模型本身或玩家。">
            <Textarea
              label="核心设定"
              required={startChatAfterSave}
              placeholder="角色是谁、经历过什么、重视什么，以及绝不能违背的设定。"
              autosize
              minRows={4}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
            />
            <Textarea
              label="性格与说话方式"
              placeholder="性格、口癖、情绪表达和行为习惯。"
              autosize
              minRows={3}
              value={draft.personality || ''}
              onChange={(event) => setDraft({ ...draft, personality: event.currentTarget.value })}
            />
          </CharacterEditorSection>

          <CharacterEditorSection title="玩家与故事" description="明确玩家是谁、故事发生在哪里，避免 AI 同时扮演双方。">
            <Textarea
              label="玩家身份（可选）"
              placeholder="例如：你是第一次来到酒馆的旅人。留空时，玩家就是用户本人。"
              autosize
              minRows={3}
              value={draft.userPersona || ''}
              onChange={(event) => setDraft({ ...draft, userPersona: event.currentTarget.value })}
            />
            <Textarea
              label="世界观（可选）"
              placeholder="时代、地点、规则、阵营和不可违背的世界设定。"
              autosize
              minRows={3}
              value={draft.worldSetting || ''}
              onChange={(event) => setDraft({ ...draft, worldSetting: event.currentTarget.value })}
            />
            <Textarea
              label="初始场景"
              placeholder="故事开始时的时间、地点和正在发生的事情。"
              autosize
              minRows={3}
              value={draft.scenario || ''}
              onChange={(event) => setDraft({ ...draft, scenario: event.currentTarget.value })}
            />
            <Textarea
              label="角色开场白"
              placeholder="保存角色后，聊天里首先出现的角色消息。"
              autosize
              minRows={2}
              value={draft.firstMessage || ''}
              onChange={(event) => setDraft({ ...draft, firstMessage: event.currentTarget.value })}
            />
          </CharacterEditorSection>

          <CharacterEditorSection title="回复规则" description="控制角色如何组织回答，不影响模型选择。">
            <Textarea
              label="输出风格（可选）"
              placeholder="例如：每次 2-4 段，以对话为主，动作放在括号内，不替玩家做决定。"
              autosize
              minRows={3}
              value={draft.outputStyle || ''}
              onChange={(event) => setDraft({ ...draft, outputStyle: event.currentTarget.value })}
            />
            <Textarea
              label="样例对话（可选）"
              description="样例比抽象描述更容易稳定角色语气。"
              placeholder={'{{user}}: 今晚还有空位吗？\n{{char}}: 有。靠窗那桌一直在等你。'}
              autosize
              minRows={4}
              value={draft.exampleDialog || ''}
              onChange={(event) => setDraft({ ...draft, exampleDialog: event.currentTarget.value })}
            />
          </CharacterEditorSection>

          <CharacterEditorSection
            title="语音能力"
            description="角色语音条会优先使用这里绑定的音色；不选则跟随全局设置。"
          >
            <Select
              label="角色音色"
              placeholder="跟随全局设置"
              clearable
              searchable
              data={[
                ...(draft.voiceId && !TAVERN_VOICE_OPTIONS.some((item) => item.value === draft.voiceId)
                  ? [{ value: draft.voiceId, label: `自定义音色 (${draft.voiceId})` }]
                  : []),
                ...TAVERN_VOICE_OPTIONS,
              ]}
              value={draft.voiceId || null}
              onChange={(value) => setDraft({ ...draft, voiceId: value || undefined })}
            />
            <Textarea
              label="想要的音色描述"
              description="例如：温柔、低声、略带疲惫的年轻女声，适合深夜酒馆角色扮演。"
              minRows={3}
              autosize
              value={draft.voiceDescription || ''}
              onChange={(event) => setDraft({ ...draft, voiceDescription: event.currentTarget.value })}
            />
            <Group justify="space-between" align="center" className="v2chat-character-editor__voice-actions">
              <Text size="xs" className="v2chat-character-editor__muted">
                语音服务会根据描述生成试听音色。至少 20 个字符，当前 {(draft.voiceDescription || '').trim().length} 个。
              </Text>
              <Button variant="light" loading={designingVoice} onClick={() => void generateVoicePreviews()}>
                生成试听音色
              </Button>
            </Group>
            {voicePreviewText && (
              <Text size="xs" className="v2chat-character-editor__muted">
                试听文本：{voicePreviewText}
              </Text>
            )}
            {voicePreviews.length > 0 && (
              <Stack gap="xs" className="v2chat-character-editor__voice-list">
                {voicePreviews.map((preview, index) => (
                  <Group key={preview.generatedVoiceId} gap="sm" align="center" wrap="nowrap">
                    <Text size="sm" fw={700} w={54}>
                      试听 {index + 1}
                    </Text>
                    <audio
                      controls
                      src={`data:${preview.mediaType};base64,${preview.audioBase64}`}
                      className="min-w-0 flex-1"
                    />
                    <Button
                      size="xs"
                      loading={savingVoiceId === preview.generatedVoiceId}
                      onClick={() => void bindGeneratedVoice(preview)}
                    >
                      绑定
                    </Button>
                  </Group>
                ))}
              </Stack>
            )}
          </CharacterEditorSection>

          {!startChatAfterSave && (
            <CharacterEditorSection title="同步与导出" description="保存角色后，可选择同步到已经创建的角色会话。">
              <Switch
                checked={syncExistingSessions}
                onChange={(event) => setSyncExistingSessions(event.currentTarget.checked)}
                label="保存后同步到已有角色会话"
                description="默认关闭，避免覆盖各窗口已经形成的独立设定、记忆和音色。"
              />
            </CharacterEditorSection>
          )}

          <Group
            justify={startChatAfterSave ? 'flex-end' : 'space-between'}
            className="v2chat-character-editor__footer"
          >
            {!startChatAfterSave && (
              <Group gap="xs" className="v2chat-character-editor__export-actions">
                <Button variant="subtle" onClick={() => void exportTavernCharacter(draft)}>
                  导出 V2Chat
                </Button>
                <Button variant="light" onClick={() => void exportSillyTavernCharacter(draft)}>
                  导出 SillyTavern
                </Button>
              </Group>
            )}
            <Group className="v2chat-character-editor__save-actions">
              <Button variant="light" onClick={onClose}>
                取消
              </Button>
              <Button onClick={() => void save()}>{startChatAfterSave ? '保存并开始聊天' : '保存角色'}</Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}

function CharacterEditorSignal({ label, detail, active }: { label: string; detail: string; active: boolean }) {
  return (
    <Box className={active ? 'v2chat-character-editor__signal is-active' : 'v2chat-character-editor__signal'}>
      <span />
      <div className="min-w-0">
        <Text size="xs" fw={900}>
          {label}
        </Text>
        <Text size="xs" lineClamp={1}>
          {active ? '已绑定' : detail}
        </Text>
      </div>
    </Box>
  )
}

function CharacterEditorSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Box className="v2chat-character-editor__section">
      <Group justify="space-between" align="flex-start" gap="sm" mb="sm">
        <div>
          <Text fw={900} size="sm">
            {title}
          </Text>
          <Text size="xs" className="v2chat-character-editor__muted">
            {description}
          </Text>
        </div>
      </Group>
      <Stack gap="sm">{children}</Stack>
    </Box>
  )
}

function findBestCharacterForImportedChat(
  chat: TavernImportChat,
  importedCharacters: TavernCharacter[],
  existingCharacters: TavernCharacter[]
) {
  const candidates = [...importedCharacters, ...existingCharacters]
  const haystack = [chat.title, chat.sourceName, ...chat.participants].join(' ').toLowerCase()
  return candidates.find((character) => haystack.includes(character.name.toLowerCase()))
}

function createCharacterFromImportedMemorySummary(
  summary: TavernMemorySummary,
  chat: TavernImportChat
): TavernCharacter | null {
  const name = summary.characterName?.trim()
  if (!name) return null
  const time = Date.now()
  return {
    id: uuidv4(),
    name,
    subtitle: `从 ${chat.title} 导入`,
    description: summary.characterDescription || summary.memory || '',
    personality: summary.characterPersonality || undefined,
    scenario: summary.currentScene || undefined,
    firstMessage: '',
    exampleDialog: '',
    tags: summary.tags?.length ? summary.tags : ['导入', '智能体'],
    favorite: false,
    voiceId: undefined,
    voiceDescription: '',
    avatar: { type: 'url', url: tavernIconUrl },
    backgroundImage: { type: 'url', url: tavernSplashUrl },
    standingImage: { type: 'url', url: tavernIconUrl },
    createdAt: time,
    updatedAt: time,
  }
}

function applyImportedMemorySummary(session: Session, summary: TavernMemorySummary, character?: TavernCharacter) {
  const systemPrompt = character
    ? buildCharacterSystemPrompt(character, {
        relationship: summary.relationship,
        memory: summary.memory,
        currentScene: summary.currentScene,
      })
    : ''
  const messages = character ? upsertSystemMessage(session.messages, systemPrompt) : session.messages
  const updatedSession: Session = {
    ...session,
    conversationMode: character ? 'roleplay' : session.conversationMode,
    name: character ? `${character.name} · 导入记录` : session.name,
    assistantAvatarKey:
      character?.avatar?.type === 'storage-key' ? character.avatar.storageKey : session.assistantAvatarKey,
    picUrl: character?.avatar?.type === 'url' ? character.avatar.url : session.picUrl,
    backgroundImage: character?.backgroundImage || session.backgroundImage,
    standingImage: character?.standingImage || session.standingImage,
    characterId: character?.id || session.characterId,
    characterDescription: character?.description || session.characterDescription || summary.characterDescription,
    characterRelationship: summary.relationship || session.characterRelationship,
    characterMemory: summary.memory || session.characterMemory,
    characterMemoryUpdatedAt: Date.now(),
    currentScene: summary.currentScene || session.currentScene,
    characterTags: character?.tags || session.characterTags || summary.tags,
    characterVoiceId: character?.voiceId || session.characterVoiceId,
    messages,
  }
  return updateSessionWithMessages(session.id, updatedSession)
}

function upsertSystemMessage(messages: Session['messages'], systemPrompt: string) {
  if (!systemPrompt.trim()) return messages
  const systemIndex = messages.findIndex((message) => message.role === 'system')
  if (systemIndex >= 0) {
    return messages.map((message, index) =>
      index === systemIndex ? { ...message, contentParts: [{ type: 'text' as const, text: systemPrompt }] } : message
    )
  }
  return [{ ...createMessage('system', systemPrompt), id: uuidv4() }, ...messages]
}

function createSessionFromImportedChat(chat: TavernImportChat, character?: TavernCharacter) {
  const base = initEmptyChatSession()
  const importedMessages = chat.messages.map((message) => ({
    ...message,
    id: message.id || uuidv4(),
    timestamp: message.timestamp || Date.now(),
  }))
  const messages = character
    ? [
        {
          ...createMessage('system', buildCharacterSystemPrompt(character)),
          id: uuidv4(),
        },
        ...importedMessages.filter((message) => message.role !== 'system'),
      ]
    : importedMessages

  const newSession: Omit<Session, 'id'> = {
    ...base,
    conversationMode: character ? 'roleplay' : 'assistant',
    name: character ? `${character.name} · 导入记录` : chat.title,
    assistantAvatarKey: character?.avatar?.type === 'storage-key' ? character.avatar.storageKey : undefined,
    picUrl: character?.avatar?.type === 'url' ? character.avatar.url : undefined,
    backgroundImage: character?.backgroundImage,
    standingImage: character?.standingImage,
    characterId: character?.id,
    characterDescription: character?.description,
    characterRelationship: '',
    characterMemory: '',
    currentScene: character?.scenario || '',
    characterTags: character?.tags,
    characterVoiceId: character?.voiceId,
    messages,
  }
  return createSessionStore(newSession)
}

async function syncCharacterToExistingSessions(character: TavernCharacter) {
  const metas = await listAllSessionsMeta()
  const matched = metas.filter((meta) => meta.characterId === character.id)
  for (const meta of matched) {
    const session = await getSession(meta.id)
    if (!session) continue
    const systemPrompt = buildCharacterSystemPrompt(character)
    const systemIndex = session.messages.findIndex((message) => message.role === 'system')
    const messages =
      systemIndex >= 0
        ? session.messages.map((message, index) =>
            index === systemIndex
              ? { ...message, contentParts: [{ type: 'text' as const, text: systemPrompt }] }
              : message
          )
        : [createMessage('system', systemPrompt), ...session.messages]

    await updateSessionWithMessages(session.id, {
      ...session,
      conversationMode: 'roleplay',
      name: character.name,
      assistantAvatarKey: character.avatar?.type === 'storage-key' ? character.avatar.storageKey : undefined,
      picUrl: character.avatar?.type === 'url' ? character.avatar.url : undefined,
      backgroundImage: character.backgroundImage,
      standingImage: character.standingImage,
      characterDescription: character.description,
      characterTags: character.tags,
      characterVoiceId: character.voiceId,
      messages,
    })
  }
  return matched.length
}

function CharacterImageField({
  label,
  description,
  source,
  placeholder,
  category,
  wide,
  contain,
  onChange,
}: {
  label: string
  description: string
  source?: ImageSource
  placeholder?: string
  category: string
  wide?: boolean
  contain?: boolean
  onChange(source?: ImageSource): void
}) {
  const uploadImage = (file: File | null) => {
    if (!file) return
    if (file.size > MAX_CHARACTER_IMAGE_SIZE) {
      toastActions.add('图片不能超过 8MB')
      return
    }
    const key = StorageKeyGenerator.picture(category)
    handleImageInputAndSave(
      file,
      key,
      () => onChange({ type: 'storage-key', storageKey: key }),
      (storageKey, value) => storage.setBlob(storageKey, value)
    )
  }

  const removeImage = () => {
    if (source?.type === 'storage-key') {
      void storage.removeItem(source.storageKey)
    }
    onChange(undefined)
  }

  const setUrl = (value: string) => {
    const url = value.trim()
    onChange(url ? { type: 'url', url } : undefined)
  }

  return (
    <Stack gap={6} className="v2chat-character-image-field">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <div className="min-w-0">
          <Text size="sm" fw={700}>
            {label}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {description}
          </Text>
        </div>
        {source && (
          <ActionIcon variant="subtle" color="red" aria-label={`移除${label}`} onClick={removeImage}>
            <ScalableIcon icon={IconTrash} size={16} />
          </ActionIcon>
        )}
      </Group>
      <Box className={wide ? 'v2chat-character-image-field__preview wide' : 'v2chat-character-image-field__preview'}>
        {source ? (
          <ImageSourceView source={source} className={contain ? 'object-contain object-bottom' : 'object-cover'} />
        ) : (
          <div className="v2chat-character-image-field__empty">
            {placeholder || <ScalableIcon icon={IconPhoto} size={24} />}
          </div>
        )}
      </Box>
      <Group gap="xs" grow>
        <FileButton onChange={uploadImage} accept="image/png,image/jpeg,image/webp">
          {(props) => (
            <Button {...props} size="xs" variant="light">
              上传
            </Button>
          )}
        </FileButton>
        {source && (
          <Button size="xs" variant="subtle" color="gray" onClick={removeImage}>
            清除
          </Button>
        )}
      </Group>
      <TextInput
        size="xs"
        placeholder="或粘贴图片 URL"
        value={source?.type === 'url' ? source.url : ''}
        onChange={(event) => setUrl(event.currentTarget.value)}
      />
    </Stack>
  )
}

function ImageSourceView({ source, className = 'object-cover' }: { source: ImageSource; className?: string }) {
  return source.type === 'storage-key' ? (
    <ImageInStorage storageKey={source.storageKey} className={`w-full h-full ${className}`} />
  ) : (
    <img src={source.url} alt="" className={`w-full h-full ${className}`} />
  )
}

function createBlankCharacter(): TavernCharacter {
  const time = Date.now()
  return {
    id: uuidv4(),
    name: '',
    subtitle: '',
    description: '',
    personality: '',
    scenario: '',
    firstMessage: '',
    exampleDialog: '',
    userPersona: '',
    worldSetting: '',
    outputStyle: '',
    tags: [],
    favorite: false,
    voiceId: undefined,
    voiceDescription: '',
    avatar: undefined,
    backgroundImage: undefined,
    standingImage: undefined,
    createdAt: time,
    updatedAt: time,
  }
}
