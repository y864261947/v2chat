import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Image, List, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import icon from '../static/icon.png'
import { navigateToSettings } from './Settings'

const Welcome = NiceModal.create(() => {
  const { t } = useTranslation()
  const modal = useModal()

  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  return (
    <AdaptiveModal
      opened={modal.visible}
      onClose={onClose}
      withCloseButton={false}
      centered={true}
      radius="lg"
      classNames={{
        body: 'pt-xxl px-xl pb-md',
      }}
    >
      <Stack gap="xl">
        <Stack gap="md" align="center">
          <Stack gap="sm" align="center">
            <Image src={icon} w={86} h={86} />
            <Stack gap="3xs" align="center">
              <Title order={3}>V2Chat</Title>
              <Text size="md">为角色对话准备的 V2API 客户端</Text>
            </Stack>
          </Stack>

          <List size="sm" c="chatbox-secondary" className="flex flex-col items-center">
            <List.Item>填写一个 V2API Key，获取可用模型</List.Item>
            <List.Item>选择角色后直接进入酒馆式聊天</List.Item>
            <List.Item>文字、图片和语音条会跟随对话场景</List.Item>
          </List>
        </Stack>

        <Paper shadow="none" radius="md" withBorder p="lg">
          <Stack gap="sm">
            <Text className="text-center">先完成 V2API 配置，再开始你的第一段角色对话。</Text>
            <Button
              size="lg"
              h={54}
              radius="md"
              classNames={{ root: '!outline-none', label: 'flex flex-col items-center justify-center' }}
              onClick={() => {
                navigateToSettings('/v2api')
                modal.resolve('setup')
                modal.hide()
              }}
            >
              配置 V2API
            </Button>
          </Stack>
        </Paper>

        <Button variant="transparent" c="chatbox-secondary" size="compact-md" onClick={onClose}>
          稍后再说
        </Button>
      </Stack>
    </AdaptiveModal>
  )
})

export default Welcome
