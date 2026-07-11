import type { SessionMetaRecord } from '@shared/types'

export function buildRoleplayWindowLabels(sessions: SessionMetaRecord[]) {
  const chronological = [...sessions].sort((a, b) => a.createdAt - b.createdAt)
  const totals = new Map<string, number>()
  const current = new Map<string, number>()
  const labels = new Map<string, string>()

  for (const session of chronological) {
    if (session.characterId) totals.set(session.characterId, (totals.get(session.characterId) ?? 0) + 1)
  }
  for (const session of chronological) {
    if (!session.characterId) continue
    const index = (current.get(session.characterId) ?? 0) + 1
    current.set(session.characterId, index)
    labels.set(session.id, (totals.get(session.characterId) ?? 0) > 1 ? `窗口 ${index}` : '角色窗口')
  }
  return labels
}
