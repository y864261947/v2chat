import { Button, Divider, Flex, Modal, PasswordInput, Progress, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { IconFileExport, IconFileImport } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import {
  type PreparedBackupRestore,
  createPortableLocalBackup,
  getLocalBackupKeyMode,
  prepareLocalBackupRestore,
  restorePreparedBackup,
} from '@/packages/v2chatBackup'
import { add as addToast } from '@/stores/toastActions'

export default function BackupPanel() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [prepared, setPrepared] = useState<PreparedBackupRestore | null>(null)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge')
  const [exportPassword, setExportPassword] = useState('')
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('')
  const [showLocalExport, setShowLocalExport] = useState(false)
  const [pendingLocalFile, setPendingLocalFile] = useState<File | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const runProgress = (value: number, label: string) => {
    setProgress(value)
    setProgressLabel(label)
  }

  const resetProgress = () => {
    setProgress(0)
    setProgressLabel('')
  }

  const inspectLocal = async (file: File, password?: string) => {
    setBusy(true)
    try {
      setPrepared(await prepareLocalBackupRestore(file, password))
      setPendingLocalFile(null)
      setImportPassword('')
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      resetProgress()
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const exportLocal = async () => {
    if (exportPassword.length < 8) {
      addToast('备份密码至少需要 8 个字符')
      return
    }
    if (exportPassword !== exportPasswordConfirm) {
      addToast('两次输入的备份密码不一致')
      return
    }
    setBusy(true)
    try {
      await createPortableLocalBackup(exportPassword, runProgress)
      setShowLocalExport(false)
      setExportPassword('')
      setExportPasswordConfirm('')
      addToast('完整本地备份已导出')
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      resetProgress()
    }
  }

  const restore = async () => {
    if (!prepared) return
    setBusy(true)
    try {
      await restorePreparedBackup(prepared, restoreMode, runProgress)
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
      resetProgress()
    }
  }

  return (
    <>
      <Stack gap="md">
        <Flex align="center" justify="space-between" gap="md" wrap="wrap">
          <Stack gap={1}>
            <Title order={6}>本地加密备份</Title>
            <Text size="xs" c="chatbox-tertiary">
              包含角色、会话、图片、语音、背景和附件，不包含账号 Token 与 API Key
            </Text>
          </Stack>
          <Flex gap="xs" wrap="wrap">
            <input
              ref={fileInput}
              type="file"
              accept=".v2backup,application/vnd.v2chat.backup"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (!file) return
                void getLocalBackupKeyMode(file)
                  .then((mode) => {
                    if (mode === 'password') setPendingLocalFile(file)
                    else void inspectLocal(file)
                  })
                  .catch((cause) => addToast(cause instanceof Error ? cause.message : String(cause)))
              }}
            />
            <Button
              size="compact-sm"
              variant="default"
              disabled={busy}
              leftSection={<ScalableIcon icon={IconFileImport} size={15} />}
              onClick={() => fileInput.current?.click()}
            >
              导入备份
            </Button>
            <Button
              size="compact-sm"
              disabled={busy}
              leftSection={<ScalableIcon icon={IconFileExport} size={15} />}
              onClick={() => setShowLocalExport(true)}
            >
              导出备份
            </Button>
          </Flex>
        </Flex>
        {busy && progress > 0 && (
          <Stack gap={5}>
            <Progress value={progress} animated />
            <Text size="xs" c="chatbox-tertiary" ta="right">
              {progressLabel} {progress}%
            </Text>
          </Stack>
        )}
      </Stack>

      <Modal opened={Boolean(prepared)} onClose={() => !busy && setPrepared(null)} title="确认恢复 V2Chat 数据" centered>
        {prepared && (
          <Stack gap="md">
            <Text size="sm" c="chatbox-secondary">
              {prepared.preview.counts.characters} 个角色 · {prepared.preview.counts.sessions} 个会话 ·{' '}
              {prepared.preview.counts.messages} 条消息 · {prepared.preview.counts.blobs} 个附件
            </Text>
            <Divider />
            <SegmentedControl
              fullWidth
              value={restoreMode}
              onChange={(value) => setRestoreMode(value as 'merge' | 'replace')}
              data={[
                { value: 'merge', label: '合并（推荐）' },
                { value: 'replace', label: '覆盖本机' },
              ]}
            />
            <Text size="xs" c={restoreMode === 'replace' ? 'chatbox-warning' : 'chatbox-tertiary'}>
              {restoreMode === 'replace'
                ? '覆盖前会自动导出一份本机加密安全快照。'
                : '同 ID 内容使用备份版本，本机独有的角色和会话会保留。'}
            </Text>
            {busy && (
              <Stack gap={5}>
                <Progress value={progress} animated />
                <Text size="xs" ta="right">
                  {progressLabel} {progress}%
                </Text>
              </Stack>
            )}
            <Button loading={busy} onClick={() => void restore()}>
              开始恢复
            </Button>
          </Stack>
        )}
      </Modal>

      <Modal opened={showLocalExport} onClose={() => !busy && setShowLocalExport(false)} title="导出完整本地备份" centered>
        <Stack gap="md">
          <Text size="sm" c="chatbox-secondary">
            备份密码用于换机恢复。V2Chat 不会保存密码，遗忘后无法解密。
          </Text>
          <PasswordInput label="备份密码" value={exportPassword} onChange={(event) => setExportPassword(event.currentTarget.value)} />
          <PasswordInput
            label="再次输入"
            value={exportPasswordConfirm}
            onChange={(event) => setExportPasswordConfirm(event.currentTarget.value)}
          />
          {busy && (
            <Stack gap={5}>
              <Progress value={progress} animated />
              <Text size="xs" ta="right">
                {progressLabel} {progress}%
              </Text>
            </Stack>
          )}
          <Button loading={busy} disabled={exportPassword.length < 8} onClick={() => void exportLocal()}>
            加密并导出
          </Button>
        </Stack>
      </Modal>

      <Modal opened={Boolean(pendingLocalFile)} onClose={() => !busy && setPendingLocalFile(null)} title="输入备份密码" centered>
        <Stack gap="md">
          <Text size="sm" c="chatbox-secondary" lineClamp={1}>
            {pendingLocalFile?.name}
          </Text>
          <PasswordInput autoFocus value={importPassword} onChange={(event) => setImportPassword(event.currentTarget.value)} />
          <Button
            loading={busy}
            disabled={!importPassword || !pendingLocalFile}
            onClick={() => pendingLocalFile && void inspectLocal(pendingLocalFile, importPassword)}
          >
            解密并预览
          </Button>
        </Stack>
      </Modal>
    </>
  )
}
