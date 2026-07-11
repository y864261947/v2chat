import NiceModal from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Loader,
  Menu,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import {
  getFileAcceptConfig,
  getFileAcceptString,
  getUnsupportedFileType,
  isSupportedFile,
} from '@shared/file-extensions'
import { KNOWLEDGE_BASE_MAX_FILE_SIZE, KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL } from '@shared/knowledge-base'
import { getModel } from '@shared/providers'
import { formatNumber } from '@shared/utils'
import {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowUp,
  IconBrain,
  IconChevronRight,
  IconCirclePlus,
  IconFilePencil,
  IconFolder,
  IconGridDots,
  IconHammer,
  IconLink,
  IconMicrophone,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlus,
  IconSettings,
  IconSparkles,
  IconVocabulary,
  IconVolume,
  IconWorldWww,
  IconWriting,
  IconX,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import _, { pick } from 'lodash'
import type React from 'react'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { createModelDependencies } from '@/adapters'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useMessageInput } from '@/hooks/useMessageInput'
import { useProviders } from '@/hooks/useProviders'
import { useSaveBlob } from '@/hooks/useSaveBlob'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import {
  getContextMessageIds,
  isAutoCompactionEnabled,
  isCompactionInProgress,
  useContextTokens,
} from '@/packages/context-management'
import { trackingEvent } from '@/packages/event'
import {
  getModelContextWindowSync,
  getProviderModelContextWindowSync,
  useModelRegistryVersion,
} from '@/packages/model-registry'
import * as picUtils from '@/packages/pic_utils'
import { transcribeAudio } from '@/packages/v2api-tts'
import platform from '@/platform'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'
import * as chatStore from '@/stores/chatStore'
import { useSession, useSessionSettings } from '@/stores/chatStore'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { delay } from '@/utils'
import { featureFlags } from '@/utils/feature-flags'
import { trackEvent } from '@/utils/track'
import {
  type KnowledgeBase,
  type Message,
  type MessageAudioPart,
  ModelProviderEnum,
  type SessionAttachment,
  type SessionAttachmentIndexingStage,
  type SessionType,
  type ShortcutSendValue,
} from '../../../shared/types'
import * as dom from '../../hooks/dom'
import { startPreparedSessionAttachmentIndexing } from '../../stores/sessionAttachmentRagIndexing'
import * as sessionHelpers from '../../stores/sessionHelpers'
import * as toastActions from '../../stores/toastActions'
import type { PreprocessedFile } from '../../types/input-box'
import { CompactionStatus } from '../chat/CompactionStatus'
import { AdaptiveModal } from '../common/AdaptiveModal'
import { CompressionModal } from '../common/CompressionModal'
import { ScalableIcon } from '../common/ScalableIcon'
import KnowledgeBaseMenu from '../knowledge-base/KnowledgeBaseMenu'
import ModelSelector from '../ModelSelector'
import MCPMenu from '../mcp/MCPMenu'
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from './Attachments'
import { ImageUploadInput } from './ImageUploadInput'
import {
  cleanupFile,
  cleanupLink,
  markFileProcessing,
  markLinkProcessing,
  onFileProcessed,
  onLinkProcessed,
  storeFilePromise,
  storeLinkPromise,
} from './preprocessState'
import TokenCountMenu from './TokenCountMenu'

export type InputBoxPayload = {
  constructedMessage: Message
  needGenerating?: boolean
  onUserMessageReady?: () => void
}

export type InputBoxRef = {
  setQuote: (quote: string) => void
}

export type InputBoxProps = {
  sessionId?: string
  sessionType?: SessionType
  generating?: boolean
  model?: {
    provider: string
    modelId: string
  }
  fullWidth?: boolean
  onSelectModel?(provider: string, model: string): void
  onSubmit?(payload: InputBoxPayload): Promise<void>
  onStopGenerating?(): boolean
  onStartNewThread?(): boolean
  onRollbackThread?(): boolean
  onClickSessionSettings?(): boolean | Promise<boolean>
}

function mergeSessionAttachmentStatesIntoFiles(
  files: PreprocessedFile[],
  attachments: SessionAttachment[]
): { files: PreprocessedFile[]; changed: boolean } {
  if (files.length === 0 || attachments.length === 0) {
    return { files, changed: false }
  }

  const attachmentStateMap = new Map(attachments.map((attachment) => [attachment.id, attachment]))
  let changed = false
  const nextFiles = files.map((file) => {
    if (!file.sessionAttachmentId) {
      return file
    }
    const attachment = attachmentStateMap.get(file.sessionAttachmentId)
    if (!attachment) {
      return file
    }
    const nextFile = {
      ...file,
      sessionAttachmentAvailability: attachment.availability ?? file.sessionAttachmentAvailability,
      sessionAttachmentIndexStatus: attachment.indexStatus ?? file.sessionAttachmentIndexStatus,
      sessionAttachmentChunkCount: attachment.chunkCount ?? file.sessionAttachmentChunkCount,
      sessionAttachmentTotalChunks: attachment.totalChunks ?? file.sessionAttachmentTotalChunks,
      sessionAttachmentEmbeddedChunks: attachment.embeddedChunks ?? file.sessionAttachmentEmbeddedChunks,
      sessionAttachmentIndexingStage: attachment.indexingStage ?? file.sessionAttachmentIndexingStage,
      error: attachment.error ?? file.error,
    }
    const fileChanged =
      nextFile.sessionAttachmentAvailability !== file.sessionAttachmentAvailability ||
      nextFile.sessionAttachmentIndexStatus !== file.sessionAttachmentIndexStatus ||
      nextFile.sessionAttachmentChunkCount !== file.sessionAttachmentChunkCount ||
      nextFile.sessionAttachmentTotalChunks !== file.sessionAttachmentTotalChunks ||
      nextFile.sessionAttachmentEmbeddedChunks !== file.sessionAttachmentEmbeddedChunks ||
      nextFile.sessionAttachmentIndexingStage !== file.sessionAttachmentIndexingStage ||
      nextFile.error !== file.error
    if (fileChanged) {
      changed = true
    }
    return fileChanged ? nextFile : file
  })

  return { files: nextFiles, changed }
}

function getSessionAttachmentProgressValue(embeddedChunks?: number, totalChunks?: number): number | undefined {
  if (!totalChunks || totalChunks <= 0 || embeddedChunks === undefined) return undefined
  return Math.max(0, Math.min(100, Math.round((embeddedChunks / totalChunks) * 100)))
}

function getSessionAttachmentStageLabel(
  stage: SessionAttachmentIndexingStage | undefined,
  t: (key: string) => string
): string {
  switch (stage) {
    case 'queued':
      return t('Queued')
    case 'chunking':
      return t('Preparing')
    case 'embedding':
      return t('Indexing')
    case 'finalizing':
      return t('Finishing')
    case 'ready':
      return t('Indexed')
    default:
      return t('Indexing')
  }
}

const InputBox = forwardRef<InputBoxRef, InputBoxProps>(
  (
    {
      sessionId,
      sessionType = 'chat',
      generating = false,
      model,
      fullWidth = false,
      onSelectModel,
      onSubmit,
      onStopGenerating,
      onStartNewThread,
      onRollbackThread,
      onClickSessionSettings,
    },
    ref
  ) => {
    const modelRegistryVersion = useModelRegistryVersion()

    const { t } = useTranslation()
    const navigate = useNavigate()
    const isSmallScreen = useIsSmallScreen()
    const useImComposer = true
    const toolbarIconSize = isSmallScreen ? 22 : 18
    const { height: viewportHeight } = useViewportSize()
    const pasteLongTextAsAFile = useSettingsStore((state) => state.pasteLongTextAsAFile)
    const shortcuts = useSettingsStore((state) => state.shortcuts)
    const widthFull = useUIStore((s) => s.widthFull) || fullWidth
    const saveBlob = useSaveBlob()
    const [isRecording, setIsRecording] = useState(false)
    const [isPressToTalkActive, setIsPressToTalkActive] = useState(false)
    const [isPressToTalkCancelling, setIsPressToTalkCancelling] = useState(false)
    const [recordingDurationMs, setRecordingDurationMs] = useState(0)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const recordingChunksRef = useRef<Blob[]>([])
    const recordingStreamRef = useRef<MediaStream | null>(null)
    const recordingStartedAtRef = useRef(0)
    const pressToTalkTimerRef = useRef<number | null>(null)
    const pressToTalkPointerIdRef = useRef<number | null>(null)
    const pressToTalkStartYRef = useRef<number | null>(null)
    const pressToTalkCancellingRef = useRef(false)
    const pressToTalkActiveRef = useRef(false)
    const suppressRecordingClickRef = useRef(false)

    const currentSessionId = sessionId
    const isNewSession = currentSessionId === 'new'

    // Session-level web browsing mode
    const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
    const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
    const updateCurrentWebBrowsingDisplay = useUIStore((s) => s.updateCurrentWebBrowsingDisplay)
    // Get session-specific value, or use default based on provider (ChatboxAI defaults to true)
    const webBrowsingMode = useMemo(() => {
      const sessionValue = sessionWebBrowsingMap[currentSessionId || 'new']
      if (sessionValue !== undefined) {
        return sessionValue
      }
      // Default: true for ChatboxAI, false for others
      return model?.provider === ModelProviderEnum.ChatboxAI
    }, [sessionWebBrowsingMap, currentSessionId, model?.provider])

    // this is used for keyboard shortcut. if we don't provide this, kbd wont know what to set when it's a new session(it doesnt have provider info)
    useEffect(() => {
      updateCurrentWebBrowsingDisplay(currentSessionId || 'new', webBrowsingMode)
    }, [currentSessionId, webBrowsingMode, updateCurrentWebBrowsingDisplay])

    const setWebBrowsingMode = useCallback(
      (enabled: boolean) => {
        setSessionWebBrowsing(currentSessionId || 'new', enabled)
      },
      [currentSessionId, setSessionWebBrowsing]
    )

    // messageInput lives inside the MessageInputField child component to avoid
    // re-rendering the entire InputBox (20+ hooks, 1300+ lines) on every keystroke.
    // The parent only keeps a ref to the latest text and a boolean for empty/non-empty.
    const messageInputFieldRef = useRef<MessageInputFieldRef>(null)
    const latestInputRef = useRef('')
    const [hasTextContent, setHasTextContent] = useState(false)
    const [activeTavernQuickActionId, setActiveTavernQuickActionId] = useState<string | null>(null)
    const draftMessageIdRef = useRef<string | undefined>(undefined)

    const debouncedUpdateTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const resetHistoryIndexRef = useRef<() => void>(() => {})

    // Called only on real user typing (not programmatic setValue), to avoid resetting history navigation
    const onUserInput = useCallback(() => {
      resetHistoryIndexRef.current()
    }, [])

    const onMessageInputValueChange = useCallback((value: string) => {
      latestInputRef.current = value
      const hasContent = value.trim().length > 0
      setHasTextContent((prev) => {
        if (prev === hasContent) return prev
        return hasContent
      })
      // Schedule debounced pre-constructed message update
      clearTimeout(debouncedUpdateTimerRef.current)
      debouncedUpdateTimerRef.current = setTimeout(() => flushRef.current(), 300)
    }, [])

    // Pre-constructed message state (scoped by session)
    const [preConstructedMessage, setPreConstructedMessage] = useAtom(
      atoms.inputBoxPreConstructedMessageFamily(currentSessionId || 'new')
    )
    const preConstructedMessageRef = useRef(preConstructedMessage)
    preConstructedMessageRef.current = preConstructedMessage
    const activeFilePreprocessingKeysRef = useRef(new Set<string>())
    const inputFileKeyByFileRef = useRef(new WeakMap<File, string>())
    useEffect(() => {
      draftMessageIdRef.current = preConstructedMessage.draftMessageId
    }, [preConstructedMessage.draftMessageId])
    const pictureKeys = preConstructedMessage.pictureKeys || []
    const audioParts = preConstructedMessage.audioParts || []
    const attachments = preConstructedMessage.attachments || []

    const { session: currentSession } = useSession(sessionId || null)
    const { sessionSettings: currentSessionMergedSettings } = useSessionSettings(sessionId || null)

    // Get current messages for token counting - will only recalculate when stable messages actually change
    // Uses getContextMessageIds to respect compaction points
    const currentContextMessageIds = useMemo(() => {
      if (isNewSession) return null
      if (!currentSession?.messages.length) return null

      return getContextMessageIds(currentSession, currentSessionMergedSettings?.maxContextMessageCount)
    }, [isNewSession, currentSessionMergedSettings?.maxContextMessageCount, currentSession])

    const { knowledgeBase, setKnowledgeBase } = useKnowledgeBase({ isNewSession })

    const [showCompressionModal, setShowCompressionModal] = useState(false)

    const [links, setLinks] = useAtom(atoms.inputBoxLinksFamily(currentSessionId || 'new'))
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [unreadyAttachmentSubmitPrompt, setUnreadyAttachmentSubmitPrompt] = useState<{
      opened: boolean
      count: number
    }>({ opened: false, count: 0 })

    const flushPreConstructedMessage = useCallback(() => {
      clearTimeout(debouncedUpdateTimerRef.current)
      const text = latestInputRef.current
      const constructedMessage = sessionHelpers.constructUserMessage(
        preConstructedMessage.draftMessageId,
        text,
        pictureKeys,
        audioParts,
        preConstructedMessage.preprocessedFiles,
        preConstructedMessage.preprocessedLinks
      )
      setPreConstructedMessage((prev) => ({
        ...prev,
        text,
        pictureKeys,
        attachments,
        links,
        message: constructedMessage,
      }))
    }, [
      preConstructedMessage.draftMessageId,
      pictureKeys,
      audioParts,
      attachments,
      links,
      preConstructedMessage.preprocessedFiles,
      preConstructedMessage.preprocessedLinks,
      setPreConstructedMessage,
    ])

    const flushRef = useRef(flushPreConstructedMessage)
    flushRef.current = flushPreConstructedMessage

    // When non-text deps change (pictures, attachments, links), flush immediately
    useEffect(() => {
      flushRef.current()
    }, [flushPreConstructedMessage])

    const pictureInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Check if any preprocessing is in progress
    const isPreprocessing = useMemo(() => {
      const hasProcessingFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'processing'
      )
      const hasProcessingLinks = Object.values(preConstructedMessage.preprocessingStatus.links || {}).some(
        (status) => status === 'processing'
      )
      return hasProcessingFiles || hasProcessingLinks
    }, [preConstructedMessage.preprocessingStatus])

    // Check if any preprocessing has errors
    const hasPreprocessErrors = useMemo(() => {
      const hasErrorFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'error'
      )
      const hasErrorLinks = Object.values(preConstructedMessage.preprocessingStatus.links || {}).some(
        (status) => status === 'error'
      )
      return hasErrorFiles || hasErrorLinks
    }, [preConstructedMessage.preprocessingStatus])

    const hasBlockedSessionRagFiles = useMemo(
      () =>
        preConstructedMessage.preprocessedFiles.some(
          (file) => file.ragMode === 'session-retrieval' && file.sessionAttachmentAvailability === 'blocked'
        ),
      [preConstructedMessage.preprocessedFiles]
    )
    const hasSessionRetrievalFiles = useMemo(
      () =>
        preConstructedMessage.preprocessedFiles.some(
          (file) => file.ragMode === 'session-retrieval' && file.sessionAttachmentAvailability !== 'blocked'
        ),
      [preConstructedMessage.preprocessedFiles]
    )
    const hasLargeAttachmentWarning = useMemo(
      () =>
        preConstructedMessage.preprocessedFiles.some(
          (file) =>
            file.sessionAttachmentWarningReason === sessionHelpers.SESSION_ATTACHMENT_RAG_LARGE_ATTACHMENT_WARNING
        ),
      [preConstructedMessage.preprocessedFiles]
    )

    const disableSubmit = useMemo(
      () =>
        !(
          hasTextContent ||
          activeTavernQuickActionId ||
          links?.length ||
          attachments?.length ||
          pictureKeys?.length ||
          audioParts?.length
        ),
      [hasTextContent, activeTavernQuickActionId, links, attachments, pictureKeys, audioParts]
    )

    const { providers } = useProviders()
    const preprocessedSessionAttachmentIds = useMemo(
      () =>
        Array.from(
          new Set(
            preConstructedMessage.preprocessedFiles.flatMap((file) =>
              file.sessionAttachmentId ? [file.sessionAttachmentId] : []
            )
          )
        ),
      [preConstructedMessage.preprocessedFiles]
    )
    const { data: preprocessedAttachmentStates = [] } = useQuery<SessionAttachment[]>({
      queryKey: [
        'input-box-session-attachment-rag-attachments',
        ...preprocessedSessionAttachmentIds.sort((a, b) => a - b),
      ],
      queryFn: () => {
        if (platform.type !== 'desktop' || preprocessedSessionAttachmentIds.length === 0) {
          return []
        }
        return platform.getSessionAttachmentRagController().getAttachments(preprocessedSessionAttachmentIds)
      },
      enabled: platform.type === 'desktop' && preprocessedSessionAttachmentIds.length > 0,
      refetchInterval: (query): number | false => {
        const attachments = (query.state.data as SessionAttachment[] | undefined) ?? []
        return attachments.some(
          (attachment) => attachment.indexStatus === 'pending' || attachment.indexStatus === 'indexing'
        )
          ? 1500
          : false
      },
    })
    const preprocessedAttachmentIndexStatusMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.indexStatus])),
      [preprocessedAttachmentStates]
    )
    const preprocessedAttachmentErrorMap = useMemo(
      () => new Map(preprocessedAttachmentStates.map((attachment) => [attachment.id, attachment.error])),
      [preprocessedAttachmentStates]
    )
    const preprocessedAttachmentProgressMap = useMemo(
      () =>
        new Map(
          preprocessedAttachmentStates.map((attachment) => [
            attachment.id,
            {
              totalChunks: attachment.totalChunks ?? 0,
              embeddedChunks: attachment.embeddedChunks ?? 0,
              indexingStage: attachment.indexingStage,
              processingStartedAt: attachment.processingStartedAt,
            },
          ])
        ),
      [preprocessedAttachmentStates]
    )
    useEffect(() => {
      if (preprocessedAttachmentStates.length === 0) {
        return
      }
      setPreConstructedMessage((prev) => {
        const result = mergeSessionAttachmentStatesIntoFiles(prev.preprocessedFiles, preprocessedAttachmentStates)
        return result.changed ? { ...prev, preprocessedFiles: result.files } : prev
      })
    }, [preprocessedAttachmentStates, setPreConstructedMessage])
    const modelSelectorDisplayText = useMemo(() => {
      if (!model) {
        return t('Select Model')
      }
      const providerInfo = providers.find((p) => p.id === model.provider)

      const modelInfo = (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find(
        (m) => m.modelId === model.modelId
      )
      return `${modelInfo?.nickname || model.modelId}`
    }, [providers, model, t])

    const handleModelSelect = useCallback(
      (provider: string, modelId: string) => {
        onSelectModel?.(provider, modelId)
        const providerInfo = providers.find((item) => item.id === provider)
        const selectedModel = (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find(
          (item) => item.modelId === modelId
        )
        toastActions.add(`已切换到 ${selectedModel?.nickname || modelId}`, 1800)
      },
      [onSelectModel, providers]
    )

    // Get model info for context window
    const modelInfo = useMemo(() => {
      if (!model) return null
      const providerInfo = providers.find((p) => p.id === model.provider)
      return (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find((m) => m.modelId === model.modelId)
    }, [providers, model])

    // Check if model supports tool use for files
    const { data: modelSupportToolUseForFile = false, isFetched: isModelToolCapabilityFetched } = useQuery({
      queryKey: ['model-tool-capability', model?.provider, model?.modelId],
      queryFn: async () => {
        if (!model?.provider || !model?.modelId) {
          return false
        }

        try {
          const globalSettings = settingsStore.getState().getSettings()
          const configs = await platform.getConfig()
          const dependencies = await createModelDependencies()

          const settings = {
            provider: model.provider,
            modelId: model.modelId,
            ...currentSessionMergedSettings,
          }

          const modelInstance = getModel(settings, globalSettings, configs, dependencies)
          return modelInstance.isSupportToolUse('read-file')
        } catch (e) {
          console.debug('useModelToolCapability: failed to check capability', e)
          return false
        }
      },
      enabled: !!(model?.provider && model?.modelId),
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    })
    const showSessionRetrievalToolWarning =
      hasSessionRetrievalFiles && isModelToolCapabilityFetched && !modelSupportToolUseForFile

    // Calculate token counts using unified cache layer
    const { contextTokens, currentInputTokens, totalTokens, isCalculating, pendingTasks, messageCount } =
      useContextTokens({
        sessionId: currentSessionId || null,
        session: currentSession,
        settings: currentSessionMergedSettings || {},
        model,
        modelSupportToolUseForFile,
        constructedMessage: preConstructedMessage.message,
      })

    const globalSettings = useSettingsStore((state) => state)
    const [isCompacting, setIsCompacting] = useState(false)

    const compactionUIStateMap = useAtomValue(compactionUIStateMapAtom)
    const isCompactionRunning = useMemo(() => {
      if (!currentSessionId || isNewSession) return false
      return compactionUIStateMap[currentSessionId]?.status === 'running'
    }, [compactionUIStateMap, currentSessionId, isNewSession])

    const autoCompactionEnabled = useMemo(() => {
      if (!currentSession) return globalSettings.autoCompaction ?? true
      return isAutoCompactionEnabled(currentSession.settings, globalSettings)
    }, [currentSession, globalSettings])

    const contextWindowKnown = useMemo(() => {
      if (!model?.modelId) return false
      if (modelInfo?.contextWindow) return true
      if (model?.provider && getProviderModelContextWindowSync(model.provider, model.modelId) !== null) return true
      // Fallback: provider-agnostic lookup (same as compaction detector)
      return getModelContextWindowSync(model.modelId) !== null
    }, [model?.modelId, model?.provider, modelInfo?.contextWindow, modelRegistryVersion])

    // Use model setting contextWindow if available, otherwise fallback to models.dev data
    const effectiveContextWindow = useMemo(() => {
      if (modelInfo?.contextWindow) return modelInfo.contextWindow
      if (model?.provider && model?.modelId) {
        const providerWindow = getProviderModelContextWindowSync(model.provider, model.modelId)
        if (providerWindow !== null) return providerWindow
      }
      // Fallback: provider-agnostic lookup (same as compaction detector)
      if (model?.modelId) return getModelContextWindowSync(model.modelId)
      return null
    }, [modelInfo?.contextWindow, model?.modelId, model?.provider, modelRegistryVersion])

    // Calculate token usage percentage
    const tokenPercentage = useMemo(() => {
      if (!effectiveContextWindow || effectiveContextWindow <= 0) return null
      return Math.round((totalTokens / effectiveContextWindow) * 100)
    }, [totalTokens, effectiveContextWindow])

    useEffect(() => {
      if (!currentSessionId || isNewSession) {
        setIsCompacting(false)
        return
      }
      const checkCompacting = () => {
        setIsCompacting(isCompactionInProgress(currentSessionId))
      }
      checkCompacting()
      const interval = setInterval(checkCompacting, 1000)
      return () => clearInterval(interval)
    }, [currentSessionId, isNewSession])

    const handleAutoCompactionChange = useCallback(
      async (enabled: boolean) => {
        if (!currentSessionId || isNewSession) return
        await chatStore.updateSession(currentSessionId, (session) => {
          if (!session) {
            throw new Error('Session not found')
          }
          return {
            ...session,
            settings: {
              ...session.settings,
              autoCompaction: enabled,
            },
          }
        })
      },
      [currentSessionId, isNewSession]
    )

    const [showSelectModelErrorTip, setShowSelectModelErrorTip] = useState(false)
    useEffect(() => {
      if (showSelectModelErrorTip) {
        const clickEventListener = () => {
          setShowSelectModelErrorTip(false)
          document.removeEventListener('click', clickEventListener)
        }
        document.addEventListener('click', clickEventListener)
        return () => {
          document.removeEventListener('click', clickEventListener)
        }
      }
    }, [showSelectModelErrorTip])

    const [showRollbackThreadButton, setShowRollbackThreadButton] = useState(false)
    useEffect(() => {
      if (showRollbackThreadButton) {
        const tid = setTimeout(() => {
          setShowRollbackThreadButton(false)
        }, 5000)
        return () => {
          clearTimeout(tid)
        }
      }
    }, [showRollbackThreadButton])

    useImperativeHandle(
      ref,
      () => ({
        // 暂时并没有用到，还是使用了之前atom的方案
        setQuote: (data) => {
          messageInputFieldRef.current?.setValue((prev) => `${prev}\n\n${data}`)
          dom.focusMessageInput()
          dom.setMessageInputCursorToEnd()
        },
      }),
      []
    )

    const { addInputBoxHistory, getPreviousHistoryInput, getNextHistoryInput, resetHistoryIndex } = useInputBoxHistory()
    resetHistoryIndexRef.current = resetHistoryIndex

    type SubmitOptions = {
      allowUnreadySessionAttachments?: boolean
      audioPartsOverride?: MessageAudioPart[]
      force?: boolean
      textOverride?: string
    }
    const handleSubmitRef = useRef<(needGenerating?: boolean, options?: SubmitOptions) => void>(() => {})
    const getPreviousHistoryInputRef = useRef(getPreviousHistoryInput)
    getPreviousHistoryInputRef.current = getPreviousHistoryInput
    const getNextHistoryInputRef = useRef(getNextHistoryInput)
    getNextHistoryInputRef.current = getNextHistoryInput
    const insertFilesRef = useRef<(files: File[]) => void>(() => {})
    const insertLinksRef = useRef<(urls: string[]) => void>(() => {})

    useEffect(() => {
      if (!isRecording) return undefined
      const timer = window.setInterval(() => {
        setRecordingDurationMs(Date.now() - recordingStartedAtRef.current)
      }, 250)
      return () => window.clearInterval(timer)
    }, [isRecording])

    useEffect(() => {
      return () => {
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      }
    }, [])

    const appendTranscriptToInput = useCallback((transcript: string) => {
      const text = transcript.trim()
      if (!text) return latestInputRef.current
      const next = latestInputRef.current.trim() ? `${latestInputRef.current.trimEnd()}\n${text}` : text
      latestInputRef.current = next
      setHasTextContent(next.trim().length > 0)
      messageInputFieldRef.current?.setValue(next)
      return next
    }, [])

    const handleStartRecording = useCallback(async () => {
      if ((preConstructedMessageRef.current.audioParts || []).length >= 4) {
        toastActions.add('最多可发送 4 条语音，请先删除一条再录。')
        return false
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        toastActions.add('当前环境不支持麦克风录音。')
        return false
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mimeType = getPreferredRecordingMimeType()
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
        recordingChunksRef.current = []
        recordingStreamRef.current = stream
        mediaRecorderRef.current = recorder
        recordingStartedAtRef.current = Date.now()
        setRecordingDurationMs(0)

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordingChunksRef.current.push(event.data)
          }
        }
        recorder.start()
        setIsRecording(true)
        return true
      } catch (error) {
        toastActions.add(`无法开始录音：${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    }, [])

    const handleStopRecording = useCallback(async () => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        setIsRecording(false)
        return null
      }

      const durationMs = Date.now() - recordingStartedAtRef.current
      const stoppedBlob = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || recordingChunksRef.current[0]?.type || 'audio/webm'
          resolve(new Blob(recordingChunksRef.current, { type: mimeType }))
        }
      })

      recorder.stop()
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      mediaRecorderRef.current = null
      setIsRecording(false)

      const audioBlob = await stoppedBlob
      if (audioBlob.size === 0) {
        toastActions.add('录音为空，请重新录制。')
        return null
      }

      const storageKey = StorageKeyGenerator.audio('input-box-recording')
      const dataUrl = await blobToDataUrl(audioBlob)
      await saveBlob.mutateAsync({ key: storageKey, value: dataUrl })

      let transcript = ''
      try {
        transcript = await transcribeAudio({
          audio: audioBlob,
          durationMs,
          fileName: `v2chat-recording-${Date.now()}.webm`,
        })
        appendTranscriptToInput(transcript)
      } catch (error) {
        toastActions.add(`语音转写失败：${error instanceof Error ? error.message : String(error)}`)
      }

      const audioPart: MessageAudioPart = {
        type: 'audio',
        storageKey,
        mimeType: audioBlob.type || 'audio/webm',
        durationMs,
        transcript: transcript || undefined,
      }
      const nextAudioParts = [...(preConstructedMessageRef.current.audioParts || []), audioPart].slice(0, 4)
      preConstructedMessageRef.current = {
        ...preConstructedMessageRef.current,
        audioParts: nextAudioParts,
      }
      setPreConstructedMessage((prev) => ({
        ...prev,
        audioParts: [...(prev.audioParts || []), audioPart].slice(0, 4),
      }))
      return { audioPart, audioParts: nextAudioParts }
    }, [appendTranscriptToInput, saveBlob, setPreConstructedMessage])

    const tavernQuickActions = useMemo(
      () => [
        {
          id: 'continue',
          label: '继续剧情',
          icon: IconSparkles,
          hint: '让角色顺着当前上下文往下演。',
          prompt: '继续剧情。请结合当前上下文推进一小段，保持角色口吻，回复不要太长。',
        },
        {
          id: 'short',
          label: '简短回复',
          icon: IconWriting,
          hint: '控制长度，适合快节奏对话。',
          prompt: '简短回复。请结合当前上下文，用角色口吻回复我，控制在两三句话内。',
        },
        {
          id: 'scene',
          label: '描写场景',
          icon: IconVocabulary,
          hint: '补充环境、动作和氛围。',
          prompt: '描写当前场景。请结合当前剧情，描写此刻的环境、动作和氛围，保持沉浸感，不要太长。',
        },
        {
          id: 'image',
          label: '剧情生图',
          icon: IconPhoto,
          hint: '根据剧情生成当前画面。',
          prompt: '剧情生图。请根据当前聊天剧情生成一张画面，先整理成适合生图的提示词，然后生成图片。',
        },
        {
          id: 'voice',
          label: '语音回复',
          icon: IconVolume,
          hint: '让角色用语音条简短回应。',
          prompt: '语音回复。请结合当前上下文，用角色口吻简短回复我，并发送语音条。',
        },
      ],
      []
    )
    const activeTavernQuickAction = useMemo(
      () => tavernQuickActions.find((action) => action.id === activeTavernQuickActionId) || null,
      [activeTavernQuickActionId, tavernQuickActions]
    )

    const applyTavernQuickAction = useCallback((actionId: string) => {
      setActiveTavernQuickActionId((current) => (current === actionId ? null : actionId))
      window.setTimeout(() => messageInputFieldRef.current?.getElement()?.focus(), 0)
    }, [])

    const buildTavernSubmitText = useCallback(
      (text: string) => {
        const trimmedText = text.trim()
        if (!activeTavernQuickAction) {
          return text
        }
        return trimmedText ? `${trimmedText}\n\n${activeTavernQuickAction.prompt}` : activeTavernQuickAction.prompt
      },
      [activeTavernQuickAction]
    )

    const clearPressToTalkTimer = useCallback(() => {
      if (pressToTalkTimerRef.current) {
        window.clearTimeout(pressToTalkTimerRef.current)
        pressToTalkTimerRef.current = null
      }
    }, [])

    const finishPressToTalk = useCallback(
      async (shouldSend: boolean) => {
        clearPressToTalkTimer()
        const wasPressToTalkActive = pressToTalkActiveRef.current
        pressToTalkActiveRef.current = false
        pressToTalkPointerIdRef.current = null
        pressToTalkStartYRef.current = null
        pressToTalkCancellingRef.current = false
        setIsPressToTalkActive(false)
        setIsPressToTalkCancelling(false)

        if (!wasPressToTalkActive) {
          return
        }

        suppressRecordingClickRef.current = true
        const result = await handleStopRecording()
        if (shouldSend && result?.audioParts.length) {
          handleSubmitRef.current(true, {
            audioPartsOverride: result.audioParts,
            force: true,
            textOverride: latestInputRef.current,
          })
        }
      },
      [clearPressToTalkTimer, handleStopRecording]
    )

    const handleRecordingPointerDown = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        if (
          event.button > 0 ||
          isRecording ||
          isSubmitting ||
          isCompactionRunning ||
          generating ||
          pressToTalkTimerRef.current
        ) {
          return
        }

        const target = event.currentTarget
        pressToTalkPointerIdRef.current = event.pointerId
        pressToTalkStartYRef.current = event.clientY
        pressToTalkCancellingRef.current = false
        setIsPressToTalkCancelling(false)
        suppressRecordingClickRef.current = false
        target.setPointerCapture?.(event.pointerId)
        pressToTalkTimerRef.current = window.setTimeout(() => {
          pressToTalkTimerRef.current = null
          suppressRecordingClickRef.current = true
          pressToTalkActiveRef.current = true
          setIsPressToTalkActive(true)
          void handleStartRecording().then((started) => {
            if (!started) {
              pressToTalkActiveRef.current = false
              setIsPressToTalkActive(false)
              pressToTalkPointerIdRef.current = null
              pressToTalkStartYRef.current = null
              pressToTalkCancellingRef.current = false
              setIsPressToTalkCancelling(false)
            }
          })
        }, 220)
      },
      [generating, handleStartRecording, isCompactionRunning, isRecording, isSubmitting]
    )

    const handleRecordingPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
      if (!pressToTalkActiveRef.current || pressToTalkPointerIdRef.current !== event.pointerId) return
      const startY = pressToTalkStartYRef.current
      if (startY === null) return
      const cancelling = startY - event.clientY > 56
      if (cancelling !== pressToTalkCancellingRef.current) {
        pressToTalkCancellingRef.current = cancelling
        setIsPressToTalkCancelling(cancelling)
      }
    }, [])

    const handleRecordingPointerUp = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        if (pressToTalkPointerIdRef.current !== event.pointerId && pressToTalkPointerIdRef.current !== null) {
          return
        }
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        void finishPressToTalk(!pressToTalkCancellingRef.current)
      },
      [finishPressToTalk]
    )

    const handleRecordingPointerCancel = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        void finishPressToTalk(false)
      },
      [finishPressToTalk]
    )

    const handleRecordingClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressRecordingClickRef.current) {
          suppressRecordingClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (isRecording) {
          void handleStopRecording()
        } else {
          void handleStartRecording()
        }
      },
      [handleStartRecording, handleStopRecording, isRecording]
    )

    const closeSelectModelErrorTipCb = useRef<NodeJS.Timeout>()
    const handleSubmit = async (needGenerating = true, options: SubmitOptions = {}) => {
      if (
        (disableSubmit && !options.force) ||
        generating ||
        isSubmitting ||
        isPreprocessing ||
        hasPreprocessErrors ||
        hasBlockedSessionRagFiles
      ) {
        return
      }

      // 未选择模型时 显示error tip
      if (!model) {
        // 如果不延时执行，会导致error tip 立即消失
        await delay(100)
        if (closeSelectModelErrorTipCb.current) {
          clearTimeout(closeSelectModelErrorTipCb.current)
        }
        setShowSelectModelErrorTip(true)
        closeSelectModelErrorTipCb.current = setTimeout(() => setShowSelectModelErrorTip(false), 5000)
        return
      }

      // Cancel any pending debounce so it won't overwrite the reset after send
      clearTimeout(debouncedUpdateTimerRef.current)

      setIsSubmitting(true)
      try {
        let preprocessedFilesForSubmit = preConstructedMessage.preprocessedFiles
        const submitSessionAttachmentIds = Array.from(
          new Set(
            preprocessedFilesForSubmit.flatMap((file) => (file.sessionAttachmentId ? [file.sessionAttachmentId] : []))
          )
        )
        if (platform.type === 'desktop' && submitSessionAttachmentIds.length > 0) {
          const latestAttachmentStates = await platform
            .getSessionAttachmentRagController()
            .getAttachments(submitSessionAttachmentIds)
          const result = mergeSessionAttachmentStatesIntoFiles(preprocessedFilesForSubmit, latestAttachmentStates)
          preprocessedFilesForSubmit = result.files
          if (result.changed) {
            setPreConstructedMessage((prev) => ({ ...prev, preprocessedFiles: result.files }))
          }
        }
        const unreadySessionAttachments = preprocessedFilesForSubmit.filter(
          (file) =>
            file.ragMode === 'session-retrieval' &&
            file.sessionAttachmentAvailability !== 'blocked' &&
            (file.sessionAttachmentIndexStatus ?? 'pending') !== 'ready'
        )
        if (unreadySessionAttachments.length > 0 && !options.allowUnreadySessionAttachments) {
          setUnreadyAttachmentSubmitPrompt({ opened: true, count: unreadySessionAttachments.length })
          return
        }

        // Build the message with the latest input text, bypassing debounce delay
        const textForSubmit = buildTavernSubmitText(options.textOverride ?? latestInputRef.current)
        const audioPartsForSubmit = options.audioPartsOverride ?? audioParts
        const latestMessage = sessionHelpers.constructUserMessage(
          preConstructedMessage.draftMessageId,
          textForSubmit,
          pictureKeys,
          audioPartsForSubmit,
          preprocessedFilesForSubmit,
          preConstructedMessage.preprocessedLinks
        )
        if (!latestMessage) {
          console.error('No constructed message available')
          return
        }

        const messageTextForHistory = latestMessage.contentParts.find((p) => p.type === 'text')?.text || ''

        const params = {
          constructedMessage: latestMessage,
          needGenerating,
          onUserMessageReady: () => {
            messageInputFieldRef.current?.clearDraft()
            setLinks([])
            draftMessageIdRef.current = undefined
            setPreConstructedMessage({
              draftMessageId: undefined,
              text: '',
              pictureKeys: [],
              audioParts: [],
              attachments: [],
              links: [],
              preprocessedFiles: [],
              preprocessedLinks: [],
              preprocessingStatus: {
                files: {},
                links: {},
              },
              preprocessingPromises: {
                files: new Map(),
                links: new Map(),
              },
              message: undefined,
            })
            setShowRollbackThreadButton(false)
            setActiveTavernQuickActionId(null)
            if (platform.type !== 'mobile' && messageTextForHistory) {
              addInputBoxHistory(messageTextForHistory)
            }
          },
        }

        await onSubmit?.(params)

        trackingEvent('send_message', { event_category: 'user' })
      } catch (e) {
        console.error('Error submitting message:', e)
        toastActions.add((e as Error)?.message || t('An error occurred while sending the message.'))
      } finally {
        setIsSubmitting(false)
      }
    }
    handleSubmitRef.current = handleSubmit

    const onKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isPressedHash: Record<ShortcutSendValue, boolean> = {
          '': false,
          Enter: event.keyCode === 13 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey,
          'CommandOrControl+Enter': event.keyCode === 13 && (event.ctrlKey || event.metaKey) && !event.shiftKey,
          'Ctrl+Enter': event.keyCode === 13 && event.ctrlKey && !event.shiftKey,
          'Command+Enter': event.keyCode === 13 && event.metaKey,
          'Shift+Enter': event.keyCode === 13 && event.shiftKey,
          'Ctrl+Shift+Enter': event.keyCode === 13 && event.ctrlKey && event.shiftKey,
        }

        // 发送消息
        if (isPressedHash[shortcuts.inputBoxSendMessage]) {
          if (platform.type === 'mobile' && isSmallScreen && shortcuts.inputBoxSendMessage === 'Enter') {
            // 移动端点击回车不会发送消息
            return
          }
          event.preventDefault()
          handleSubmitRef.current()
          return
        }

        // 发送消息但不生成回复
        if (isPressedHash[shortcuts.inputBoxSendMessageWithoutResponse]) {
          event.preventDefault()
          handleSubmitRef.current(false)
          return
        }

        // 向上向下键翻阅历史消息
        const currentInput = latestInputRef.current
        const inputElement = messageInputFieldRef.current?.getElement()
        if (
          (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          inputElement &&
          inputElement === document.activeElement && // 聚焦在输入框
          (currentInput.length === 0 || window.getSelection()?.toString() === currentInput) // 要么为空，要么输入框全选
        ) {
          event.preventDefault()
          if (event.key === 'ArrowUp') {
            const previousInput = getPreviousHistoryInputRef.current()
            if (previousInput !== undefined) {
              messageInputFieldRef.current?.setValue(previousInput)
              setTimeout(() => inputElement?.select(), 10)
            }
          } else if (event.key === 'ArrowDown') {
            const nextInput = getNextHistoryInputRef.current()
            if (nextInput !== undefined) {
              messageInputFieldRef.current?.setValue(nextInput)
              setTimeout(() => inputElement?.select(), 10)
            }
          }
        }

        // Prevent Chromium's native Escape behaviour which reverts textarea
        // value to its defaultValue, causing controlled-input state to desync.
        if (event.key === 'Escape') {
          event.preventDefault()
          messageInputFieldRef.current?.getElement()?.blur()
        }
      },
      [shortcuts, isSmallScreen]
    )

    const startNewThread = () => {
      const res = onStartNewThread?.()
      if (res) {
        setShowRollbackThreadButton(true)
      }
    }

    const rollbackThread = () => {
      const res = onRollbackThread?.()
      if (res) {
        setShowRollbackThreadButton(false)
      }
    }

    // ----- Preprocessing helpers -----
    const startLinkPreprocessing = (url: string) => {
      // 设置为处理中状态
      setPreConstructedMessage((prev) => markLinkProcessing(prev, url))

      // 异步预处理链接，失败时标记为 error，并吞掉异常避免 Promise.all reject
      const preprocessPromise = sessionHelpers
        .preprocessLink(url, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then((preprocessedLink) => {
          setPreConstructedMessage((prev) => onLinkProcessed(prev, url, preprocessedLink, 6))
        })
        .catch((error) => {
          setPreConstructedMessage((prev) =>
            onLinkProcessed(
              prev,
              url,
              {
                url,
                title: '',
                content: '',
                storageKey: '',
                error: (error as Error)?.message || 'Failed to preprocess the link.',
              },
              6
            )
          )
        })

      // Store the promise
      setPreConstructedMessage((prev) => storeLinkPromise(prev, url, preprocessPromise))
    }

    const startFilePreprocessing = (file: File) => {
      const fileKey = StorageKeyGenerator.fileUniqKey(file)
      inputFileKeyByFileRef.current.set(file, fileKey)
      activeFilePreprocessingKeysRef.current.add(fileKey)

      // 异步预处理文件，失败时标记为 error，并吞掉异常避免 Promise.all reject
      return sessionHelpers
        .prepareFileAttachment(file, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then(async (preprocessedFile) => {
          if (!activeFilePreprocessingKeysRef.current.has(fileKey)) {
            return
          }

          let nextPreprocessedFile: PreprocessedFile = { ...preprocessedFile, inputFileKey: fileKey }
          if (platform.type === 'desktop') {
            const draftMessageId = draftMessageIdRef.current || uuidv4()
            const indexedFile = await startPreparedSessionAttachmentIndexing({
              file,
              preparedFile: nextPreprocessedFile,
              sessionId: currentSessionId || 'new',
              draftMessageId,
              shouldContinue: () => activeFilePreprocessingKeysRef.current.has(fileKey),
            })
            if (!indexedFile) {
              return
            }
            nextPreprocessedFile = indexedFile
            if (indexedFile.draftMessageId) {
              draftMessageIdRef.current = indexedFile.draftMessageId
            }
          }

          setPreConstructedMessage((prev) =>
            onFileProcessed(prev, file, nextPreprocessedFile, 20, { fileKeys: [fileKey] })
          )
        })
        .catch((error) => {
          if (!activeFilePreprocessingKeysRef.current.has(fileKey)) {
            return
          }
          setPreConstructedMessage((prev) =>
            onFileProcessed(
              prev,
              file,
              {
                file,
                inputFileKey: fileKey,
                content: '',
                storageKey: '',
                error: (error as Error)?.message || 'Failed to preprocess the file.',
              },
              20,
              { fileKeys: [fileKey] }
            )
          )
        })
        .finally(() => {
          activeFilePreprocessingKeysRef.current.delete(fileKey)
        })
    }

    const insertLinks = (urls: string[]) => {
      const MAX_LINKS = 6
      const dedupedLinks = _.uniqBy([...(links || []), ...urls.map((u) => ({ url: u }))], 'url')
      // 保留最先添加的前 6 个链接，多出来的直接丢弃（而非静默丢掉最早的）
      const newLinks = dedupedLinks.slice(0, MAX_LINKS)
      setLinks(newLinks)

      if (dedupedLinks.length > newLinks.length) {
        toastActions.add(
          t('Only the first {{limit}} links can be attached. The extra links were skipped.', { limit: MAX_LINKS })
        )
      }

      // 只预处理实际保留下来的链接（findIndex 返回 -1 表示该链接已被裁剪，跳过）
      for (const url of urls) {
        const linkIndex = newLinks.findIndex((l) => l.url === url)
        if (linkIndex >= 0 && linkIndex < MAX_LINKS) {
          startLinkPreprocessing(url)
        }
      }
    }

    const insertFiles = async (files: File[]) => {
      const MAX_IMAGES = 8
      const MAX_AUDIO = 4
      const MAX_ATTACHMENTS = 20
      // 用本地累加器跟踪本次新增数量：同步循环内 state/ref 可能尚未刷新，靠它做无竞态的限额判断
      let imageCount = preConstructedMessageRef.current.pictureKeys?.length || 0
      let audioCount = preConstructedMessageRef.current.audioParts?.length || 0
      let attachmentCount = preConstructedMessageRef.current.attachments?.length || 0
      let droppedImages = 0
      let droppedAudio = 0
      let droppedAttachments = 0

      for (const file of files) {
        // 文件和图片插入方法复用，会导致 svg、gif 这类不支持的图片也被插入，但暂时没看到有什么问题
        if (file.type.startsWith('image/')) {
          // 超过上限时直接跳过：保留最先添加的前 8 张，且不浪费转码/不产生孤儿 blob
          if (imageCount >= MAX_IMAGES) {
            droppedImages++
            continue
          }
          const base64 = await picUtils.getImageBase64AndResize(file)
          const key = StorageKeyGenerator.picture('input-box')
          await saveBlob.mutateAsync({ key, value: base64 })
          setPreConstructedMessage((prev) => ({
            ...prev,
            pictureKeys: [...(prev.pictureKeys || []), key].slice(0, MAX_IMAGES), // 保留最先添加的前 8 张
          }))
          imageCount++
        } else if (file.type.startsWith('audio/')) {
          if (audioCount >= MAX_AUDIO) {
            droppedAudio++
            continue
          }
          const key = StorageKeyGenerator.audio('input-box')
          const dataUrl = await readFileAsDataUrl(file)
          await saveBlob.mutateAsync({ key, value: dataUrl })
          setPreConstructedMessage((prev) => ({
            ...prev,
            audioParts: [
              ...(prev.audioParts || []),
              {
                type: 'audio' as const,
                storageKey: key,
                mimeType: file.type || 'audio/mpeg',
              },
            ].slice(0, MAX_AUDIO),
          }))
          audioCount++
        } else {
          if (file.size > KNOWLEDGE_BASE_MAX_FILE_SIZE) {
            toastActions.add(
              t(
                'Chat attachments must be {{limit}} or smaller. Please upload larger documents through Knowledge Base.',
                {
                  limit: KNOWLEDGE_BASE_MAX_FILE_SIZE_LABEL,
                }
              )
            )
            continue
          }

          // Check if file type is supported
          if (!isSupportedFile(file.name)) {
            const unsupportedType = getUnsupportedFileType(file.name)
            let errorMsg = t('Unsupported file type: {{fileName}}', { fileName: file.name })
            if (unsupportedType === 'iwork') {
              errorMsg = t('iWork files (Pages, Keynote) are not supported. Please export to PDF or Office format.')
            } else if (unsupportedType === 'audio') {
              errorMsg = t('Audio files are not supported')
            } else if (unsupportedType === 'video') {
              errorMsg = t('Video files are not supported')
            } else if (unsupportedType === 'binary') {
              errorMsg = t('Binary/executable files are not supported')
            } else if (unsupportedType === 'archive') {
              errorMsg = t('Archive files are not supported. Please extract and upload individual files.')
            } else if (unsupportedType === 'image') {
              errorMsg = t('Advanced image formats are not supported. Please convert to JPG or PNG.')
            }
            toastActions.add(errorMsg)
            continue
          }

          // 已存在的文件视为重复（不占新增名额），新文件超过上限时直接跳过：保留最先添加的前 20 个
          const isDuplicate = (preConstructedMessageRef.current.attachments || []).some(
            (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
          )
          if (!isDuplicate && attachmentCount >= MAX_ATTACHMENTS) {
            droppedAttachments++
            continue
          }

          setPreConstructedMessage((prev) => {
            const draftMessageId = prev.draftMessageId || draftMessageIdRef.current || uuidv4()
            draftMessageIdRef.current = draftMessageId
            const newAttachments = prev.attachments.find(
              (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
            )
              ? prev.attachments
              : [...(prev.attachments || []), file].slice(0, MAX_ATTACHMENTS) // 保留最先添加的前 20 个

            // 只预处理实际保留下来的文件（findIndex 返回 -1 表示已被裁剪，跳过，避免残留状态阻塞发送）
            const fileIndex = newAttachments.findIndex(
              (f) => f.name === file.name && f.lastModified === file.lastModified
            )
            if (fileIndex >= 0 && fileIndex < MAX_ATTACHMENTS) {
              const preprocessPromise = startFilePreprocessing(file)
              return {
                ...storeFilePromise(markFileProcessing({ ...prev, draftMessageId }, file), file, preprocessPromise),
                attachments: newAttachments,
              }
            }

            return {
              ...prev,
              draftMessageId,
              attachments: newAttachments,
            }
          })
          if (!isDuplicate) {
            attachmentCount++
          }
        }
      }

      if (droppedImages > 0) {
        toastActions.add(
          t('You can attach up to {{limit}} images. The extra images were skipped.', { limit: MAX_IMAGES })
        )
      }
      if (droppedAudio > 0) {
        toastActions.add(`最多可发送 ${MAX_AUDIO} 条语音，超出的音频已跳过。`)
      }
      if (droppedAttachments > 0) {
        toastActions.add(
          t('You can attach up to {{limit}} files. The extra files were skipped.', { limit: MAX_ATTACHMENTS })
        )
      }
    }
    insertFilesRef.current = insertFiles
    insertLinksRef.current = insertLinks

    const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) {
        return
      }
      insertFiles(Array.from(event.target.files))
      event.target.value = ''
      dom.focusMessageInput()
    }

    const onImageUploadClick = () => {
      pictureInputRef.current?.click()
    }
    const onFileUploadClick = () => {
      fileInputRef.current?.click()
    }

    const onImageDeleteClick = async (picKey: string) => {
      setPreConstructedMessage((prev) => ({
        ...prev,
        pictureKeys: (prev.pictureKeys || []).filter((k) => k !== picKey),
      }))
      // 不删除图片数据，因为可能在其他地方引用，比如通过上下键盘的历史消息快捷输入、发送的消息中引用
      // await storage.delBlob(picKey)
    }

    const onPaste = useCallback(
      (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (sessionType === 'picture') {
          return
        }
        if (event.clipboardData?.items) {
          // 对于 Doc/PPT/XLS 等文件中的内容，粘贴时一般会有 4 个 items，分别是 text 文本、html、某格式和图片
          // 因为 getAsString 为异步操作，无法根据 items 中的内容来定制不同的粘贴行为，因此这里选择了最简单的做法：
          // 保持默认的粘贴行为，这时候会粘贴从文档中复制的文本和图片。我认为应该保留图片，因为文档中的表格、图表等图片信息也很重要，很难通过文本格式来表述。
          // 仅在只粘贴图片或文件时阻止默认行为，防止插入文件或图片的名字
          let hasText = false
          // Capture pre-paste text before async getAsString callback runs (browser will have inserted pasted text by then)
          const prePasteText = latestInputRef.current
          for (let i = 0; i < event.clipboardData.items.length; i++) {
            const item = event.clipboardData.items[i]
            if (item.kind === 'file') {
              // Insert files and images
              const file = item.getAsFile()
              if (file) {
                insertFilesRef.current([file])
              }
              continue
            }
            hasText = true
            if (item.kind === 'string' && item.type === 'text/plain') {
              // 插入链接：如果复制的是链接，则插入链接
              item.getAsString((text) => {
                const raw = text.trim()
                if (raw.startsWith('http://') || raw.startsWith('https://')) {
                  const urls = raw
                    .split(/\s+/)
                    .map((url) => url.trim())
                    .filter((url) => url.startsWith('http://') || url.startsWith('https://'))
                  insertLinksRef.current(urls)
                }
                if (pasteLongTextAsAFile && raw.length > 3000) {
                  const file = new File([text], `pasted_text_${Date.now()}.txt`, {
                    type: 'text/plain',
                  })
                  insertFilesRef.current([file])
                  messageInputFieldRef.current?.setValue(prePasteText) // 删除掉默认粘贴进去的长文本
                }
              })
            }
          }
          // 如果没有任何文本，则说明只是复制了图片或文件。这里阻止默认行为，防止插入文件或图片的名字
          if (!hasText) {
            event.preventDefault()
          }
        }
      },
      [sessionType, pasteLongTextAsAFile]
    )

    const handleAttachLink = async () => {
      const links: string[] = await NiceModal.show('attach-link')
      if (links) {
        insertLinks(links)
      }
    }

    // 拖拽上传
    const { getRootProps, getInputProps } = useDropzone({
      onDrop: (acceptedFiles: File[], fileRejections) => {
        insertFiles(acceptedFiles)
        // Show toast for rejected files
        if (fileRejections.length > 0) {
          const rejectedNames = fileRejections.map((r) => r.file.name).join(', ')
          toastActions.add(t('Unsupported file type: {{fileName}}', { fileName: rejectedNames }))
        }
      },
      accept: getFileAcceptConfig(),
      noClick: true,
      noKeyboard: true,
    })

    // 引用消息
    const quote = useUIStore((state) => state.quote)
    const setQuote = useUIStore((state) => state.setQuote)
    // const [quote, setQuote] = useUIStore(state => [state]) useAtom(atoms.quoteAtom)
    // biome-ignore lint/correctness/useExhaustiveDependencies: todo
    useEffect(() => {
      if (quote !== '') {
        // TODO: 支持引用消息中的图片
        // TODO: 支持引用消息中的文件
        setQuote('')
        messageInputFieldRef.current?.setValue((val) => {
          const newValue = !val
            ? quote
            : val + '\n'.repeat(Math.max(0, 2 - (val.match(/(\n)+$/)?.[0].length || 0))) + quote
          return newValue
        })
        // setPreviousMessageQuickInputMark('')
        dom.focusMessageInput()
        dom.setMessageInputCursorToEnd()
      }
    }, [quote])

    const handleKnowledgeBaseSelect = useCallback(
      (kb: KnowledgeBase | null) => {
        if (!kb || kb.id === knowledgeBase?.id) {
          setKnowledgeBase(undefined)
          trackEvent('knowledge_base_disabled', { knowledge_base_name: knowledgeBase?.name })
        } else {
          setKnowledgeBase(pick(kb, 'id', 'name'))
          trackEvent('knowledge_base_enabled', { knowledge_base_name: kb.name })
        }
      },
      [knowledgeBase, setKnowledgeBase]
    )

    // Show deprecated notice for legacy picture sessions
    if (sessionType === 'picture') {
      return (
        <Box pt={0} pb={isSmallScreen ? 'md' : 'sm'} px="sm" id={dom.InputBoxID}>
          <Stack
            className={cn('rounded-2xl bg-chatbox-background-secondary', widthFull ? 'w-full' : 'max-w-4xl mx-auto')}
            gap="xs"
            p="md"
            align="center"
          >
            <Text size="sm" c="chatbox-tertiary" ta="center">
              {t('This image session is no longer active. Please use the new Image Creator for image generation.')}
            </Text>
            <Button variant="light" size="xs" onClick={() => navigate({ to: '/image-creator' })}>
              {t('Go to Image Creator')}
            </Button>
          </Stack>
        </Box>
      )
    }

    return (
      <Box
        className="v2chat-chat-input"
        pt={0}
        pb={isSmallScreen ? 'md' : 'sm'}
        px="sm"
        id={dom.InputBoxID}
        {...getRootProps()}
      >
        <input className="hidden" {...getInputProps()} />
        <Stack className={cn(widthFull ? 'w-full' : 'max-w-4xl mx-auto')} gap="xs">
          {currentSessionId && <CompactionStatus sessionId={currentSessionId} />}
          <Stack
            className={cn(
              'v2chat-input-elevated v2chat-chat-input__panel justify-between px-3 py-2',
              !isSmallScreen && 'min-h-[92px]'
            )}
            gap="xs"
          >
            {!isSmallScreen && (
              <Flex className="v2chat-chat-input__quickbar" gap={6} wrap="wrap">
                {tavernQuickActions.map((action) => (
                  <Tooltip key={action.id} label={action.hint} withArrow position="top">
                    <UnstyledButton
                      className={cn(
                        'v2chat-chat-input__quick-action',
                        activeTavernQuickActionId === action.id && 'is-active'
                      )}
                      onClick={() => applyTavernQuickAction(action.id)}
                    >
                      <ScalableIcon icon={action.icon} size={14} />
                      <span>{action.label}</span>
                    </UnstyledButton>
                  </Tooltip>
                ))}
              </Flex>
            )}

            {activeTavernQuickAction && (
              <Flex className="v2chat-chat-input__mode-hint" align="center" gap={6}>
                <ScalableIcon icon={activeTavernQuickAction.icon} size={14} />
                <Text span size="xs" className="v2chat-chat-input__mode-hint-text">
                  {activeTavernQuickAction.label}
                </Text>
                <Text span size="xs" className="v2chat-chat-input__mode-hint-desc">
                  {activeTavernQuickAction.hint}
                </Text>
                <UnstyledButton
                  className="v2chat-chat-input__mode-clear"
                  onClick={() => setActiveTavernQuickActionId(null)}
                  aria-label="取消快捷模式"
                >
                  <ScalableIcon icon={IconX} size={13} />
                </UnstyledButton>
              </Flex>
            )}

            {/* Input Row */}
            {useImComposer && (
              <Flex align="center" gap={8} className="v2chat-mobile-composer">
                <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={onFileInputChange}
                  multiple
                  accept={getFileAcceptString()}
                />

                <Menu trigger="click" position="top-start" shadow="md" keepMounted>
                  <Menu.Target>
                    <ActionIcon className="v2chat-mobile-composer__icon" variant="subtle" radius="xl" aria-label="更多玩法">
                      <ScalableIcon icon={IconGridDots} size={27} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {tavernQuickActions.map((action) => (
                      <Menu.Item
                        key={action.id}
                        leftSection={<ScalableIcon icon={action.icon} size={16} />}
                        rightSection={
                          activeTavernQuickActionId === action.id ? (
                            <Text size="xs" c="chatbox-brand">
                              已选
                            </Text>
                          ) : undefined
                        }
                        onClick={() => applyTavernQuickAction(action.id)}
                      >
                        {action.label}
                      </Menu.Item>
                    ))}
                    <Menu.Divider />
                    <Menu.Item leftSection={<ScalableIcon icon={IconPlus} size={16} />} onClick={startNewThread}>
                      {t('New Thread')}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<ScalableIcon icon={IconAdjustmentsHorizontal} size={16} />}
                      onClick={onClickSessionSettings}
                    >
                      {t('Conversation Settings')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>

                <Box
                  className={cn('v2chat-mobile-composer__field', isRecording && 'is-recording')}
                  onClick={() => {
                    if (!isRecording) dom.focusMessageInput()
                  }}
                >
                  <Box className="v2chat-mobile-composer__input-content">
                    <MessageInputField
                      ref={messageInputFieldRef}
                      isNewSession={isNewSession}
                      isSmallScreen={isSmallScreen}
                      viewportHeight={viewportHeight}
                      isReadOnly={isCompactionRunning}
                      placeholder={
                        activeTavernQuickAction
                          ? `${activeTavernQuickAction.label}：补一句要求...`
                          : '发消息或按住说话...'
                      }
                      autoFocus={!isSmallScreen}
                      onValueChange={onMessageInputValueChange}
                      onUserInput={onUserInput}
                      onKeyDown={onKeyDown}
                      onPaste={onPaste}
                    />
                  </Box>
                  {isRecording && (
                    <Flex
                      align="center"
                      gap={8}
                      className={cn('v2chat-recording-state', isPressToTalkCancelling && 'is-cancelling')}
                    >
                      <span className="v2chat-recording-state__dot" />
                      <span className="v2chat-recording-state__wave" aria-hidden>
                        {Array.from({ length: 5 }, (_, index) => (
                          <i key={index} />
                        ))}
                      </span>
                      <Text span size="sm" fw={700} className="v2chat-recording-state__text">
                        {isPressToTalkActive
                          ? isPressToTalkCancelling
                            ? '松开取消'
                            : '松开发送 · 上滑取消'
                          : '录音中'}{' '}
                        {formatDuration(recordingDurationMs)}
                      </Text>
                    </Flex>
                  )}
                </Box>

                <Tooltip label={model ? modelSelectorDisplayText : t('Please select a model')} withArrow>
                  <Box className="v2chat-mobile-composer__model-wrap">
                    <ModelSelector
                      onSelect={handleModelSelect}
                      selectedProviderId={model?.provider}
                      selectedModelId={model?.modelId}
                      modelFilter={(_, providerId) => providerId === ModelProviderEnum.V2APIOpenAI}
                      unified
                    >
                      <ActionIcon
                        className={cn('v2chat-mobile-composer__icon v2chat-mobile-model-icon', !model && 'is-empty')}
                        variant="subtle"
                        radius="xl"
                        aria-label="切换模型"
                      >
                        <ScalableIcon icon={IconBrain} size={24} />
                      </ActionIcon>
                    </ModelSelector>
                  </Box>
                </Tooltip>

                <Tooltip
                  label={
                    isPressToTalkActive
                      ? `松开发送 ${formatDuration(recordingDurationMs)}`
                      : isRecording
                        ? `停止录音 ${formatDuration(recordingDurationMs)}`
                        : '按住说话，松开发送'
                  }
                  withArrow
                >
                  <ActionIcon
                    disabled={!isRecording && (isSubmitting || isCompactionRunning || generating)}
                    className={cn('v2chat-mobile-composer__icon v2chat-record-button', isPressToTalkActive && 'is-pressing')}
                    variant="subtle"
                    radius="xl"
                    onPointerDown={handleRecordingPointerDown}
                    onPointerMove={handleRecordingPointerMove}
                    onPointerUp={handleRecordingPointerUp}
                    onPointerCancel={handleRecordingPointerCancel}
                    onPointerLeave={(event) => {
                      if (!isPressToTalkActive) {
                        clearPressToTalkTimer()
                        pressToTalkPointerIdRef.current = null
                        event.currentTarget.releasePointerCapture?.(event.pointerId)
                      }
                    }}
                    onClick={handleRecordingClick}
                    aria-label={isPressToTalkActive ? '松开发送语音' : isRecording ? '停止录音' : '按住说话'}
                  >
                    <ScalableIcon icon={isRecording ? IconPlayerStopFilled : IconMicrophone} size={24} />
                  </ActionIcon>
                </Tooltip>

                {hasTextContent ||
                pictureKeys.length ||
                audioParts.length ||
                attachments.length ||
                links.length ||
                generating ? (
                  <ActionIcon
                    disabled={
                      (disableSubmit ||
                        isPreprocessing ||
                        isSubmitting ||
                        isCompactionRunning ||
                        hasPreprocessErrors ||
                        hasBlockedSessionRagFiles) &&
                      !generating
                    }
                    className="v2chat-mobile-composer__icon v2chat-mobile-composer__send"
                    variant="filled"
                    radius="xl"
                    onClick={generating ? onStopGenerating : () => handleSubmit()}
                    aria-label={generating ? '停止生成' : '发送'}
                  >
                    <ScalableIcon icon={generating ? IconPlayerStopFilled : IconArrowUp} size={22} />
                  </ActionIcon>
                ) : (
                  <Box className="v2chat-mobile-composer__attachment">
                    <AttachmentMenu
                      onImageUploadClick={onImageUploadClick}
                      onFileUploadClick={onFileUploadClick}
                      handleAttachLink={handleAttachLink}
                      t={t}
                    />
                  </Box>
                )}
              </Flex>
            )}

            {!useImComposer && (
            <Flex align="flex-end" gap={4}>
              <MessageInputField
                ref={messageInputFieldRef}
                isNewSession={isNewSession}
                isSmallScreen={isSmallScreen}
                viewportHeight={viewportHeight}
                isReadOnly={isCompactionRunning}
                placeholder={
                  activeTavernQuickAction
                    ? `${activeTavernQuickAction.label}：可直接发送，也可以补充一句要求...`
                    : isSmallScreen
                      ? '发消息或按住说话...'
                      : '输入台词、动作，或让角色继续剧情...'
                }
                autoFocus={!isSmallScreen}
                onValueChange={onMessageInputValueChange}
                onUserInput={onUserInput}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />

              <Tooltip
                label={
                  isPressToTalkActive
                    ? `松开发送 ${formatDuration(recordingDurationMs)}`
                    : isRecording
                      ? `停止录音 ${formatDuration(recordingDurationMs)}`
                      : '按住说话，松开发送；短按可切换录音'
                }
                withArrow
              >
                <ActionIcon
                  disabled={!isRecording && (isSubmitting || isCompactionRunning || generating)}
                  size={32}
                  variant={isRecording ? 'filled' : 'subtle'}
                  color={isRecording ? 'red' : 'chatbox-brand'}
                  radius="xl"
                  onPointerDown={handleRecordingPointerDown}
                  onPointerMove={handleRecordingPointerMove}
                  onPointerUp={handleRecordingPointerUp}
                  onPointerCancel={handleRecordingPointerCancel}
                  onPointerLeave={(event) => {
                    if (!isPressToTalkActive) {
                      clearPressToTalkTimer()
                      pressToTalkPointerIdRef.current = null
                      event.currentTarget.releasePointerCapture?.(event.pointerId)
                    }
                  }}
                  onClick={handleRecordingClick}
                  aria-label={isPressToTalkActive ? '松开发送语音' : isRecording ? '停止录音' : '按住说话'}
                  className={cn('v2chat-record-button shrink-0 mb-1', isPressToTalkActive && 'is-pressing')}
                >
                  <ScalableIcon icon={isRecording ? IconPlayerStopFilled : IconMicrophone} size={16} />
                </ActionIcon>
              </Tooltip>

              {/* Send Button */}
              <ActionIcon
                disabled={
                  (disableSubmit ||
                    isPreprocessing ||
                    isSubmitting ||
                    isCompactionRunning ||
                    hasPreprocessErrors ||
                    hasBlockedSessionRagFiles) &&
                  !generating
                }
                size={32}
                variant="filled"
                color={generating ? 'dark' : 'chatbox-brand'}
                radius="xl"
                onClick={generating ? onStopGenerating : () => handleSubmit()}
                className={cn(
                  'shrink-0 mb-1',
                  !generating &&
                    (disableSubmit ||
                      isPreprocessing ||
                      isSubmitting ||
                      isCompactionRunning ||
                      hasPreprocessErrors ||
                      hasBlockedSessionRagFiles) &&
                    'disabled:!opacity-100 !text-white'
                )}
                style={
                  !generating &&
                  (disableSubmit ||
                    isPreprocessing ||
                    isSubmitting ||
                    isCompactionRunning ||
                    hasPreprocessErrors ||
                    hasBlockedSessionRagFiles)
                    ? { backgroundColor: 'rgba(255, 255, 255, 0.12)', color: 'rgba(255, 248, 251, 0.52)' }
                    : undefined
                }
              >
                {generating ? (
                  <ScalableIcon icon={IconPlayerStopFilled} size={16} />
                ) : (
                  <ScalableIcon icon={IconArrowUp} size={16} />
                )}
              </ActionIcon>
            </Flex>
            )}

            {(!!pictureKeys.length || !!audioParts.length || !!attachments.length || !!links.length) && (
              <Flex
                align="center"
                wrap="wrap"
                className="max-h-[30vh] overflow-y-auto"
                onClick={() => dom.focusMessageInput()}
              >
                {showSessionRetrievalToolWarning && (
                  <Flex
                    role="status"
                    aria-live="polite"
                    align="center"
                    gap={8}
                    className="w-full rounded-md px-2.5 py-2 mb-1"
                    style={{
                      border: '1px solid var(--chatbox-border-primary)',
                      borderLeft: '3px solid var(--chatbox-tint-warning)',
                      background: 'var(--chatbox-background-primary)',
                    }}
                  >
                    <Box
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: 'var(--chatbox-background-secondary)',
                        color: 'var(--chatbox-tint-warning)',
                      }}
                    >
                      <ScalableIcon icon={IconAlertCircle} size={14} />
                    </Box>
                    <Text size="xs" lh={1.35} c="chatbox-warning" className="min-w-0">
                      {t(
                        'This model may not be able to read the uploaded document. Try another model if you want to ask about the file.'
                      )}
                    </Text>
                  </Flex>
                )}
                {hasLargeAttachmentWarning && (
                  <Flex
                    role="status"
                    aria-live="polite"
                    align="center"
                    gap={8}
                    className="w-full rounded-md px-2.5 py-2 mb-1"
                    style={{
                      border: '1px solid var(--chatbox-border-primary)',
                      borderLeft: '3px solid var(--chatbox-tint-warning)',
                      background: 'var(--chatbox-background-primary)',
                    }}
                  >
                    <Box
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{
                        width: 20,
                        height: 20,
                        background: 'var(--chatbox-background-secondary)',
                        color: 'var(--chatbox-tint-warning)',
                      }}
                    >
                      <ScalableIcon icon={IconAlertCircle} size={14} />
                    </Box>
                    <Text size="xs" lh={1.35} c="chatbox-warning" className="min-w-0">
                      {t(
                        'This attachment is very large and may consume more points. You can send it anyway, or remove it and use a smaller file.'
                      )}
                    </Text>
                  </Flex>
                )}
                {pictureKeys?.map((picKey) => (
                  <ImageMiniCard key={picKey} storageKey={picKey} onDelete={() => onImageDeleteClick(picKey)} />
                ))}
                {audioParts?.map((part, index) => (
                  <Flex
                    key={part.storageKey}
                    align="center"
                    gap={6}
                    className="m-1 px-2 py-1 rounded-full bg-chatbox-background-secondary border border-solid border-chatbox-border-primary"
                  >
                    <Text size="xs" c="chatbox-secondary">
                      语音条 {index + 1}
                    </Text>
                    <ActionIcon
                      size={18}
                      variant="subtle"
                      color="chatbox-tertiary"
                      onClick={(event) => {
                        event.stopPropagation()
                        setPreConstructedMessage((prev) => ({
                          ...prev,
                          audioParts: (prev.audioParts || []).filter((item) => item.storageKey !== part.storageKey),
                        }))
                      }}
                    >
                      <ScalableIcon icon={IconX} size={14} />
                    </ActionIcon>
                  </Flex>
                ))}
                {attachments?.map((file) => {
                  const fileKey = inputFileKeyByFileRef.current.get(file) ?? StorageKeyGenerator.fileUniqKey(file)
                  const status = preConstructedMessage.preprocessingStatus.files[fileKey]
                  const preprocessedFile = preConstructedMessage.preprocessedFiles.find(
                    (f) => f.inputFileKey === fileKey || StorageKeyGenerator.fileUniqKey(f.file) === fileKey
                  )
                  const effectiveIndexStatus = preprocessedFile?.sessionAttachmentId
                    ? (preprocessedAttachmentIndexStatusMap.get(preprocessedFile.sessionAttachmentId) ??
                      preprocessedFile.sessionAttachmentIndexStatus)
                    : preprocessedFile?.sessionAttachmentIndexStatus
                  const effectiveAttachmentError = preprocessedFile?.sessionAttachmentId
                    ? (preprocessedAttachmentErrorMap.get(preprocessedFile.sessionAttachmentId) ??
                      preprocessedFile?.error)
                    : preprocessedFile?.error
                  const attachmentProgress = preprocessedFile?.sessionAttachmentId
                    ? preprocessedAttachmentProgressMap.get(preprocessedFile.sessionAttachmentId)
                    : undefined
                  const totalChunks =
                    attachmentProgress?.totalChunks ?? preprocessedFile?.sessionAttachmentTotalChunks ?? 0
                  const embeddedChunks =
                    attachmentProgress?.embeddedChunks ?? preprocessedFile?.sessionAttachmentEmbeddedChunks ?? 0
                  const indexingStage =
                    attachmentProgress?.indexingStage ?? preprocessedFile?.sessionAttachmentIndexingStage
                  const progressValue = getSessionAttachmentProgressValue(embeddedChunks, totalChunks)
                  const isSessionAttachmentTakingLong =
                    !!attachmentProgress?.processingStartedAt &&
                    effectiveIndexStatus !== 'ready' &&
                    Date.now() - attachmentProgress.processingStartedAt > 30000
                  const statusText =
                    preprocessedFile?.ragMode === 'session-retrieval' && effectiveIndexStatus !== 'ready'
                      ? progressValue !== undefined
                        ? `${isSessionAttachmentTakingLong ? t('Still indexing') : getSessionAttachmentStageLabel(indexingStage, t)} · ${progressValue}%`
                        : isSessionAttachmentTakingLong
                          ? t('Still indexing')
                          : getSessionAttachmentStageLabel(indexingStage, t)
                      : status === 'processing'
                        ? t('Preparing')
                        : undefined
                  return (
                    <FileMiniCard
                      key={fileKey}
                      name={file.name}
                      fileType={file.type}
                      status={
                        effectiveAttachmentError
                          ? 'error'
                          : preprocessedFile?.ragMode === 'session-retrieval'
                            ? effectiveIndexStatus === 'ready'
                              ? 'completed'
                              : 'processing'
                            : status
                      }
                      statusText={statusText}
                      progressValue={progressValue}
                      isTakingLong={isSessionAttachmentTakingLong}
                      errorMessage={effectiveAttachmentError}
                      onErrorClick={() => {
                        const errorCode = effectiveAttachmentError
                        if (errorCode) {
                          void NiceModal.show('file-parse-error', {
                            errorCode,
                            fileName: file.name,
                          })
                        }
                      }}
                      onPreviewClick={
                        preprocessedFile?.storageKey
                          ? () => {
                              void NiceModal.show('content-viewer', {
                                title: `${t('File Content')}: ${file.name}`,
                                storageKey: preprocessedFile.storageKey,
                              })
                            }
                          : undefined
                      }
                      onDelete={() => {
                        const fileKeysToRemove = new Set([fileKey])
                        // Cancel any ongoing MinerU parsing for this file
                        const filePath = platform.getLocalFilePath(file)
                        fileKeysToRemove.add(StorageKeyGenerator.fileUniqKey(file))
                        for (const key of fileKeysToRemove) {
                          activeFilePreprocessingKeysRef.current.delete(key)
                        }
                        if (filePath && platform.cancelMineruParse) {
                          platform.cancelMineruParse(filePath).catch(() => {
                            // Ignore cancellation errors
                          })
                        }
                        if (platform.type === 'desktop' && preprocessedFile?.sessionAttachmentId) {
                          void platform
                            .getSessionAttachmentRagController()
                            .deleteAttachment(preprocessedFile.sessionAttachmentId)
                            .catch(() => {
                              // Ignore cancellation errors
                            })
                        }
                        setPreConstructedMessage((prev) =>
                          cleanupFile(prev, file, { fileKeys: fileKeysToRemove, removeAttachment: true })
                        )
                      }}
                    />
                  )
                })}
                {links?.map((link) => {
                  const linkKey = StorageKeyGenerator.linkUniqKey(link.url)
                  const status = preConstructedMessage.preprocessingStatus.links[linkKey]
                  const preprocessedLink = preConstructedMessage.preprocessedLinks.find(
                    (l) => StorageKeyGenerator.linkUniqKey(l.url) === linkKey
                  )
                  return (
                    <LinkMiniCard
                      key={linkKey}
                      url={link.url}
                      status={status}
                      errorMessage={preprocessedLink?.error}
                      onErrorClick={() => {
                        if (preprocessedLink?.error) {
                          void NiceModal.show('file-parse-error', {
                            errorCode: preprocessedLink.error,
                            fileName: link.url,
                          })
                        }
                      }}
                      onDelete={() => {
                        setLinks(links.filter((l) => l.url !== link.url))
                        setPreConstructedMessage((prev) => cleanupLink(prev, link.url))
                      }}
                    />
                  )
                })}
              </Flex>
            )}

            {/* Toolbar Row */}
            {!useImComposer && (
            <Flex align="center" gap={0} className="v2chat-chat-input__toolbar shrink-0 w-full" justify="space-between">
              {/* Hidden file inputs */}
              <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={onFileInputChange}
                multiple
                accept={getFileAcceptString()}
              />

              {/* Left Group: Tool Buttons */}
              <Flex align="center" gap={0}>
                <AttachmentMenu
                  onImageUploadClick={onImageUploadClick}
                  onFileUploadClick={onFileUploadClick}
                  handleAttachLink={handleAttachLink}
                  t={t}
                />

                {featureFlags.mcp && (
                  <MCPMenu>
                    {(enabledTools) => (
                      <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                        <IconHammer
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className={
                            enabledTools > 0
                              ? 'text-[var(--chatbox-tint-brand)]'
                              : 'text-[var(--chatbox-tint-secondary)]'
                          }
                        />
                        {enabledTools > 0 && (
                          <Text size="xs" className="text-[var(--chatbox-tint-brand)]">
                            {enabledTools}
                          </Text>
                        )}
                      </UnstyledButton>
                    )}
                  </MCPMenu>
                )}

                {featureFlags.knowledgeBase && !isSmallScreen && (
                  <KnowledgeBaseMenu currentKnowledgeBaseId={knowledgeBase?.id} onSelect={handleKnowledgeBaseSelect}>
                    <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                      <IconVocabulary
                        size={toolbarIconSize}
                        strokeWidth={1.8}
                        className={
                          knowledgeBase ? 'text-[var(--chatbox-tint-brand)]' : 'text-[var(--chatbox-tint-secondary)]'
                        }
                      />
                    </UnstyledButton>
                  </KnowledgeBaseMenu>
                )}

                <Tooltip label={t('Web Search')} position="top" withArrow disabled={isSmallScreen}>
                  <UnstyledButton
                    onClick={() => {
                      setWebBrowsingMode(!webBrowsingMode)
                      dom.focusMessageInput()
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
                  >
                    <IconWorldWww
                      size={toolbarIconSize}
                      strokeWidth={1.8}
                      className={
                        webBrowsingMode ? 'text-[var(--chatbox-tint-brand)]' : 'text-[var(--chatbox-tint-secondary)]'
                      }
                    />
                  </UnstyledButton>
                </Tooltip>

                {!isSmallScreen &&
                  (showRollbackThreadButton ? (
                    <Tooltip label={t('Rollback Thread')} position="top" withArrow>
                      <UnstyledButton
                        onClick={rollbackThread}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
                      >
                        <IconArrowBackUp
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--chatbox-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Tooltip>
                  ) : (
                    <Tooltip label={t('New Thread')} position="top" withArrow>
                      <UnstyledButton
                        onClick={startNewThread}
                        disabled={!onStartNewThread}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors disabled:opacity-50"
                      >
                        <IconFilePencil
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--chatbox-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Tooltip>
                  ))}

                {!isSmallScreen && (
                  <Tooltip label={t('Conversation Settings')} position="top" withArrow>
                    <UnstyledButton
                      onClick={onClickSessionSettings}
                      disabled={!onClickSessionSettings}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors disabled:opacity-50"
                    >
                      <IconAdjustmentsHorizontal
                        size={toolbarIconSize}
                        strokeWidth={1.8}
                        className="text-[var(--chatbox-tint-secondary)]"
                      />
                    </UnstyledButton>
                  </Tooltip>
                )}

                {/* Mobile: Settings menu */}
                {isSmallScreen && (
                  <Menu
                    trigger="click"
                    openDelay={100}
                    closeDelay={100}
                    keepMounted
                    transitionProps={{
                      transition: 'pop',
                      duration: 200,
                    }}
                  >
                    <Menu.Target>
                      <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                        <IconSettings
                          size={toolbarIconSize}
                          strokeWidth={1.8}
                          className="text-[var(--chatbox-tint-secondary)]"
                        />
                      </UnstyledButton>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {tavernQuickActions.map((action) => (
                        <Menu.Item
                          key={action.id}
                          leftSection={<ScalableIcon icon={action.icon} size={16} />}
                          rightSection={
                            activeTavernQuickActionId === action.id ? (
                              <Text size="xs" c="chatbox-brand">
                                已选
                              </Text>
                            ) : undefined
                          }
                          onClick={() => applyTavernQuickAction(action.id)}
                        >
                          {action.label}
                        </Menu.Item>
                      ))}
                      <Menu.Divider />
                      <Menu.Item leftSection={<ScalableIcon icon={IconPlus} size={16} />} onClick={startNewThread}>
                        {t('New Thread')}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<ScalableIcon icon={IconAdjustmentsHorizontal} size={16} />}
                        onClick={onClickSessionSettings}
                      >
                        {t('Conversation Settings')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Flex>

              {/* Right Group: Token Count + Model Selector */}
              <Flex align="center" gap={0} className="min-w-0 ml-auto">
                <TokenCountMenu
                  currentInputTokens={currentInputTokens}
                  contextTokens={contextTokens}
                  totalTokens={totalTokens}
                  isCalculating={isCalculating}
                  pendingTasks={pendingTasks}
                  totalContextMessages={messageCount}
                  contextWindow={effectiveContextWindow ?? undefined}
                  currentMessageCount={currentContextMessageIds?.length ?? 0}
                  maxContextMessageCount={currentSessionMergedSettings?.maxContextMessageCount}
                  onCompressClick={sessionId && !isNewSession ? () => setShowCompressionModal(true) : undefined}
                  autoCompactionEnabled={autoCompactionEnabled}
                  isCompacting={isCompacting}
                  contextWindowKnown={contextWindowKnown}
                  onAutoCompactionChange={sessionId && !isNewSession ? handleAutoCompactionChange : undefined}
                >
                  <Flex
                    align="center"
                    gap="2"
                    className={`v2chat-token-pill shrink-0 text-xs cursor-pointer transition-colors px-2 py-1 rounded-lg ${
                      tokenPercentage && tokenPercentage > 80 ? 'text-red-500' : 'text-chatbox-tint-tertiary'
                    }`}
                  >
                    <ScalableIcon icon={IconArrowUp} size={14} />
                    {isCalculating && <Loader size={10} />}
                    <Text span size="xs" className="whitespace-nowrap" c="inherit">
                      {isCalculating ? '~' : ''}
                      {formatNumber(totalTokens)}
                      {tokenPercentage !== null && tokenPercentage > 10 && ` (${tokenPercentage}%)`}
                    </Text>
                  </Flex>
                </TokenCountMenu>

                {/* Model Selector */}
                <Box className="min-w-0 flex-1 justify-end max-w-[200px]">
                  <Tooltip
                    label={
                      <Flex align="center" c="white" gap="xxs" min-w-0>
                        <ScalableIcon icon={IconAlertCircle} size={12} className="text-inherit" />
                        <Text span size="xxs" c="white">
                          {t('Please select a model')}
                        </Text>
                      </Flex>
                    }
                    color="dark"
                    opened={showSelectModelErrorTip}
                    withArrow
                  >
                    <ModelSelector
                      onSelect={handleModelSelect}
                      selectedProviderId={model?.provider}
                      selectedModelId={model?.modelId}
                      position="top-end"
                      transitionProps={{
                        transition: 'fade-up',
                        duration: 200,
                      }}
                      modelFilter={(_, providerId) => providerId === ModelProviderEnum.V2APIOpenAI}
                      unified
                    >
                      <UnstyledButton
                        className={cn(
                          'v2chat-model-selector-trigger flex min-w-0 max-w-full items-center gap-1 px-2 py-1 rounded-lg transition-colors',
                          !model && 'animate-pulse bg-blue-500/20'
                        )}
                      >
                        <Text
                          size="sm"
                          className={cn(
                            'v2chat-model-selector-trigger__text min-w-0 flex-1 truncate',
                            isSmallScreen ? 'max-w-[100px]' : 'max-w-[160px]'
                          )}
                        >
                          {modelSelectorDisplayText}
                        </Text>
                        <IconChevronRight
                          size={14}
                          className="text-[var(--chatbox-tint-tertiary)] rotate-90 flex-shrink-0"
                        />
                      </UnstyledButton>
                    </ModelSelector>
                  </Tooltip>
                </Box>
              </Flex>
            </Flex>
            )}
          </Stack>
        </Stack>
        {currentSession && (
          <CompressionModal
            opened={showCompressionModal}
            onClose={() => setShowCompressionModal(false)}
            session={currentSession}
          />
        )}
        <AdaptiveModal
          opened={unreadyAttachmentSubmitPrompt.opened}
          onClose={() => setUnreadyAttachmentSubmitPrompt((prev) => ({ ...prev, opened: false }))}
          title={t('Document is still indexing')}
          centered
          size="sm"
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t(
                '{{count}} document(s) are still being prepared. If you send now, the answer may not use the full document.',
                { count: unreadyAttachmentSubmitPrompt.count }
              )}
            </Text>
            <AdaptiveModal.Actions>
              <Button
                variant="default"
                onClick={() => setUnreadyAttachmentSubmitPrompt((prev) => ({ ...prev, opened: false }))}
              >
                {t('Wait')}
              </Button>
              <Button
                onClick={() => {
                  setUnreadyAttachmentSubmitPrompt((prev) => ({ ...prev, opened: false }))
                  void handleSubmit(true, { allowUnreadySessionAttachments: true })
                }}
              >
                {t('Send anyway')}
              </Button>
            </AdaptiveModal.Actions>
          </Stack>
        </AdaptiveModal>
      </Box>
    )
  }
)

// Reusable attachment menu component with lightweight style
const AttachmentMenu: React.FC<{
  onImageUploadClick: () => void
  onFileUploadClick: () => void
  handleAttachLink: () => void
  t: (key: string) => string
}> = ({ onImageUploadClick, onFileUploadClick, handleAttachLink, t }) => {
  const isSmallScreen = useIsSmallScreen()
  const toolbarIconSize = isSmallScreen ? 22 : 18
  return (
    <Menu
      shadow="md"
      trigger={isSmallScreen ? 'click' : 'hover'}
      position="top-start"
      openDelay={100}
      closeDelay={100}
      keepMounted
      transitionProps={{
        transition: 'pop',
        duration: 200,
      }}
    >
      <Menu.Target>
        <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
          <IconCirclePlus size={toolbarIconSize} strokeWidth={1.8} className="text-[var(--chatbox-tint-secondary)]" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPhoto size={16} />} onClick={onImageUploadClick}>
          {t('Attach Image')}
        </Menu.Item>
        <Menu.Item leftSection={<IconFolder size={16} />} onClick={onFileUploadClick}>
          {t('Select File')}
        </Menu.Item>
        <Menu.Item leftSection={<IconLink size={16} />} onClick={handleAttachLink}>
          {t('Attach Link')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

// Memoize the InputBox component to prevent unnecessary re-renders during streaming
export default memo(InputBox)

// ============================================================================
// MessageInputField — isolated textarea to prevent parent re-renders on typing
// ============================================================================

export type MessageInputFieldRef = {
  getValue: () => string
  setValue: (val: string | ((prev: string) => string)) => void
  clearDraft: () => void
  getElement: () => HTMLTextAreaElement | null
}

type MessageInputFieldProps = {
  isNewSession: boolean
  isSmallScreen: boolean
  viewportHeight: number
  isReadOnly: boolean
  placeholder: string
  autoFocus: boolean
  /** Called on every value change (including programmatic setValue). */
  onValueChange: (value: string) => void
  /** Called only on real user typing (onChange), not programmatic setValue. */
  onUserInput?: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
}

const MessageInputField = memo(
  forwardRef<MessageInputFieldRef, MessageInputFieldProps>(
    (
      {
        isNewSession,
        isSmallScreen,
        viewportHeight,
        isReadOnly,
        placeholder,
        autoFocus,
        onValueChange,
        onUserInput,
        onKeyDown,
        onPaste,
      },
      ref
    ) => {
      const { messageInput, setMessageInput, clearDraft } = useMessageInput('', { isNewSession })
      const inputRef = useRef<HTMLTextAreaElement | null>(null)
      const messageInputRef = useRef(messageInput)
      messageInputRef.current = messageInput

      useEffect(() => {
        onValueChange(messageInput)
      }, [messageInput, onValueChange])

      useImperativeHandle(
        ref,
        () => ({
          getValue: () => messageInputRef.current,
          setValue: (val) => setMessageInput(val),
          clearDraft: () => clearDraft(),
          getElement: () => inputRef.current,
        }),
        [setMessageInput, clearDraft]
      )

      const onChange = useCallback(
        (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          setMessageInput(event.target.value)
          onUserInput?.()
        },
        [setMessageInput, onUserInput]
      )

      return (
        <Textarea
          unstyled={true}
          styles={{ input: { fontSize: 14 } }}
          classNames={{
            root: 'flex-1',
            wrapper: 'flex-1',
            input:
              'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent text-chatbox-tint-primary leading-6',
          }}
          size="sm"
          id={dom.messageInputID}
          ref={inputRef}
          placeholder={placeholder || ''}
          bg="transparent"
          autosize={true}
          minRows={2}
          maxRows={Math.max(4, Math.floor(viewportHeight / 100))}
          value={messageInput}
          autoFocus={autoFocus}
          readOnly={isReadOnly}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          data-testid="message-input"
        />
      )
    }
  )
)

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function getPreferredRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}
