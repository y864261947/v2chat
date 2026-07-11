import type { Session } from '../../shared/types'
import { ModelProviderEnum } from '../../shared/types'
import { migrateMessage } from '../../shared/utils/message'
import { V2API_DEFAULT_CHAT_MODEL } from '../../shared/v2api'

export const V2API_GUIDE_SESSION_ID = 'v2chat-v2api-guide'

export const legacyBuiltInSessionIds = [
  'justchat-b612-406a-985b-3ab4d2c482ff',
  '6dafa15e-c72f-4036-ac89-33c09e875bdc',
  'e22ab364-4681-4e24-aaba-461ed0fccfd3',
  '55d92e88-02af-4c3b-a378-aa0a1970abb1',
  '35df5a96-b612-406a-985b-3ab4d2c481ff',
  '776eac23-7b4a-40da-91cd-f233bb4742ed',
  '81cfc426-48b4-4a13-ad42-bfcfc4544299',
  '8732ec08-b23c-4b5e-8f65-d63d808f970f',
  '3e091ac6-ebfa-42c9-b125-c67ac2d45ee1',
  'chatbox-chat-demo-image-creator',
  'chatbox-chat-demo-artifact-1-cn',
  'chatbox-chat-demo-artifact-1-en',
  'mermaid-demo-1-cn',
  'mermaid-demo-1-en',
]

export const v2apiGuideSession: Session = {
  id: V2API_GUIDE_SESSION_ID,
  name: 'V2API 配置引导',
  type: 'chat',
  starred: true,
  settings: {
    provider: ModelProviderEnum.V2APIOpenAI,
    modelId: V2API_DEFAULT_CHAT_MODEL,
    maxContextMessageCount: Number.MAX_SAFE_INTEGER,
  },
  messages: [
    {
      id: 'v2chat-v2api-guide-system',
      role: 'system' as const,
      content:
        'You are V2Chat, a concise roleplay companion connected through V2API. Help the user configure V2API and start character chats.',
    },
    {
      id: 'v2chat-v2api-guide-assistant',
      role: 'assistant' as const,
      content:
        '欢迎来到 V2Chat。先到 设置 > V2API 填入 API Key，点击获取模型并选择默认模型；然后回到首页选择角色，就可以开始酒馆式对话了。需要语音时直接说“用语音回复我”，也可以发送图片让角色识别场景。',
      generating: false,
      aiProvider: ModelProviderEnum.V2APIOpenAI,
      model: V2API_DEFAULT_CHAT_MODEL,
    },
  ].map(migrateMessage),
}

export const defaultSessionsForEN: Session[] = [v2apiGuideSession]
export const defaultSessionsForCN: Session[] = [v2apiGuideSession]

// Kept for old migrations that import these names.
export const imageCreatorSessionForCN = v2apiGuideSession
export const imageCreatorSessionForEN = v2apiGuideSession
export const artifactSessionCN = v2apiGuideSession
export const artifactSessionEN = v2apiGuideSession
export const mermaidSessionCN = v2apiGuideSession
export const mermaidSessionEN = v2apiGuideSession
