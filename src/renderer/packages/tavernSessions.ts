import { createSession } from '@/stores/chatStore'
import { switchCurrentSession } from '@/stores/sessionActions'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import type { TavernCharacter } from './tavernCharacters'
import { buildRoleplaySessionDraft } from './tavernSessionDraft'

export async function createRoleplaySession(character: TavernCharacter) {
  const session = await createSession(buildRoleplaySessionDraft(character, initEmptyChatSession()))
  switchCurrentSession(session.id)
  return session
}
