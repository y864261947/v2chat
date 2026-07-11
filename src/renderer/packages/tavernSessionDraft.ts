import { createMessage, type Session } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { buildCharacterSystemPrompt, type TavernCharacter } from './tavernCharacters'

export function buildRoleplaySessionDraft(character: TavernCharacter, base: Omit<Session, 'id'>): Omit<Session, 'id'> {
  return {
    ...base,
    conversationMode: 'roleplay',
    name: character.name,
    assistantAvatarKey: character.avatar?.type === 'storage-key' ? character.avatar.storageKey : undefined,
    picUrl: character.avatar?.type === 'url' ? character.avatar.url : undefined,
    backgroundImage: character.backgroundImage,
    standingImage: character.standingImage,
    characterId: character.id,
    characterDescription: character.description,
    characterRelationship: '',
    characterMemory: '',
    currentScene: character.scenario || '',
    characterTags: [...character.tags],
    characterVoiceId: character.voiceId,
    messages: [
      {
        ...createMessage('system', buildCharacterSystemPrompt(character)),
        id: uuidv4(),
      },
      ...(character.firstMessage
        ? [
            {
              ...createMessage('assistant', character.firstMessage),
              id: uuidv4(),
            },
          ]
        : []),
    ],
  }
}
