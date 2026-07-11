import { createMessage, type Message, type MessageContentParts, type Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { createModel } from '@/adapters'
import { generateText } from '@/packages/model-calls'
import { mergeSettings } from '@/stores/sessionHelpers'
import { settingsStore } from '@/stores/settingsStore'

export type TavernMemorySummary = {
  relationship?: string
  currentScene?: string
  memory?: string
  characterName?: string
  characterDescription?: string
  characterPersonality?: string
  tags?: string[]
}

export function buildRecentRoleplayTranscript(session: Session, limit = 32) {
  const messages = (session.messages || [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-limit)
    .map(formatTranscriptMessage)
    .filter(Boolean)

  if (messages.length < 2) return ''
  const transcript = messages.join('\n')
  return transcript.length > 12000 ? transcript.slice(-12000) : transcript
}

export async function summarizeTavernMemoryFromSession(
  session: Session,
  options: {
    inferCharacter?: boolean
    existingCharacterName?: string
  } = {}
): Promise<TavernMemorySummary> {
  const transcript = buildRecentRoleplayTranscript(session)
  if (!transcript) {
    throw new Error('聊天内容太少，无法整理剧情记忆')
  }

  const mergedSettings = mergeSettings(settingsStore.getState().getSettings(), session.settings, session.type)
  const model = await createModel(mergedSettings)
  const result = await generateText(model, [
    createMessage(
      'system',
      [
        'You summarize imported tavern roleplay continuity for V2Chat.',
        'Return only compact JSON.',
        'Required string fields: relationship, currentScene, memory.',
        'relationship: user-character relationship, forms of address, boundaries, agreements, emotional state.',
        'currentScene: current place, time, atmosphere, and immediate situation.',
        'memory: important events, clues, promises, user preferences, unresolved plot hooks.',
        options.inferCharacter
          ? 'Also infer characterName, characterDescription, characterPersonality, and tags when the imported chat has no character card.'
          : 'Do not infer a new character card.',
        'tags must be an array of short Simplified Chinese strings.',
        'Write in Simplified Chinese. Keep each field concise and useful for future roleplay.',
        'Do not invent unsupported facts; use uncertainty only when the chat implies it.',
      ].join('\n')
    ),
    createMessage(
      'user',
      [
        `会话名称：${session.name}`,
        options.existingCharacterName ? `已匹配角色：${options.existingCharacterName}` : '没有匹配到角色卡。',
        session.characterDescription ? `已有角色描述：${session.characterDescription}` : '',
        session.currentScene ? `已有场景：${session.currentScene}` : '',
        `导入聊天记录：\n${transcript}`,
        '请输出 JSON，不要输出解释。',
      ]
        .filter(Boolean)
        .join('\n\n')
    ),
  ])

  return parseTavernMemorySummary(getTextFromMessageParts(result.contentParts))
}

export function parseTavernMemorySummary(rawText: string): TavernMemorySummary {
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
  const characterName = pickSummaryField(parsed, ['characterName', 'name', '角色名称', '角色名'])
  const characterDescription = pickSummaryField(parsed, ['characterDescription', 'description', '角色描述'])
  const characterPersonality = pickSummaryField(parsed, ['characterPersonality', 'personality', '性格'])
  const tags = pickTags(parsed.tags) || pickTags(parsed.characterTags) || pickTags(parsed['标签'])

  if (!relationship && !currentScene && !memory && !characterName && !characterDescription) {
    throw new Error('没有提炼到可用的剧情记忆')
  }

  return {
    relationship,
    currentScene,
    memory,
    characterName,
    characterDescription,
    characterPersonality,
    tags,
  }
}

function formatTranscriptMessage(message: Message) {
  const role = message.role === 'user' ? '用户' : '角色'
  const text = getMessageText(message, false, false).replace(/\s+/g, ' ').trim()
  const mediaNotes = (message.contentParts || [])
    .map((part) => (part.type === 'audio' ? `[语音${part.transcript ? `：${part.transcript}` : ''}]` : part.type === 'image' ? '[图片]' : ''))
    .filter(Boolean)
    .join(' ')
  const content = [text, mediaNotes].filter(Boolean).join(' ')
  if (!content) return ''
  return `${role}: ${content.length > 900 ? `${content.slice(0, 900)}...` : content}`
}

function getTextFromMessageParts(parts: MessageContentParts) {
  return parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
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

function pickTags(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const tags = value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, 8)
  return tags.length ? tags : undefined
}
