import type { SessionMetaRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { V2API_GUIDE_SESSION_ID } from './initial_data'
import { isTavernColdStart } from './tavernHome'

function session(id: string, type: SessionMetaRecord['type'] = 'chat'): SessionMetaRecord {
  return { id, name: id, type, sortOrder: 1, createdAt: 1 }
}

describe('isTavernColdStart', () => {
  it('treats the built-in V2API guide as cold-start content', () => {
    expect(isTavernColdStart(0, [session(V2API_GUIDE_SESSION_ID)])).toBe(true)
  })

  it('hides cold-start content once a role or user conversation exists', () => {
    expect(isTavernColdStart(1, [])).toBe(false)
    expect(isTavernColdStart(0, [session('user-chat')])).toBe(false)
  })
})
