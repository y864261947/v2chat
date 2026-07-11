import { createMessage, type Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { TavernCharacter } from './tavernCharacters'
import { buildRoleplaySessionDraft } from './tavernSessionDraft'

const character: TavernCharacter = {
  id: 'mira',
  name: 'Mira',
  description: 'A late-night tavern owner.',
  scenario: 'The tavern is closing.',
  firstMessage: 'You are late.',
  tags: ['tavern'],
  voiceId: 'voice-mira',
  createdAt: 1,
  updatedAt: 1,
}

function baseSession(): Omit<Session, 'id'> {
  return {
    name: 'Untitled',
    type: 'chat',
    conversationMode: 'assistant',
    messages: [createMessage('system', 'global prompt')],
    settings: { provider: 'v2api-openai', modelId: 'test-model' },
  }
}

describe('buildRoleplaySessionDraft', () => {
  it('creates independent roleplay snapshots for each window', () => {
    const first = buildRoleplaySessionDraft(character, baseSession())
    const second = buildRoleplaySessionDraft(character, baseSession())

    expect(first).toMatchObject({
      conversationMode: 'roleplay',
      characterId: 'mira',
      characterMemory: '',
      characterRelationship: '',
      currentScene: 'The tavern is closing.',
      characterVoiceId: 'voice-mira',
    })
    expect(first.messages[0].contentParts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('Mira') })])
    )
    expect(first.messages[0].id).not.toBe(second.messages[0].id)

    first.characterMemory = 'Only the first window knows this.'
    first.characterVoiceId = 'voice-first-window'
    if (first.settings) first.settings.modelId = 'first-window-model'
    expect(second.characterMemory).toBe('')
    expect(second.characterVoiceId).toBe('voice-mira')
    expect(second.settings?.modelId).toBe('test-model')
  })
})
