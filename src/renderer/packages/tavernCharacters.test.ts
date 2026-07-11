import { describe, expect, it } from 'vitest'
import {
  buildCharacterSystemPrompt,
  normalizeSillyTavernPayload,
  type TavernCharacter,
} from './tavernCharacters'

function makeCharacter(overrides: Partial<TavernCharacter> = {}): TavernCharacter {
  return {
    id: 'character-1',
    name: 'Mira',
    description: 'The owner of a quiet late-night tavern.',
    tags: ['tavern'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildCharacterSystemPrompt', () => {
  it('separates the model performer, character role, and player role', () => {
    const prompt = buildCharacterSystemPrompt(
      makeCharacter({
        personality: 'Reserved, observant, and warm once trust is earned.',
        userPersona: 'A traveler carrying a sealed letter.',
        worldSetting: 'A rain-soaked port city where names have power.',
        scenario: 'The player enters just before closing time.',
        outputStyle: 'Use short dialogue and never decide the player actions.',
        exampleDialog: '{{user}}: Are you still open?\n{{char}}: For you, apparently.',
      }),
      {
        relationship: 'They met once before.',
        memory: 'Mira promised to keep the letter safe.',
        currentScene: 'The tavern is empty except for the two of them.',
      }
    )

    expect(prompt).toContain('AI ROLE: Portray the character named "Mira"')
    expect(prompt).toContain('The language model is the performer behind this character')
    expect(prompt).toContain('PLAYER ROLE:\nA traveler carrying a sealed letter.')
    expect(prompt).toContain('WORLD SETTING:')
    expect(prompt).toContain('LONG-TERM STORY MEMORY:')
    expect(prompt).toContain('RESPONSE STYLE:')
    expect(prompt).toContain('Never invent the user')
  })

  it('defaults the player role to the user without taking control of them', () => {
    const prompt = buildCharacterSystemPrompt(makeCharacter())

    expect(prompt).toContain('The user plays themself.')
    expect(prompt).toContain("Never invent the user's dialogue, decisions, thoughts, or actions.")
  })
})

describe('normalizeSillyTavernPayload', () => {
  it('preserves V2Chat roleplay structure when a character is re-imported', () => {
    const character = normalizeSillyTavernPayload({
      id: 'character-2',
      name: 'Iris',
      description: 'An archivist.',
      userPersona: 'A new assistant archivist.',
      worldSetting: 'A library outside ordinary time.',
      outputStyle: 'Concise and atmospheric.',
      tags: ['archive'],
      createdAt: 10,
      updatedAt: 20,
    })

    expect(character).toMatchObject({
      id: 'character-2',
      userPersona: 'A new assistant archivist.',
      worldSetting: 'A library outside ordinary time.',
      outputStyle: 'Concise and atmospheric.',
      createdAt: 10,
      updatedAt: 20,
    })
  })
})
