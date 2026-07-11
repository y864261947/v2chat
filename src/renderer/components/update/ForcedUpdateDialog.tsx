import { Button, Modal, Progress, Stack, Text } from '@mantine/core'
import { IconDownload, IconRefresh } from '@tabler/icons-react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import {
  checkForAndroidUpdate,
  downloadAndroidUpdate,
  installUpdate,
  useUpdateStore,
} from '@/stores/updateStore'

export default function ForcedUpdateDialog() {
  const status = useUpdateStore((state) => state.status)
  const mandatory = useUpdateStore((state) => state.mandatory)
  const version = useUpdateStore((state) => state.version)
  const progress = useUpdateStore((state) => state.progress)
  const notes = useUpdateStore((state) => state.releaseNotes)
  const error = useUpdateStore((state) => state.error)
  const opened = mandatory && ['available', 'downloading', 'downloaded', 'error'].includes(status)

  return (
    <Modal
      opened={opened}
      onClose={() => undefined}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      title={`V2Chat 需要更新${version ? `到 V${version}` : ''}`}
      size="sm"
    >
      <Stack gap="md">
        <Text size="sm" c="chatbox-secondary">
          当前版本已停止支持，更新完成后可以继续使用账号、积分和聊天服务。
        </Text>
        {notes && <Text size="sm" className="whitespace-pre-wrap">{notes}</Text>}
        {status === 'downloading' && (
          <Stack gap={6}>
            <Progress value={progress} animated />
            <Text size="xs" c="chatbox-tertiary" ta="right">正在下载 {progress}%</Text>
          </Stack>
        )}
        {status === 'error' && <Text size="sm" c="chatbox-error">{error || '更新失败，请重试'}</Text>}
        {status === 'available' && (
          <Button leftSection={<ScalableIcon icon={IconDownload} size={17} />} onClick={() => void downloadAndroidUpdate()}>
            下载安全更新
          </Button>
        )}
        {status === 'downloaded' && (
          <Button leftSection={<ScalableIcon icon={IconRefresh} size={17} />} onClick={installUpdate}>
            打开系统安装器
          </Button>
        )}
        {status === 'error' && <Button onClick={() => void checkForAndroidUpdate(true)}>重新检查</Button>}
      </Stack>
    </Modal>
  )
}
