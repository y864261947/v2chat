import {
  CapacitorSQLite,
  SQLiteConnection,
  type capSQLiteSet,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import type { SessionMetaPage, SessionMetaRecord } from '@shared/types'
import { type SessionMetaStorage, sortSessionRecords } from './SessionMetaStorage'

const DB_NAME = 'chatbox-session-meta'

function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseImageSource(value: string | null | undefined): SessionMetaRecord['backgroundImage'] {
  const parsed = safeJsonParse(value)
  if (!parsed || typeof parsed !== 'object') return undefined
  if ('type' in parsed && parsed.type === 'url' && 'url' in parsed && typeof parsed.url === 'string') {
    return { type: 'url', url: parsed.url }
  }
  if (
    'type' in parsed &&
    parsed.type === 'storage-key' &&
    'storageKey' in parsed &&
    typeof parsed.storageKey === 'string'
  ) {
    return { type: 'storage-key', storageKey: parsed.storageKey }
  }
  return undefined
}

function parseTags(value: string | null | undefined) {
  const parsed = safeJsonParse(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined
}

function parseBackgroundAppearance(value: string | null | undefined): SessionMetaRecord['backgroundAppearance'] {
  const parsed = safeJsonParse(value)
  if (!parsed || typeof parsed !== 'object') return undefined
  const opacity = 'opacity' in parsed ? parsed.opacity : undefined
  const dim = 'dim' in parsed ? parsed.dim : undefined
  const blur = 'blur' in parsed ? parsed.blur : undefined
  if (typeof opacity !== 'number' || typeof dim !== 'number' || typeof blur !== 'number') return undefined
  return {
    opacity: Math.min(1, Math.max(0.2, opacity)),
    dim: Math.min(0.7, Math.max(0, dim)),
    blur: Math.min(16, Math.max(0, blur)),
  }
}

export class SQLiteSessionMetaStorage implements SessionMetaStorage {
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initPromise: Promise<void> | null = null

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
  }

  initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.openDatabase()
    return this.initPromise
  }

  private async openDatabase(): Promise<void> {
    try {
      this.sqlite.closeConnection(DB_NAME, false)
    } catch {
      // ignore - connection may not exist
    }

    this.database = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
    await this.database.open()

    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS session_meta (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        starred INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        assistant_avatar_key TEXT,
        pic_url TEXT,
        character_id TEXT,
        character_description TEXT,
        character_relationship TEXT,
        character_memory TEXT,
        character_memory_updated_at INTEGER,
        current_scene TEXT,
        character_tags TEXT,
        character_voice_id TEXT,
        background_image TEXT,
        background_appearance TEXT,
        standing_image TEXT,
        type TEXT,
        conversation_mode TEXT,
        sort_order REAL NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    await this.ensureColumn('character_id', 'TEXT')
    await this.ensureColumn('character_description', 'TEXT')
    await this.ensureColumn('character_relationship', 'TEXT')
    await this.ensureColumn('character_memory', 'TEXT')
    await this.ensureColumn('character_memory_updated_at', 'INTEGER')
    await this.ensureColumn('current_scene', 'TEXT')
    await this.ensureColumn('character_tags', 'TEXT')
    await this.ensureColumn('character_voice_id', 'TEXT')
    await this.ensureColumn('background_appearance', 'TEXT')
    await this.ensureColumn('standing_image', 'TEXT')
    await this.ensureColumn('conversation_mode', 'TEXT')

    await this.database.execute(`
      CREATE INDEX IF NOT EXISTS idx_session_meta_sort_order
      ON session_meta(sort_order DESC)
    `)
  }

  private async ensureColumn(name: string, type: string): Promise<void> {
    try {
      await this.database.execute(`ALTER TABLE session_meta ADD COLUMN ${name} ${type}`)
    } catch {
      // SQLite has no IF NOT EXISTS for ADD COLUMN. Ignore duplicate-column errors.
    }
  }

  private recordToRow(record: SessionMetaRecord): Record<string, unknown> {
    return {
      id: record.id,
      name: record.name,
      starred: record.starred ? 1 : 0,
      hidden: record.hidden ? 1 : 0,
      assistant_avatar_key: record.assistantAvatarKey || null,
      pic_url: record.picUrl || null,
      character_id: record.characterId || null,
      character_description: record.characterDescription || null,
      character_relationship: record.characterRelationship || null,
      character_memory: record.characterMemory || null,
      character_memory_updated_at: record.characterMemoryUpdatedAt || null,
      current_scene: record.currentScene || null,
      character_tags: record.characterTags ? JSON.stringify(record.characterTags) : null,
      character_voice_id: record.characterVoiceId || null,
      background_image: record.backgroundImage ? JSON.stringify(record.backgroundImage) : null,
      background_appearance: record.backgroundAppearance ? JSON.stringify(record.backgroundAppearance) : null,
      standing_image: record.standingImage ? JSON.stringify(record.standingImage) : null,
      type: record.type || null,
      conversation_mode: record.conversationMode || (record.characterId ? 'roleplay' : 'assistant'),
      sort_order: record.sortOrder,
      created_at: record.createdAt,
    }
  }

  private rowToRecord(row: Record<string, unknown>): SessionMetaRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      starred: row.starred === 1 ? true : undefined,
      hidden: row.hidden === 1 ? true : undefined,
      assistantAvatarKey: (row.assistant_avatar_key as string) || undefined,
      picUrl: (row.pic_url as string) || undefined,
      characterId: (row.character_id as string) || undefined,
      characterDescription: (row.character_description as string) || undefined,
      characterRelationship: (row.character_relationship as string) || undefined,
      characterMemory: (row.character_memory as string) || undefined,
      characterMemoryUpdatedAt: (row.character_memory_updated_at as number) || undefined,
      currentScene: (row.current_scene as string) || undefined,
      characterTags: parseTags(row.character_tags as string),
      characterVoiceId: (row.character_voice_id as string) || undefined,
      backgroundImage: parseImageSource(row.background_image as string),
      backgroundAppearance: parseBackgroundAppearance(row.background_appearance as string),
      standingImage: parseImageSource(row.standing_image as string),
      type: (row.type as SessionMetaRecord['type']) || undefined,
      conversationMode:
        (row.conversation_mode as SessionMetaRecord['conversationMode']) ||
        ((row.character_id as string) ? 'roleplay' : 'assistant'),
      sortOrder: row.sort_order as number,
      createdAt: row.created_at as number,
    }
  }

  async create(record: SessionMetaRecord): Promise<void> {
    await this.initialize()
    const row = this.recordToRow(record)
    await this.database.run(
      `INSERT INTO session_meta
       (id, name, starred, hidden, assistant_avatar_key, pic_url, character_id, character_description,
        character_relationship, character_memory, character_memory_updated_at, current_scene, character_tags, character_voice_id,
        background_image, background_appearance, standing_image, type, conversation_mode, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.starred,
        row.hidden,
        row.assistant_avatar_key,
        row.pic_url,
        row.character_id,
        row.character_description,
        row.character_relationship,
        row.character_memory,
        row.character_memory_updated_at,
        row.current_scene,
        row.character_tags,
        row.character_voice_id,
        row.background_image,
        row.background_appearance,
        row.standing_image,
        row.type,
        row.conversation_mode,
        row.sort_order,
        row.created_at,
      ]
    )
  }

  async createMany(records: SessionMetaRecord[]): Promise<void> {
    await this.initialize()
    if (records.length === 0) return

    const statement = `INSERT OR REPLACE INTO session_meta
      (id, name, starred, hidden, assistant_avatar_key, pic_url, character_id, character_description,
       character_relationship, character_memory, character_memory_updated_at, current_scene, character_tags, character_voice_id,
        background_image, background_appearance, standing_image, type, conversation_mode, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const set: capSQLiteSet[] = records.map((record) => {
      const row = this.recordToRow(record)
      return {
        statement,
        values: [
          row.id,
          row.name,
          row.starred,
          row.hidden,
          row.assistant_avatar_key,
          row.pic_url,
          row.character_id,
          row.character_description,
          row.character_relationship,
          row.character_memory,
          row.character_memory_updated_at,
          row.current_scene,
          row.character_tags,
          row.character_voice_id,
          row.background_image,
          row.background_appearance,
          row.standing_image,
          row.type,
          row.conversation_mode,
          row.sort_order,
          row.created_at,
        ],
      }
    })

    await this.database.executeSet(set, true)
  }

  async update(id: string, updates: Partial<SessionMetaRecord>): Promise<SessionMetaRecord | null> {
    await this.initialize()
    const existing = await this.getById(id)
    if (!existing) return null

    const updated = { ...existing, ...updates }
    const row = this.recordToRow(updated)

    await this.database.run(
      `UPDATE session_meta SET
       name = ?, starred = ?, hidden = ?, assistant_avatar_key = ?, pic_url = ?,
       character_id = ?, character_description = ?, character_relationship = ?, character_memory = ?,
       character_memory_updated_at = ?, current_scene = ?, character_tags = ?, character_voice_id = ?,
       background_image = ?, background_appearance = ?, standing_image = ?, type = ?, conversation_mode = ?, sort_order = ?, created_at = ?
       WHERE id = ?`,
      [
        row.name,
        row.starred,
        row.hidden,
        row.assistant_avatar_key,
        row.pic_url,
        row.character_id,
        row.character_description,
        row.character_relationship,
        row.character_memory,
        row.character_memory_updated_at,
        row.current_scene,
        row.character_tags,
        row.character_voice_id,
        row.background_image,
        row.background_appearance,
        row.standing_image,
        row.type,
        row.conversation_mode,
        row.sort_order,
        row.created_at,
        id,
      ]
    )

    return updated
  }

  async getById(id: string): Promise<SessionMetaRecord | null> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM session_meta WHERE id = ?', [id])
    if (!result.values || result.values.length === 0) return null
    return this.rowToRecord(result.values[0])
  }

  async delete(id: string): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM session_meta WHERE id = ?', [id])
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.initialize()
    if (ids.length === 0) return
    const set: capSQLiteSet[] = ids.map((id) => ({
      statement: 'DELETE FROM session_meta WHERE id = ?',
      values: [id],
    }))
    await this.database.executeSet(set, true)
  }

  async getAll(): Promise<SessionMetaRecord[]> {
    await this.initialize()
    const result = await this.database.query('SELECT * FROM session_meta ORDER BY sort_order DESC')
    const records = (result.values || []).map((row) => this.rowToRecord(row))
    return sortSessionRecords(records)
  }

  async getPage(cursor: number = 0, limit: number = 50): Promise<SessionMetaPage> {
    await this.initialize()
    const result = await this.database.query(
      'SELECT * FROM session_meta WHERE hidden = 0 ORDER BY starred DESC, sort_order DESC LIMIT ? OFFSET ?',
      [limit, cursor]
    )
    const items = (result.values || []).map((row) => this.rowToRecord(row))
    const total = await this.getTotal()
    const nextCursor = items.length === limit ? cursor + items.length : null
    return { items, nextCursor, total }
  }

  async getTotal(): Promise<number> {
    await this.initialize()
    const result = await this.database.query('SELECT COUNT(*) as total FROM session_meta WHERE hidden = 0')
    return (result.values?.[0]?.total as number) || 0
  }

  async clear(): Promise<void> {
    await this.initialize()
    await this.database.run('DELETE FROM session_meta')
  }
}
