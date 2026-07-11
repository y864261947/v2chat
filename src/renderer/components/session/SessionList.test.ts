import type { SessionMetaRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildRoleplayWindowLabels } from './sessionWindowLabels'

function session(id: string, characterId: string | undefined, createdAt: number): SessionMetaRecord {
  return { id, name: id, characterId, sortOrder: createdAt, createdAt }
}

describe('buildRoleplayWindowLabels', () => {
  it('numbers independent windows belonging to the same character', () => {
    const labels = buildRoleplayWindowLabels([
      session('newer', 'mira', 20),
      session('plain', undefined, 30),
      session('older', 'mira', 10),
      session('solo', 'iris', 15),
    ])

    expect(labels.get('older')).toBe('窗口 1')
    expect(labels.get('newer')).toBe('窗口 2')
    expect(labels.get('solo')).toBe('角色窗口')
    expect(labels.has('plain')).toBe(false)
  })
})
