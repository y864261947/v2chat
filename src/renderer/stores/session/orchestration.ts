import { buildContext } from '@shared/context'
import { ChatboxAIAPIError, OCRError } from '@shared/models/errors'
import type { ChatStreamOptions, ModelInterface, ModelStreamPart } from '@shared/models/types'
import { type Message, type MessageContentParts, ModelProviderEnum, type Session } from '@shared/types'
import { getMessageText, sequenceMessages } from '@shared/utils/message'
import type { ToolSet } from 'ai'
import { t } from 'i18next'
import { createModel, createModelDependencies } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { convertToModelMessages, injectModelSystemPrompt } from '@/packages/model-calls/message-utils'
import { generateOpenAICompatibleImages } from '@/packages/openai-compatible-image'
import { estimateTokensFromMessages } from '@/packages/token'
import { generateSpeech, hasVoiceReplyIntent } from '@/packages/v2api-tts'
import platform from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../../shared/session-attachment-rag/logging'
import * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'
import { uiStore } from '../uiStore'
import { createAttachmentResolver } from './attachment-resolver'
import { applyLegacyToolFallback } from './legacy-tool-fallback'
import { persistStreamingMessage, updateStreamingCache } from './messages'
import { getOCRModel, ocrImagesInMessages } from './ocr-helper'
import { createInitialState, processStreamChunk } from './stream-chunk-processor'
import { buildToolsForSession } from './tools-builder'
import {
  findTargetMessageIndex,
  getSessionWebBrowsing,
  handleGenerationError,
  initializeTargetMessage,
  trackGenerateEvent,
} from './utils'

const log = getLogger('session-orchestration')

const IMAGE_GENERATION_INTENT_PATTERN =
  /(^\s*\/(?:image|img|draw)\b|生图|出图|发(一张|1张|张|个)?(图|图片|图像|照片|画面|插画|配图|立绘)|发送(一张|1张|张|个)?(图|图片|图像|照片|画面|插画|配图|立绘)|给我(发|发送|来|弄|做)(一张|1张|张|个)?.*(图|图片|图像|照片|画面|插画|配图|立绘)|生成.*(图|图片|图像|画面|插画|配图|照片|壁纸|封面|立绘|image|picture)|画(一张|个|幅|一下)?.*(图|图片|图像|画面|插画|配图|照片|壁纸|封面|立绘|这一幕|当前场景|image|picture)|绘制.*(图|图片|图像|画面|插画|配图|照片|壁纸|封面|立绘|这一幕|当前场景|image|picture)|来(一|1)?张.*(图|图片|照片|插画|配图|立绘)|配(一|1)?张.*(图|图片|照片|插画|配图)|把.*(画|生成).*(出来|成图|成图片)|想看.*(你|角色|她|他|它|场景|这一幕|当前|样子|表情|姿势|穿着|房间)|看看.*(你|角色|她|他|它|场景|这一幕|当前|样子|表情|姿势|穿着|房间)|让我看.*(你|角色|她|他|它|场景|这一幕|当前|样子|表情|姿势|穿着|房间)|show me.*(image|picture|scene|character|you)|send me.*(image|picture|photo)|create .*image|generate .*image|draw .*image)/i

type ImageIntentResult = {
  shouldGenerate: boolean
  prompt?: string
}

function hasImageGenerationIntent(message?: Message): boolean {
  if (!message) return false
  return IMAGE_GENERATION_INTENT_PATTERN.test(getMessageText(message, false, false))
}

function getImageGenerationPrompt(message: Message): string {
  return getMessageText(message, false, false)
    .replace(/^\s*\/image\b[:：,\s]*/i, '')
    .replace(/^(请|帮我|给我)?\s*(生成|画|绘制)\s*(一张|一个|一幅)?\s*(图片|图像|图|image|picture)?\s*[:：,，]*/i, '')
    .trim()
}

function getTextFromParts(parts: MessageContentParts) {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

function buildVoiceReplyInstruction() {
  return [
    'V2Chat client capability: voice replies are supported by the app through client-side TTS.',
    'Ignore any earlier assistant message that claimed voice/audio replies are unsupported; that was outdated client-state information.',
    'When the user asks for voice/audio/speaking, do not refuse and do not say you are text-only or cannot send audio.',
    'Write the final answer as the short line that should be spoken aloud; V2Chat will turn it into an audio message automatically.',
    'Use the current conversation and character context. Keep it concise: 1-3 short sentences, preferably under 80 Chinese characters.',
    'If the user is only asking whether voice is possible, answer yes in character and briefly continue or invite them to proceed.',
  ].join('\n')
}

function buildClientCapabilityInstruction(session: Session) {
  if (session.type && session.type !== 'chat') {
    return ''
  }

  return [
    'V2Chat client capabilities: the app can send and receive voice messages, display uploaded images, generate images, and render character background/standing art when the user requests them.',
    'Do not claim you cannot send voice, images, or character media solely because the language model itself outputs text; answer naturally in character and let the V2Chat client handle media generation.',
    'Keep capability answers short and conversational.',
  ].join('\n')
}

function buildTavernSessionMemoryInstruction(session: Session) {
  if (session.type && session.type !== 'chat') {
    return ''
  }

  const notes = [
    session.characterRelationship ? `Relationship notes:\n${session.characterRelationship}` : '',
    session.currentScene ? `Current scene:\n${session.currentScene}` : '',
    session.characterMemory ? `Long-term memory:\n${session.characterMemory}` : '',
  ].filter(Boolean)

  if (notes.length === 0) {
    return ''
  }

  return [
    'V2Chat tavern session notes. Treat these as private continuity notes for the current roleplay.',
    'Use them to preserve relationship, scene, preferences, and plot continuity.',
    'Do not quote or expose these notes verbatim unless the user asks to edit the roleplay notes.',
    notes.join('\n\n'),
  ].join('\n')
}

function parseImageIntentJson(text: string): ImageIntentResult {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text
  try {
    const parsed = JSON.parse(jsonText) as { image?: unknown; shouldGenerate?: unknown; prompt?: unknown }
    return {
      shouldGenerate: Boolean(parsed.image ?? parsed.shouldGenerate),
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt.trim() : undefined,
    }
  } catch {
    return { shouldGenerate: false }
  }
}

async function classifyImageGenerationIntent(params: {
  model: ModelInterface
  session: Session
  messages: Message[]
  latestUserMessage: Message
}): Promise<ImageIntentResult> {
  if (hasImageGenerationIntent(params.latestUserMessage)) {
    return {
      shouldGenerate: true,
      prompt: getImageGenerationPrompt(params.latestUserMessage),
    }
  }

  const context = formatRecentRoleplayContext(params.session, params.messages, params.latestUserMessage)
  try {
    const result = await params.model.chat(
      [
        {
          role: 'system',
          content:
            'You are an intent classifier for a tavern AI chat client. Return only compact JSON. Set image=true when the user wants the client/assistant to send, show, create, draw, generate, or provide a new picture/image/photo/scene/portrait/background, even if they say it indirectly like "can you send me a picture?". Set image=false for image recognition, ordinary chatting, or metaphorical descriptions. If image=true, write a concise English image prompt based on the current scene. Do not roleplay. Do not refuse.',
        },
        {
          role: 'user',
          content: `${context}\n\nReturn JSON as {"image": boolean, "prompt": string}.`,
        },
      ],
      {}
    )
    return parseImageIntentJson(getTextFromParts(result.contentParts))
  } catch (error) {
    log.warn('Failed to classify image intent', error)
    return { shouldGenerate: false }
  }
}

function formatRecentRoleplayContext(session: Session, messages: Message[], latestUserMessage: Message) {
  const recent = messages
    .filter((message) => message.role !== 'system')
    .slice(-18)
    .map((message) => {
      const role = message.role === 'assistant' ? 'Character' : message.role === 'user' ? 'User' : message.role
      const text = getMessageText(message, false, false).trim()
      return text ? `${role}: ${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')

  return [
    `Character name: ${session.name}`,
    session.characterDescription ? `Character description: ${session.characterDescription}` : '',
    session.characterRelationship ? `Relationship notes: ${session.characterRelationship}` : '',
    session.characterMemory ? `Long-term memory: ${session.characterMemory}` : '',
    session.currentScene ? `Current scene: ${session.currentScene}` : '',
    session.characterTags?.length ? `Tags: ${session.characterTags.join(', ')}` : '',
    `User image request: ${getMessageText(latestUserMessage, false, false).trim()}`,
    `Recent roleplay context:\n${recent}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function buildContextualImagePrompt(params: {
  model: ModelInterface
  session: Session
  messages: Message[]
  latestUserMessage: Message
  fallbackPrompt: string
}) {
  const context = formatRecentRoleplayContext(params.session, params.messages, params.latestUserMessage)
  try {
    const result = await params.model.chat(
      [
        {
          role: 'system',
          content:
            'You convert tavern roleplay context into one image-generation prompt. Output only the final prompt in English. Include characters, expressions, poses, setting, lighting, mood, camera framing, and visual style. Do not refuse. Do not mention policies. Do not explain.',
        },
        {
          role: 'user',
          content: `Create a concise but vivid prompt for the current scene.\n\n${context}`,
        },
      ],
      {}
    )
    const prompt = getTextFromParts(result.contentParts)
    return prompt || params.fallbackPrompt
  } catch (error) {
    log.warn('Failed to build contextual image prompt, using fallback prompt', error)
    return params.fallbackPrompt
  }
}

async function refreshSessionAttachmentStatuses(messages: Message[]): Promise<Message[]> {
  if (platform.type !== 'desktop') {
    return messages
  }

  const ids = Array.from(
    new Set(
      messages.flatMap((message) =>
        (message.files ?? [])
          .filter((file) => file.sessionAttachmentId)
          .map((file) => file.sessionAttachmentId as number)
      )
    )
  )

  if (ids.length === 0) {
    return messages
  }

  const controller = platform.getSessionAttachmentRagController()
  const attachments = await controller.getAttachments(ids)
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Refreshed attachment statuses: count=${attachments.length}, statuses=${attachments
      .map((attachment) => `${attachment.id}:${attachment.indexStatus ?? attachment.status}`)
      .join(',')}`
  )
  const availabilityMap = new Map(attachments.map((attachment) => [attachment.id, attachment.availability]))
  const indexStatusMap = new Map(attachments.map((attachment) => [attachment.id, attachment.indexStatus]))
  const chunkCountMap = new Map(attachments.map((attachment) => [attachment.id, attachment.chunkCount]))
  const totalChunksMap = new Map(attachments.map((attachment) => [attachment.id, attachment.totalChunks]))
  const embeddedChunksMap = new Map(attachments.map((attachment) => [attachment.id, attachment.embeddedChunks]))
  const indexingStageMap = new Map(attachments.map((attachment) => [attachment.id, attachment.indexingStage]))

  return messages.map((message) => {
    if (!message.files?.length) {
      return message
    }

    const files = message.files.map((file) => {
      if (!file.sessionAttachmentId) {
        return file
      }
      return {
        ...file,
        sessionAttachmentAvailability:
          availabilityMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentAvailability,
        sessionAttachmentIndexStatus: indexStatusMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentIndexStatus,
        sessionAttachmentStatus: indexStatusMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentStatus,
        sessionAttachmentChunkCount: chunkCountMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentChunkCount,
        sessionAttachmentTotalChunks: totalChunksMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentTotalChunks,
        sessionAttachmentEmbeddedChunks:
          embeddedChunksMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentEmbeddedChunks,
        sessionAttachmentIndexingStage:
          indexingStageMap.get(file.sessionAttachmentId) ?? file.sessionAttachmentIndexingStage,
      }
    })

    return { ...message, files }
  })
}

export async function orchestrateGeneration(
  sessionId: string,
  targetMsg: Message,
  options?: { operationType?: 'send_message' | 'regenerate' }
) {
  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  const globalSettings = settingsStore.getState().getSettings()
  const configs = await platform.getConfig()

  if (!session || !settings) {
    return
  }

  trackGenerateEvent(sessionId, settings, globalSettings, session.type, options)

  const startTime = Date.now()
  let firstTokenLatency: number | undefined
  const persistInterval = 2000
  let lastPersistTimestamp = Date.now()

  targetMsg = await initializeTargetMessage(targetMsg, settings, globalSettings, session.type)

  await persistStreamingMessage(sessionId, targetMsg)

  const found = findTargetMessageIndex(session, targetMsg.id)
  if (!found) return
  const { messages, index: targetMsgIx } = found

  const controller = new AbortController()

  try {
    const dependencies = await createModelDependencies()
    const model = await createModel(settings, dependencies)
    const latestUserMessage = [...messages.slice(0, targetMsgIx)].reverse().find((message) => message.role === 'user')
    const voiceReplyRequested = hasVoiceReplyIntent(latestUserMessage)

    const imageIntent = latestUserMessage
      ? await classifyImageGenerationIntent({
          model,
          session,
          messages: messages.slice(0, targetMsgIx),
          latestUserMessage,
        })
      : { shouldGenerate: false }

    if (latestUserMessage && imageIntent.shouldGenerate) {
      const fallbackPrompt =
        imageIntent.prompt ||
        getImageGenerationPrompt(latestUserMessage) ||
        getMessageText(latestUserMessage, false, false)
      const imagePrompt = await buildContextualImagePrompt({
        model,
        session,
        messages: messages.slice(0, targetMsgIx),
        latestUserMessage,
        fallbackPrompt,
      })
      const referenceImageDataUrls = (
        await Promise.all(
          latestUserMessage.contentParts
            .filter((part) => part.type === 'image')
            .map(async (part) => dependencies.storage.getImage(part.storageKey))
        )
      ).filter(Boolean) as string[]
      const generatedImages = await generateOpenAICompatibleImages({
        apiKey: globalSettings.v2api?.imageApiKey || '',
        baseUrl: globalSettings.v2api?.imageBaseUrl,
        model: globalSettings.v2api?.imageModel,
        prompt: imagePrompt,
        num: settings.imageGenerateNum || 1,
        referenceImageDataUrls,
        signal: controller.signal,
      })

      const imageParts: MessageContentParts = []
      for (let i = 0; i < generatedImages.length; i++) {
        const storageKey = StorageKeyGenerator.picture(`${session.id}:${targetMsg.id}:chat-image:${i}`)
        await storage.setBlob(storageKey, generatedImages[i])
        imageParts.push({ type: 'image', storageKey })
      }

      targetMsg = {
        ...targetMsg,
        generating: false,
        cancel: undefined,
        status: [],
        contentParts:
          imageParts.length > 0
            ? imageParts
            : [{ type: 'info', text: 'Image generation finished but no image was returned.' }],
      }
      await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      return
    }

    const sessionKnowledgeBaseMap = uiStore.getState().sessionKnowledgeBaseMap
    const knowledgeBase = sessionKnowledgeBaseMap[sessionId]
    const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

    const attachmentResolver = createAttachmentResolver()
    const messagesForPrompt = await refreshSessionAttachmentStatuses(messages.slice(0, targetMsgIx))
    let promptMsgs = await buildContext(messagesForPrompt, {
      attachmentResolver,
      compactionPoints: session.compactionPoints,
      modelSupportToolUseForFile: model.isSupportToolUse('read-file'),
      maxContextMessageCount: settings.maxContextMessageCount,
    })

    const infoParts: MessageContentParts = []

    if (
      !model.isSupportVision() &&
      promptMsgs.some((m) => m.contentParts.some((c) => c.type === 'image' && !c.ocrResult))
    ) {
      const ocrResult = getOCRModel(globalSettings, configs, dependencies)
      if (!ocrResult) {
        throw ChatboxAIAPIError.fromCodeName('model_not_support_image_2', 'model_not_support_image_2')
      }
      try {
        await ocrImagesInMessages(promptMsgs, ocrResult.model)
      } catch (err) {
        throw new OCRError(ocrResult.providerName, err instanceof Error ? err : new Error(`${err}`))
      }
      infoParts.push({
        type: 'info',
        text: t('Current model {{modelName}} does not support image input, using OCR to process images', {
          modelName: model.modelId,
        }),
      })
    }

    const { promptMsgs: updatedMsgs, fallbackToolCallPart } = await applyLegacyToolFallback({
      model,
      promptMsgs,
      knowledgeBase,
      webBrowsing,
      signal: controller.signal,
    })
    promptMsgs = updatedMsgs

    const { tools, instructions: toolInstructions } = await buildToolsForSession(model, {
      webBrowsing,
      knowledgeBase,
      messages: promptMsgs,
    })
    const instructions = [
      toolInstructions,
      buildClientCapabilityInstruction(session),
      buildTavernSessionMemoryInstruction(session),
      voiceReplyRequested ? buildVoiceReplyInstruction() : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    let injectedMessages = injectModelSystemPrompt(
      model.modelId,
      promptMsgs,
      instructions,
      model.isSupportSystemMessage() ? 'system' : 'user'
    )

    if (!model.isSupportSystemMessage()) {
      injectedMessages = injectedMessages.map((m) => ({ ...m, role: m.role === 'system' ? 'user' : m.role }))
    }

    injectedMessages = sequenceMessages(injectedMessages)

    const coreMessages = await convertToModelMessages(injectedMessages, {
      modelSupportVision: model.isSupportVision(),
      preserveReasoning: settings.provider === ModelProviderEnum.DeepSeek,
    })

    targetMsg = {
      ...targetMsg,
      cancel: () => controller.abort(),
    }
    updateStreamingCache(sessionId, targetMsg)

    const chatOptions: ChatStreamOptions = {
      sessionId: session.id,
      signal: controller.signal,
      providerOptions: settings.providerOptions,
    }

    if (Object.keys(tools).length > 0) {
      chatOptions.tools = tools as ToolSet
    }

    const stream = model.chatStream(coreMessages, chatOptions) as AsyncGenerator<ModelStreamPart<ToolSet>>

    let processorState = createInitialState(fallbackToolCallPart ? [fallbackToolCallPart] : undefined)

    const streamCallbacks = {
      onFileReceived: async (mediaType: string, base64: string) => {
        const storageKey = StorageKeyGenerator.picture(`${session.id}:${targetMsg.id}`)
        await storage.setBlob(storageKey, `data:${mediaType};base64,${base64}`)
        return storageKey
      },
    }

    for await (const chunk of stream) {
      const result = await processStreamChunk(chunk, processorState, streamCallbacks)
      processorState = result.state

      if (result.skipUpdate) {
        if (result.statusChunk && result.statusChunk.type === 'status') {
          targetMsg = {
            ...targetMsg,
            status: result.statusChunk.status ? [result.statusChunk.status] : [],
          }
          updateStreamingCache(sessionId, targetMsg)
        }
        continue
      }

      const nextMsg: Message = {
        ...targetMsg,
        contentParts: [...infoParts, ...processorState.contentParts],
      }

      const textLength = getMessageText(nextMsg, true, true).length
      if (!firstTokenLatency && textLength > 0) {
        firstTokenLatency = Date.now() - startTime
      }

      targetMsg = {
        ...nextMsg,
        status: textLength > 0 ? [] : nextMsg.status,
        firstTokenLatency,
      }

      const shouldPersist = Date.now() - lastPersistTimestamp >= persistInterval
      if (shouldPersist) {
        void persistStreamingMessage(sessionId, targetMsg)
      } else {
        updateStreamingCache(sessionId, targetMsg)
      }
      if (shouldPersist) {
        lastPersistTimestamp = Date.now()
      }
    }

    for (const part of processorState.contentParts) {
      if (part.type === 'reasoning' && part.startTime && !part.duration) {
        part.duration = Date.now() - part.startTime
      }
    }

    targetMsg = {
      ...targetMsg,
      generating: false,
      cancel: undefined,
      contentParts: [...infoParts, ...processorState.contentParts],
      tokensUsed: targetMsg.tokensUsed ?? estimateTokensFromMessages([...promptMsgs, targetMsg]),
      status: [],
      finishReason: processorState.finishReason,
      usage: processorState.usage,
    }

    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })

    if (voiceReplyRequested) {
      try {
        const text = getMessageText(targetMsg, false, false).trim()
        const characterVoiceId = session.characterVoiceId
        const audio = await generateSpeech({
          input: text,
          sessionId,
          messageId: targetMsg.id,
          voice: characterVoiceId || globalSettings.v2api?.ttsVoice,
        })
        targetMsg = {
          ...targetMsg,
          contentParts: [
            ...targetMsg.contentParts,
            {
              type: 'audio',
              storageKey: audio.storageKey,
              mimeType: audio.mimeType,
              transcript: text,
            },
          ],
        }
        await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      } catch (error) {
        targetMsg = {
          ...targetMsg,
          contentParts: [
            ...targetMsg.contentParts,
            {
              type: 'info',
              text: `Voice generation failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        }
        await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      }
    }
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      targetMsg = {
        ...targetMsg,
        generating: false,
        cancel: undefined,
        status: [],
      }
      await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
      return
    }

    targetMsg = handleGenerationError(err, targetMsg, settings)
    await persistStreamingMessage(sessionId, targetMsg, { refreshCounting: true })
  }
}
