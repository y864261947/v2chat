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
              <Text size="md">V2API powered AI chat</Text>
            </Stack>
          </Stack>

          <List size="sm" c="chatbox-secondary" className="flex flex-col items-center">
            <List.Item>OpenAI / Claude / Gemini protocols via V2API</List.Item>
            <List.Item>{t('All data is stored locally, ensuring privacy and rapid access')}</List.Item>
            <List.Item>Supports text, image understanding, and voice replies</List.Item>
          </List>
        </Stack>

        <Paper shadow="none" radius="md" withBorder p="lg">
          <Stack gap="sm">
            <Text className="text-center">Configure your V2API API Key to start using V2Chat.</Text>
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
              Setup V2API
            </Button>
          </Stack>
        </Paper>

        <Button variant="transparent" c="chatbox-secondary" size="compact-md" onClick={onClose}>
          {t('Setup later')}
        </Button>
      </Stack>
    </AdaptiveModal>
  )
})

export default Welcome
