import { createMessage, type Message, type MessageAudioPart, type MessageContentParts, type MessageRole } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import {
  normalizeSillyTavernPayload,
  parseTavernCharacterFile,
  type TavernCharacter,
} from './tavernCharacters'

export type TavernImportChat = {
  id: string
  title: string
  sourceName: string
  messages: Message[]
  participants: string[]
  startedAt?: number
}

export type TavernImportBundle = {
  characters: TavernCharacter[]
  chats: TavernImportChat[]
  errors: string[]
}

type RawMessageLike = Record<string, unknown>

const TEXT_FILE_PATTERN = /\.(json|txt|md|markdown|jsonl)$/i
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|gif)$/i
const AUDIO_FILE_PATTERN = /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i

export async function analyzeTavernImportFiles(files: FileList | File[]): Promise<TavernImportBundle> {
  const bundle: TavernImportBundle = { characters: [], chats: [], errors: [] }
  const fileArray = Array.from(files)

  for (const file of fileArray) {
    try {
      if (/\.png$/i.test(file.name)) {
        const characters = await parseTavernCharacterFile(file)
        bundle.characters.push(...characters)
        if (characters.length > 0) {
          continue
        }
      }

      if (TEXT_FILE_PATTERN.test(file.name)) {
        const chats = await parseTextLikeChatFile(file)
        bundle.chats.push(...chats)
        if (chats.length === 0 && /\.json$/i.test(file.name)) {
          const characters = await parseTavernCharacterFile(file)
          bundle.characters.push(...characters)
          if (characters.length > 0) {
            continue
          }
          bundle.errors.push(`${file.name}: 没有识别到角色卡或聊天记录`)
          continue
        }
        if (chats.length === 0 && !isCharacterCandidate(file)) {
          bundle.errors.push(`${file.name}: 没有识别到聊天记录`)
        }
        continue
      }

      if (AUDIO_FILE_PATTERN.test(file.name) || IMAGE_FILE_PATTERN.test(file.name)) {
        const chat = await parseLooseMediaFile(file)
        if (chat) bundle.chats.push(chat)
        continue
      }
    } catch (error) {
      bundle.errors.push(`${file.name}: ${error instanceof Error ? error.message : '解析失败'}`)
    }
  }

  return bundle
}

function isCharacterCandidate(file: File) {
  return /\.(json|png)$/i.test(file.name)
}

async function parseTextLikeChatFile(file: File): Promise<TavernImportChat[]> {
  const text = await file.text()
  if (!text.trim()) return []

  if (/\.jsonl$/i.test(file.name)) {
    const messages = await buildMessagesFromRawList(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RawMessageLike)
    )
    return messages.length ? [createChatImport(file.name, messages)] : []
  }

  if (/\.json$/i.test(file.name)) {
    const parsed = JSON.parse(text)
    const chats = await parseJsonChatPayload(parsed, file.name)
    return chats
  }

  const messages = parsePlainTextTranscript(text)
  return messages.length ? [createChatImport(file.name, messages)] : []
}

async function parseJsonChatPayload(payload: unknown, sourceName: string): Promise<TavernImportChat[]> {
  if (!payload || typeof payload !== 'object') return []

  const character = normalizeSillyTavernPayload(payload)
  if (character) return []

  if (Array.isArray(payload)) {
    const messages = await buildMessagesFromRawList(payload.filter(isRecord))
    return messages.length ? [createChatImport(sourceName, messages)] : []
  }

  const root = payload as Record<string, unknown>
  const chatGptMessages = parseChatGptMapping(root)
  if (chatGptMessages.length) {
    return [createChatImport(stringField(root.title) || sourceName, await buildMessagesFromRawList(chatGptMessages))]
  }

  const candidateLists = [
    root.messages,
    root.chat,
    root.chatMessages,
    root.chat_messages,
    root.conversation,
    root.conversations,
    isRecord(root.data) ? root.data.messages : undefined,
    isRecord(root.data) ? root.data.chat : undefined,
    isRecord(root.data) ? root.data.conversation : undefined,
  ]

  for (const candidate of candidateLists) {
    if (Array.isArray(candidate)) {
      const messages = await buildMessagesFromRawList(candidate.filter(isRecord))
      if (messages.length) {
        return [createChatImport(stringField(root.title) || stringField(root.name) || sourceName, messages)]
      }
    }
  }

  return []
}

function parseChatGptMapping(root: Record<string, unknown>): RawMessageLike[] {
  if (!isRecord(root.mapping)) return []
  return Object.values(root.mapping)
    .filter(isRecord)
    .map((node) => (isRecord(node.message) ? node.message : null))
    .filter((message): message is RawMessageLike => Boolean(message))
    .sort((a, b) => numberField(a.create_time) - numberField(b.create_time))
}

async function buildMessagesFromRawList(rawMessages: RawMessageLike[]) {
  const messages: Message[] = []
  for (const raw of rawMessages) {
    const message = await rawMessageToMessage(raw)
    if (message) messages.push(message)
  }
  return messages
}

async function rawMessageToMessage(raw: RawMessageLike): Promise<Message | null> {
  const text = extractMessageText(raw)
  const mediaParts = await extractMediaParts(raw)
  if (!text && mediaParts.length === 0) return null

  const role = inferRole(raw)
  const message = createMessage(role, text)
  return {
    ...message,
    id: stringField(raw.id) || uuidv4(),
    name: extractMessageName(raw),
    contentParts: [...message.contentParts, ...mediaParts],
    timestamp: inferTimestamp(raw),
  }
}

function parsePlainTextTranscript(text: string): Message[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const messages: Message[] = []
  let currentRole: MessageRole = 'assistant'
  let currentName = ''
  let currentTimestamp: number | undefined
  let buffer: string[] = []

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (!content) return
    const message = createMessage(currentRole, content)
    messages.push({ ...message, id: uuidv4(), name: currentName || undefined, timestamp: currentTimestamp })
    buffer = []
  }

  for (const line of lines) {
    const parsed = parseTranscriptLineHeader(line)
    if (parsed) {
      flush()
      currentRole = parsed.role
      currentName = parsed.name
      currentTimestamp = parsed.timestamp
      buffer.push(parsed.text)
    } else {
      buffer.push(line)
    }
  }
  flush()

  if (messages.length <= 1) {
    const message = createMessage('user', text.trim())
    return text.trim() ? [{ ...message, id: uuidv4() }] : []
  }

  return messages
}

function parseTranscriptLineHeader(line: string) {
  const match = line.match(
    /^(?:\[(?<time1>[^\]]+)\]\s*)?(?<name>用户|我|User|Human|Me|Assistant|AI|角色|Bot|豆包|DeepSeek|Kimi|Claude|ChatGPT|[^:：]{1,28})\s*[:：]\s*(?<text>.*)$/i
  )
  if (!match?.groups) return null
  const name = match.groups.name.trim()
  return {
    name,
    role: /^(用户|我|user|human|me)$/i.test(name) ? ('user' as const) : ('assistant' as const),
    text: match.groups.text || '',
    timestamp: parseTimestamp(match.groups.time1),
  }
}

async function parseLooseMediaFile(file: File): Promise<TavernImportChat | null> {
  const dataUrl = await readAsDataUrl(file)
  const message = createMessage('user', '')
  if (AUDIO_FILE_PATTERN.test(file.name)) {
    const storageKey = StorageKeyGenerator.audio(`import:${file.name}`)
    await storage.setBlob(storageKey, dataUrl)
    message.contentParts = [
      {
        type: 'audio',
        storageKey,
        mimeType: file.type || mimeFromFilename(file.name, 'audio/mpeg'),
      },
      { type: 'text', text: `导入音频：${file.name}` },
    ]
  } else if (IMAGE_FILE_PATTERN.test(file.name)) {
    const storageKey = StorageKeyGenerator.picture(`import:${file.name}`)
    await storage.setBlob(storageKey, dataUrl)
    message.contentParts = [{ type: 'image', storageKey }, { type: 'text', text: `导入图片：${file.name}` }]
  } else {
    return null
  }

  return createChatImport(file.name, [{ ...message, id: uuidv4(), timestamp: file.lastModified || Date.now() }])
}

function createChatImport(title: string, messages: Message[]): TavernImportChat {
  return {
    id: uuidv4(),
    title: sanitizeTitle(title),
    sourceName: title,
    messages,
    participants: Array.from(new Set(messages.map((message) => message.name || message.role))).slice(0, 8),
    startedAt: messages.find((message) => message.timestamp)?.timestamp,
  }
}

function sanitizeTitle(value: string) {
  return value.replace(/\.(jsonl?|txt|md|markdown)$/i, '').trim() || '导入聊天记录'
}

function inferRole(raw: RawMessageLike): MessageRole {
  const role = stringField(raw.role) || stringField(isRecord(raw.author) ? raw.author.role : undefined)
  const sender = stringField(raw.sender) || stringField(raw.from) || stringField(raw.name)
  if (raw.is_user === true || raw.isUser === true || /^(user|human)$/i.test(role) || /^(用户|我|user|human|me)$/i.test(sender)) {
    return 'user'
  }
  if (/^system$/i.test(role)) return 'system'
  return 'assistant'
}

function extractMessageName(raw: RawMessageLike) {
  return (
    stringField(raw.name) ||
    stringField(raw.sender) ||
    stringField(raw.from) ||
    stringField(isRecord(raw.author) ? raw.author.name : undefined) ||
    undefined
  )
}

function extractMessageText(raw: RawMessageLike): string {
  const direct =
    stringField(raw.mes) ||
    stringField(raw.message) ||
    stringField(raw.text) ||
    stringField(raw.content) ||
    stringField(raw.value)
  if (direct) return direct

  if (isRecord(raw.content)) {
    const content = raw.content
    if (Array.isArray(content.parts)) return content.parts.map((part) => (typeof part === 'string' ? part : '')).join('\n')
    if (Array.isArray(content.content)) return stringifyContentArray(content.content)
    return stringField(content.text)
  }

  if (Array.isArray(raw.content)) return stringifyContentArray(raw.content)
  if (Array.isArray(raw.parts)) return stringifyContentArray(raw.parts)
  return ''
}

function stringifyContentArray(parts: unknown[]) {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part
      if (isRecord(part)) return stringField(part.text) || stringField(part.content) || stringField(part.transcript)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function extractMediaParts(raw: RawMessageLike): Promise<MessageContentParts> {
  const parts: MessageContentParts = []
  const candidates = [
    raw.audio,
    raw.audioUrl,
    raw.audio_url,
    raw.voice,
    raw.image,
    raw.imageUrl,
    raw.image_url,
    raw.attachments,
    raw.files,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const part = await mediaValueToPart(item)
        if (part) parts.push(part)
      }
    } else {
      const part = await mediaValueToPart(candidate)
      if (part) parts.push(part)
    }
  }

  return parts
}

async function mediaValueToPart(value: unknown): Promise<MessageContentParts[number] | null> {
  if (!value) return null
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return dataUrlToImagePart(value)
    if (value.startsWith('data:audio/')) return dataUrlToAudioPart(value)
    return null
  }
  if (!isRecord(value)) return null

  const url = stringField(value.url) || stringField(value.href) || stringField(value.dataUrl) || stringField(value.data_url)
  const base64 = stringField(value.base64) || stringField(value.data)
  const mimeType = stringField(value.mimeType) || stringField(value.mime_type) || stringField(value.type)
  const dataUrl = url?.startsWith('data:') ? url : base64 ? `data:${mimeType || 'application/octet-stream'};base64,${base64}` : ''
  if (!dataUrl) return null

  if (dataUrl.startsWith('data:image/')) return dataUrlToImagePart(dataUrl)
  if (dataUrl.startsWith('data:audio/')) return dataUrlToAudioPart(dataUrl, stringField(value.transcript))
  return null
}

async function dataUrlToImagePart(dataUrl: string) {
  const storageKey = StorageKeyGenerator.picture('import-chat-image')
  await storage.setBlob(storageKey, dataUrl)
  return { type: 'image' as const, storageKey }
}

async function dataUrlToAudioPart(dataUrl: string, transcript?: string): Promise<MessageAudioPart> {
  const storageKey = StorageKeyGenerator.audio('import-chat-audio')
  await storage.setBlob(storageKey, dataUrl)
  return {
    type: 'audio',
    storageKey,
    mimeType: dataUrl.match(/^data:([^;]+);/)?.[1] || 'audio/mpeg',
    transcript,
  }
}

function inferTimestamp(raw: RawMessageLike) {
  return (
    parseTimestamp(raw.timestamp) ||
    parseTimestamp(raw.createdAt) ||
    parseTimestamp(raw.created_at) ||
    parseTimestamp(raw.create_time) ||
    parseTimestamp(raw.send_date) ||
    Date.now()
  )
}

function parseTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function mimeFromFilename(name: string, fallback: string) {
  if (/\.wav$/i.test(name)) return 'audio/wav'
  if (/\.m4a$/i.test(name)) return 'audio/mp4'
  if (/\.ogg$/i.test(name)) return 'audio/ogg'
  if (/\.webm$/i.test(name)) return 'audio/webm'
  if (/\.flac$/i.test(name)) return 'audio/flac'
  return fallback
}
