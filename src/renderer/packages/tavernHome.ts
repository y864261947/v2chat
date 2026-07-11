import type { SessionMetaRecord } from '@shared/types'
import { V2API_GUIDE_SESSION_ID } from './initial_data'

export function isTavernColdStart(characterCount: number, sessions: SessionMetaRecord[]) {
  return (
    characterCount === 0 &&
    !sessions.some((session) => !session.hidden && session.type !== 'picture' && session.id !== V2API_GUIDE_SESSION_ID)
  )
}
