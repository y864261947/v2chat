import { Sha256 } from '@aws-crypto/sha256-js'
import type { ImageGeneration, SessionMetaRecord, TaskSession } from '@shared/types'
import { getV2ChatServiceBaseUrl } from '@shared/v2api'
import platform from '@/platform'
import { secureCredentials } from '@/platform/secureCredentials'
import storage, { StorageKey } from '@/storage'
import type { TavernCharacter } from '@/packages/tavernCharacters'
import { getTavernCharacters, saveTavernCharacters } from '@/packages/tavernCharacters'
import { v2chatAuthenticatedFetch } from '@/stores/v2chatAccountStore'

const MAGIC = 'V2CHAT-BACKUP v1\n'
const ARCHIVE_CHUNK_SIZE = 1024 * 1024
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024
const DEVICE_MASTER_KEY = 'backup-device-master-v1'
const textEncoder = new TextEncoder()

type RestoreMode = 'merge' | 'replace'
type ArchiveRecord =
  | { type: 'manifest'; manifest: BackupManifest }
  | { type: 'value'; key: string; value: unknown }
  | { type: 'character'; value: TavernCharacter }
  | { type: 'session-meta'; value: SessionMetaRecord }
  | { type: 'image-generation'; value: ImageGeneration }
  | { type: 'task-session'; value: TaskSession }
  | { type: 'blob'; key: string; value: string }
  | { type: 'end'; recordCount: number }

interface BackupManifest {
  format: 'V2CHAT-BACKUP'
  version: 1
  createdAt: string
  counts: BackupCounts
}

export interface BackupCounts {
  sessions: number
  messages: number
  characters: number
  blobs: number
  sessionMeta: number
  imageGenerations: number
  taskSessions: number
  estimatedBytes: number
}

interface ArchiveHeader {
  format: 'V2CHAT-BACKUP'
  version: 1
  cipher: 'AES-256-GCM-CHUNKED'
  chunkSize: number
  keyMode: 'server' | 'device' | 'password'
  keyId?: string
  wrappedKey?: string
  wrapIV?: string
  salt?: string
  iterations?: number
}

interface BackupSource {
  valueKeys: string[]
  characters: TavernCharacter[]
  sessionMeta: SessionMetaRecord[]
  imageGenerations: ImageGeneration[]
  taskSessions: TaskSession[]
  blobKeys: string[]
  counts: BackupCounts
}

export interface CloudBackupSnapshot {
  id: string
  status: string
  size_bytes: number
  sha256: string
  schema_version: number
  completed_at?: string
  created_at: string
}

export interface PreparedBackupRestore {
  blob: Blob
  dataKey: Uint8Array
  preview: BackupManifest
  source: 'cloud' | 'local'
}

export async function listCloudBackups() {
  const response = await v2chatAuthenticatedFetch(`${apiBase()}/backups`)
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<{
    data: CloudBackupSnapshot[]
    max_bytes: number
    retained_snapshots: number
  }>
}

export async function createCloudBackup(onProgress?: (progress: number, label: string) => void) {
  onProgress?.(2, '扫描本地数据')
  const source = await collectBackupSource()
  const initResponse = await v2chatAuthenticatedFetch(`${apiBase()}/backups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema_version: 1, estimated_size_bytes: Math.max(1, source.counts.estimatedBytes) }),
  })
  if (!initResponse.ok) throw await responseError(initResponse)
  const initialized = (await initResponse.json()) as {
    snapshot: CloudBackupSnapshot
    data_key: string
  }

  onProgress?.(12, '加密备份')
  const dataKey = base64ToBytes(initialized.data_key)
  const archive = await buildEncryptedArchive(source, dataKey, { keyMode: 'server' }, (value) => {
    onProgress?.(12 + Math.round(value * 0.28), '加密备份')
  })
  const chunkCount = Math.ceil(archive.blob.size / UPLOAD_CHUNK_SIZE)
  const prepareResponse = await v2chatAuthenticatedFetch(`${apiBase()}/backups/${initialized.snapshot.id}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size_bytes: archive.blob.size,
      sha256: archive.sha256,
      chunk_size: UPLOAD_CHUNK_SIZE,
      chunk_count: chunkCount,
    }),
  })
  if (!prepareResponse.ok) throw await responseError(prepareResponse)

  for (let index = 0; index < chunkCount; index++) {
    const chunk = archive.blob.slice(index * UPLOAD_CHUNK_SIZE, Math.min((index + 1) * UPLOAD_CHUNK_SIZE, archive.blob.size))
    const bytes = new Uint8Array(await chunk.arrayBuffer())
    const chunkHash = await sha256Hex(bytes)
    const uploadResponse = await v2chatAuthenticatedFetch(
      `${apiBase()}/backups/${initialized.snapshot.id}/chunks/${index}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-SHA256': chunkHash }, body: bytes }
    )
    if (!uploadResponse.ok) throw await responseError(uploadResponse)
    onProgress?.(40 + Math.round(((index + 1) / chunkCount) * 55), `上传分片 ${index + 1}/${chunkCount}`)
  }

  const completeResponse = await v2chatAuthenticatedFetch(`${apiBase()}/backups/${initialized.snapshot.id}/complete`, {
    method: 'POST',
  })
  if (!completeResponse.ok) throw await responseError(completeResponse)
  onProgress?.(100, '备份完成')
  return completeResponse.json() as Promise<CloudBackupSnapshot>
}

export async function prepareCloudBackupRestore(id: string, onProgress?: (progress: number, label: string) => void) {
  onProgress?.(5, '下载加密备份')
  const response = await v2chatAuthenticatedFetch(`${apiBase()}/backups/${encodeURIComponent(id)}/content`)
  if (!response.ok) throw await responseError(response)
  const encodedKey = response.headers.get('X-Backup-Data-Key')
  if (!encodedKey) throw new Error('备份数据密钥缺失')
  const blob = await response.blob()
  onProgress?.(70, '验证备份完整性')
  const dataKey = base64ToBytes(encodedKey)
  const preview = await validateEncryptedArchive(blob, dataKey)
  onProgress?.(100, '可以恢复')
  return { blob, dataKey, preview, source: 'cloud' } satisfies PreparedBackupRestore
}

export async function getLocalBackupKeyMode(file: File) {
  return (await readArchiveHeader(file)).keyMode
}

export async function createPortableLocalBackup(
  password: string,
  onProgress?: (progress: number, label: string) => void
) {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符')
  onProgress?.(5, '扫描本地数据')
  const source = await collectBackupSource()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iterations = 210_000
  const dataKey = await derivePasswordKey(password, salt, iterations)
  onProgress?.(20, '加密本地备份')
  const archive = await buildEncryptedArchive(
    source,
    dataKey,
    { keyMode: 'password', salt: bytesToBase64(salt), iterations },
    (value) => onProgress?.(20 + Math.round(value * 75), '加密本地备份')
  )
  const stamp = new Date().toISOString().slice(0, 10)
  await platform.exporter.exportBlob(`V2Chat-full-backup-${stamp}.v2backup`, archive.blob)
  onProgress?.(100, '本地备份已导出')
}

export async function prepareLocalBackupRestore(file: File, password?: string) {
  const header = await readArchiveHeader(file)
  let dataKey: Uint8Array
  if (header.keyMode === 'password') {
    if (!password) throw new Error('请输入这份备份的密码')
    if (!header.salt || !header.iterations || header.iterations < 100_000) throw new Error('备份密码参数无效')
    dataKey = await derivePasswordKey(password, base64ToBytes(header.salt), header.iterations)
  } else if (header.keyMode === 'device') {
    if (!header.wrappedKey || !header.wrapIV) throw new Error('本地安全快照密钥信息不完整')
    const master = await getDeviceMasterKey(false)
    if (!master) throw new Error('本设备的安全快照密钥已丢失')
    const wrappingKey = await importAESKey(master)
    const unwrapped = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(base64ToBytes(header.wrapIV)),
        additionalData: toArrayBuffer(textEncoder.encode('v2chat-local-backup-key-v1')),
      },
      wrappingKey,
      toArrayBuffer(base64ToBytes(header.wrappedKey))
    )
    dataKey = new Uint8Array(unwrapped)
  } else {
    throw new Error('云备份文件需要通过账号下载恢复')
  }
  let preview: BackupManifest
  try {
    preview = await validateEncryptedArchive(file, dataKey)
  } catch (error) {
    if (header.keyMode === 'password') throw new Error('备份密码错误，或文件已经损坏')
    throw error
  }
  return { blob: file, dataKey, preview, source: 'local' } satisfies PreparedBackupRestore
}

export async function restorePreparedBackup(
  prepared: PreparedBackupRestore,
  mode: RestoreMode,
  onProgress?: (progress: number, label: string) => void
) {
  if (mode === 'replace') {
    onProgress?.(2, '创建本地安全快照')
    await createLocalSafetySnapshot()
    onProgress?.(12, '清理待覆盖数据')
    await clearRestorableData()
  }

  const characters: TavernCharacter[] = []
  const sessionMeta: SessionMetaRecord[] = []
  const imageGenerations: ImageGeneration[] = []
  const taskSessions: TaskSession[] = []
  let processed = 0
  const expectedRecords = totalDataRecords(prepared.preview)

  await parseEncryptedArchive(prepared.blob, prepared.dataKey, async (record) => {
    if (record.type === 'value') await restoreValue(record.key, record.value, mode)
    if (record.type === 'blob') await storage.setBlob(record.key, record.value)
    if (record.type === 'character') characters.push(record.value)
    if (record.type === 'session-meta') sessionMeta.push(record.value)
    if (record.type === 'image-generation') imageGenerations.push(record.value)
    if (record.type === 'task-session') taskSessions.push(record.value)
    if (record.type !== 'manifest' && record.type !== 'end') {
      processed++
      if (processed % 10 === 0 || processed === expectedRecords) {
        onProgress?.(15 + Math.round((processed / Math.max(1, expectedRecords)) * 75), '恢复数据')
      }
    }
  })

  await restoreStructuredStores({ characters, sessionMeta, imageGenerations, taskSessions }, mode)
  onProgress?.(100, '恢复完成')
  await platform.relaunch()
}

export async function deleteCloudBackup(id: string) {
  const response = await v2chatAuthenticatedFetch(`${apiBase()}/backups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw await responseError(response)
}

async function collectBackupSource(): Promise<BackupSource> {
  const valueKeys = (await storage.getAllKeys()).filter((key) => key !== StorageKey.Configs && key !== StorageKey.AuthInfo)
  const characters = getTavernCharacters()
  const sessionMetaStorage = platform.getSessionMetaStorage()
  await sessionMetaStorage.initialize()
  const sessionMeta = await sessionMetaStorage.getAll()
  const imageGenerations = await collectPaged(platform.getImageGenerationStorage())
  const taskSessions = await collectPaged(platform.getTaskSessionStorage())
  const allBlobKeys = new Set(await storage.getBlobKeys())
  const referenced = new Set<string>()
  let sessions = 0
  let messages = 0
  let estimatedBytes = 0

  for (const key of valueKeys) {
    const value = sanitizeValue(key, await platform.getStoreValue(key))
    collectBlobReferences(value, allBlobKeys, referenced)
    if (key.startsWith('session:')) {
      sessions++
      if (value && typeof value === 'object' && Array.isArray((value as { messages?: unknown[] }).messages)) {
        messages += (value as { messages: unknown[] }).messages.length
      }
    }
    estimatedBytes += textEncoder.encode(JSON.stringify({ type: 'value', key, value })).length + 1
  }
  for (const value of [...characters, ...sessionMeta, ...imageGenerations, ...taskSessions]) {
    collectBlobReferences(value, allBlobKeys, referenced)
    estimatedBytes += textEncoder.encode(JSON.stringify(value)).length + 64
  }
  for (const key of referenced) {
    const value = await storage.getBlob(key)
    if (value != null) estimatedBytes += textEncoder.encode(value).length + key.length + 64
  }

  const blobKeys = [...referenced].filter((key) => allBlobKeys.has(key)).sort()
  return {
    valueKeys, characters, sessionMeta, imageGenerations, taskSessions, blobKeys,
    counts: {
      sessions, messages, characters: characters.length, blobs: blobKeys.length,
      sessionMeta: sessionMeta.length, imageGenerations: imageGenerations.length,
      taskSessions: taskSessions.length, estimatedBytes,
    },
  }
}

async function buildEncryptedArchive(
  source: BackupSource,
  dataKey: Uint8Array,
  headerExtras: Pick<ArchiveHeader, 'keyMode' | 'keyId' | 'wrappedKey' | 'wrapIV' | 'salt' | 'iterations'>,
  onProgress?: (progress: number) => void
) {
  const header: ArchiveHeader = {
    format: 'V2CHAT-BACKUP', version: 1, cipher: 'AES-256-GCM-CHUNKED', chunkSize: ARCHIVE_CHUNK_SIZE,
    ...headerExtras,
  }
  const headerBytes = textEncoder.encode(`${MAGIC}${JSON.stringify(header)}\n`)
  const writer = new EncryptedArchiveWriter(dataKey, headerBytes)
  const manifest: BackupManifest = {
    format: 'V2CHAT-BACKUP', version: 1, createdAt: new Date().toISOString(), counts: source.counts,
  }
  let recordCount = 0
  const total = Math.max(1, totalDataRecords(manifest))
  const writeRecord = async (record: Exclude<ArchiveRecord, { type: 'end' }>) => {
    await writer.writeJSON(record)
    recordCount++
    onProgress?.(Math.min(1, recordCount / total))
  }

  await writeRecord({ type: 'manifest', manifest })
  for (const key of source.valueKeys) {
    await writeRecord({ type: 'value', key, value: sanitizeValue(key, await platform.getStoreValue(key)) })
  }
  for (const value of source.characters) await writeRecord({ type: 'character', value })
  for (const value of source.sessionMeta) await writeRecord({ type: 'session-meta', value })
  for (const value of source.imageGenerations) await writeRecord({ type: 'image-generation', value })
  for (const value of source.taskSessions) await writeRecord({ type: 'task-session', value })
  for (const key of source.blobKeys) {
    const value = await storage.getBlob(key)
    if (value != null) await writeRecord({ type: 'blob', key, value })
  }
  await writer.writeJSON({ type: 'end', recordCount })
  return writer.finish()
}

class EncryptedArchiveWriter {
  private readonly parts: BlobPart[] = []
  private readonly hash = new Sha256()
  private readonly buffer = new Uint8Array(ARCHIVE_CHUNK_SIZE)
  private readonly keyPromise: Promise<CryptoKey>
  private offset = 0

  constructor(dataKey: Uint8Array, private readonly additionalData: Uint8Array) {
    this.parts.push(toArrayBuffer(additionalData))
    this.hash.update(additionalData)
    this.keyPromise = importAESKey(dataKey)
  }

  async writeJSON(record: ArchiveRecord) {
    await this.write(textEncoder.encode(`${JSON.stringify(record)}\n`))
  }

  async finish() {
    await this.flush()
    const digest = await this.hash.digest()
    return {
      blob: new Blob(this.parts, { type: 'application/vnd.v2chat.backup' }),
      sha256: bytesToHex(digest),
    }
  }

  private async write(bytes: Uint8Array) {
    let inputOffset = 0
    while (inputOffset < bytes.length) {
      const count = Math.min(this.buffer.length - this.offset, bytes.length - inputOffset)
      this.buffer.set(bytes.subarray(inputOffset, inputOffset + count), this.offset)
      this.offset += count
      inputOffset += count
      if (this.offset === this.buffer.length) await this.flush()
    }
  }

  private async flush() {
    if (this.offset === 0) return
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(this.additionalData) },
      await this.keyPromise,
      toArrayBuffer(this.buffer.slice(0, this.offset))
    ))
    const frame = new Uint8Array(4 + iv.length)
    new DataView(frame.buffer).setUint32(0, encrypted.length, false)
    frame.set(iv, 4)
    this.parts.push(toArrayBuffer(frame), toArrayBuffer(encrypted))
    this.hash.update(frame)
    this.hash.update(encrypted)
    this.offset = 0
  }
}

async function validateEncryptedArchive(blob: Blob, dataKey: Uint8Array) {
  let manifest: BackupManifest | null = null
  await parseEncryptedArchive(blob, dataKey, (record) => {
    if (record.type === 'manifest') manifest = record.manifest
  })
  if (!manifest) throw new Error('备份缺少清单')
  return manifest
}

async function parseEncryptedArchive(
  blob: Blob,
  dataKey: Uint8Array,
  onRecord: (record: ArchiveRecord) => void | Promise<void>
) {
  const { header, headerBytes, dataOffset } = await readArchiveHeader(blob, true)
  if (header.cipher !== 'AES-256-GCM-CHUNKED') throw new Error('不支持的备份加密格式')
  const key = await importAESKey(dataKey)
  const decoder = new TextDecoder()
  let offset = dataOffset
  let textBuffer = ''
  let recordsSeen = 0
  let endSeen = false

  while (offset < blob.size) {
    const frame = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer())
    if (frame.length !== 16) throw new Error('备份分块头损坏')
    const encryptedLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false)
    if (encryptedLength < 17 || encryptedLength > header.chunkSize + 16) throw new Error('备份分块长度无效')
    const iv = frame.slice(4, 16)
    offset += 16
    const encrypted = await blob.slice(offset, offset + encryptedLength).arrayBuffer()
    if (encrypted.byteLength !== encryptedLength) throw new Error('备份分块不完整')
    offset += encryptedLength
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(headerBytes) },
      key,
      encrypted
    )
    textBuffer += decoder.decode(plain, { stream: true })

    let newline = textBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = textBuffer.slice(0, newline)
      textBuffer = textBuffer.slice(newline + 1)
      if (line) {
        const record = JSON.parse(line) as ArchiveRecord
        if (record.type === 'end') {
          if (record.recordCount !== recordsSeen) throw new Error('备份记录数量不一致')
          endSeen = true
        } else {
          recordsSeen++
        }
        await onRecord(record)
      }
      newline = textBuffer.indexOf('\n')
    }
  }
  textBuffer += decoder.decode()
  if (textBuffer.trim()) throw new Error('备份末尾包含不完整记录')
  if (!endSeen) throw new Error('备份未正常结束')
}

async function readArchiveHeader(blob: Blob, includeBytes?: false): Promise<ArchiveHeader>
async function readArchiveHeader(blob: Blob, includeBytes: true): Promise<{ header: ArchiveHeader; headerBytes: Uint8Array; dataOffset: number }>
async function readArchiveHeader(
  blob: Blob,
  includeBytes = false
): Promise<ArchiveHeader | { header: ArchiveHeader; headerBytes: Uint8Array; dataOffset: number }> {
  const probe = new Uint8Array(await blob.slice(0, Math.min(blob.size, 64 * 1024)).arrayBuffer())
  const magicBytes = textEncoder.encode(MAGIC)
  if (probe.length <= magicBytes.length || !magicBytes.every((value, index) => probe[index] === value)) {
    throw new Error('不是 V2Chat 备份文件')
  }
  const headerEnd = probe.indexOf(10, magicBytes.length)
  if (headerEnd < 0) throw new Error('备份文件头不完整')
  const dataOffset = headerEnd + 1
  const header = JSON.parse(new TextDecoder().decode(probe.slice(magicBytes.length, headerEnd))) as ArchiveHeader
  if (header.format !== 'V2CHAT-BACKUP' || header.version !== 1) throw new Error('不支持的备份版本')
  if (!includeBytes) return header
  return { header, headerBytes: probe.slice(0, dataOffset), dataOffset }
}

async function createLocalSafetySnapshot() {
  const source = await collectBackupSource()
  const master = await getDeviceMasterKey(true)
  if (!master) throw new Error('无法创建设备备份主密钥')
  const dataKey = crypto.getRandomValues(new Uint8Array(32))
  const wrapIV = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(wrapIV),
      additionalData: toArrayBuffer(textEncoder.encode('v2chat-local-backup-key-v1')),
    },
    await importAESKey(master),
    toArrayBuffer(dataKey)
  )
  const id = crypto.randomUUID()
  const archive = await buildEncryptedArchive(source, dataKey, {
    keyMode: 'device', keyId: id, wrappedKey: bytesToBase64(new Uint8Array(wrapped)), wrapIV: bytesToBase64(wrapIV),
  })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await platform.exporter.exportBlob(`V2Chat-safety-${stamp}.v2backup`, archive.blob)
}

async function getDeviceMasterKey(create: boolean) {
  const existing = await secureCredentials.get(DEVICE_MASTER_KEY)
  if (existing) return base64ToBytes(existing)
  if (!create) return null
  const key = crypto.getRandomValues(new Uint8Array(32))
  await secureCredentials.set(DEVICE_MASTER_KEY, bytesToBase64(key))
  return key
}

async function clearRestorableData() {
  const current = await collectBackupSource()
  for (const key of current.valueKeys) await platform.delStoreValue(key)
  for (const key of current.blobKeys) await storage.delBlob(key)

  const sessionMeta = platform.getSessionMetaStorage()
  await sessionMeta.initialize()
  await sessionMeta.clear()
  const imageStorage = platform.getImageGenerationStorage()
  const taskStorage = platform.getTaskSessionStorage()
  for (const record of await collectPaged(imageStorage)) await imageStorage.delete(record.id)
  for (const record of await collectPaged(taskStorage)) await taskStorage.delete(record.id)
  saveTavernCharacters([])
}

async function restoreValue(key: string, incoming: unknown, mode: RestoreMode) {
  if (key === StorageKey.Configs || key === StorageKey.AuthInfo) return
  if (mode === 'merge' && key === StorageKey.ChatSessionsList && Array.isArray(incoming)) {
    const current = await platform.getStoreValue(key)
    const byID = new Map<string, unknown>()
    for (const value of [...(Array.isArray(current) ? current : []), ...incoming]) {
      if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
        byID.set((value as { id: string }).id, value)
      }
    }
    await platform.setStoreValue(key, [...byID.values()])
    return
  }
  if (key === StorageKey.Settings && incoming && typeof incoming === 'object') {
    const current = await platform.getStoreValue(key)
    await platform.setStoreValue(key, { ...(current || {}), ...(incoming as object) })
    return
  }
  await platform.setStoreValue(key, incoming)
}

async function restoreStructuredStores(
  data: {
    characters: TavernCharacter[]
    sessionMeta: SessionMetaRecord[]
    imageGenerations: ImageGeneration[]
    taskSessions: TaskSession[]
  },
  mode: RestoreMode
) {
  if (mode === 'merge') {
    const byID = new Map(getTavernCharacters().map((value) => [value.id, value]))
    for (const value of data.characters) byID.set(value.id, value)
    saveTavernCharacters([...byID.values()])
  } else {
    saveTavernCharacters(data.characters)
  }

  const metaStorage = platform.getSessionMetaStorage()
  await metaStorage.initialize()
  await metaStorage.createMany(data.sessionMeta)
  const imageStorage = platform.getImageGenerationStorage()
  await imageStorage.initialize()
  for (const value of data.imageGenerations) {
    if (await imageStorage.getById(value.id)) await imageStorage.update(value.id, value)
    else await imageStorage.create(value)
  }
  const taskStorage = platform.getTaskSessionStorage()
  await taskStorage.initialize()
  for (const value of data.taskSessions) {
    if (await taskStorage.getById(value.id)) await taskStorage.update(value.id, value)
    else await taskStorage.create(value)
  }
}

async function collectPaged<T extends { id: string }>(store: {
  initialize(): Promise<void>
  getTotal(): Promise<number>
  getPage(cursor: number, limit?: number): Promise<{ items: T[]; nextCursor: number | null }>
}) {
  await store.initialize()
  const output: T[] = []
  let cursor = 0
  while (true) {
    const page = await store.getPage(cursor, 100)
    output.push(...page.items)
    if (page.nextCursor === null) return output
    cursor = page.nextCursor
  }
}

function collectBlobReferences(value: unknown, existing: Set<string>, output: Set<string>) {
  if (typeof value === 'string') {
    if (existing.has(value)) output.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) collectBlobReferences(child, existing, output)
    return
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) collectBlobReferences(child, existing, output)
  }
}

function sanitizeValue(key: string, value: unknown) {
  if (key === StorageKey.Configs || key === StorageKey.AuthInfo) return undefined
  return scrubSecrets(structuredCloneSafe(value))
}

function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(api[_-]?key|.*ApiKey|access[_-]?token|refresh[_-]?token|token|secret|password|licenseKey|licenseDetail|licenseInstances)$/i.test(key)) continue
    output[key] = scrubSecrets(child)
  }
  return output
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function totalDataRecords(manifest: BackupManifest) {
  const counts = manifest.counts
  return 1 + counts.sessions + counts.characters + counts.blobs + counts.sessionMeta + counts.imageGenerations + counts.taskSessions + 8
}

async function importAESKey(raw: Uint8Array) {
  if (raw.length !== 32) throw new Error('备份数据密钥长度无效')
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function derivePasswordKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(textEncoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    material,
    256
  )
  return new Uint8Array(bits)
}

async function sha256Hex(value: Uint8Array) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(value))))
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer
}

function bytesToHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function apiBase() {
  return getV2ChatServiceBaseUrl()
}

async function responseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  return new Error(payload?.error?.message || `备份服务返回 HTTP ${response.status}`)
}

export const __backupTesting = {
  async encode(records: Array<Exclude<ArchiveRecord, { type: 'end' }>>, dataKey: Uint8Array) {
    const header: ArchiveHeader = {
      format: 'V2CHAT-BACKUP', version: 1, cipher: 'AES-256-GCM-CHUNKED',
      chunkSize: ARCHIVE_CHUNK_SIZE, keyMode: 'server',
    }
    const headerBytes = textEncoder.encode(`${MAGIC}${JSON.stringify(header)}\n`)
    const writer = new EncryptedArchiveWriter(dataKey, headerBytes)
    for (const record of records) await writer.writeJSON(record)
    await writer.writeJSON({ type: 'end', recordCount: records.length })
    return writer.finish()
  },
  async decode(blob: Blob, dataKey: Uint8Array) {
    const records: ArchiveRecord[] = []
    await parseEncryptedArchive(blob, dataKey, (record) => {
      records.push(record)
    })
    return records
  },
  scrubSecrets,
}
