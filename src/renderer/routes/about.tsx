import {
  Button,
  Container,
  Flex,
  Image,
  Progress,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Page from '@/components/layout/Page'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import platform from '@/platform'
import iconPNG from '@/static/icon.png'
import { installUpdate, useUpdateStore } from '@/stores/updateStore'

export const Route = createFileRoute('/about')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const version = useVersion()
  const isSmallScreen = useIsSmallScreen()

  return (
    <Page title={t('About')}>
      <Container size="md" p={0}>
        <Stack gap="xxl" px={isSmallScreen ? 'sm' : 'md'} py={isSmallScreen ? 'xl' : 'md'}>
          <Flex gap="xxl" p="md" className="rounded-lg bg-chatbox-background-secondary">
            <Image h={100} w={100} mah={'20vw'} maw={'20vw'} src={iconPNG} />
            <Stack flex={1} gap="xxs">
              <Flex justify="space-between" align="center" wrap="wrap" gap={isSmallScreen ? 'xs' : 'sm'} rowGap="xs">
                <Title order={5} lh={1.5} lineClamp={1} title={`V2Chat v${version.version}`}>
                  V2Chat {/\d/.test(version.version) ? `(v${version.version})` : ''}
                </Title>

                <UpdateSection needCheckUpdate={version.needCheckUpdate} />
              </Flex>
              <Text>{t('about-slogan')}</Text>
              <Text c="chatbox-tertiary">{t('about-introduction')}</Text>
            </Stack>
          </Flex>
        </Stack>
      </Container>
    </Page>
  )
}

/**
 * Update section in the About page hero.
 * Desktop: check button, progress bar, error/retry, restart & install.
 * Mobile: local status only; official update links are disabled in M1.
 */
function UpdateSection({ needCheckUpdate }: { needCheckUpdate: boolean }) {
  const isDesktop = platform.type === 'desktop'

  if (isDesktop) {
    return <DesktopUpdateSection />
  }

  return <MobileUpdateHint needCheckUpdate={needCheckUpdate} />
}

function MobileUpdateHint({ needCheckUpdate }: { needCheckUpdate: boolean }) {
  const { t } = useTranslation()

  if (needCheckUpdate) {
    return <Text size="xs" c="chatbox-brand" className="flex-shrink-0">{t('New version available')}</Text>
  }

  return (
    <Text size="xs" c="chatbox-tertiary" className="flex-shrink-0">
      {t('Already up to date')}
    </Text>
  )
}

function DesktopUpdateSection() {
  const { t } = useTranslation()
  const status = useUpdateStore((s) => s.status)
  const progress = useUpdateStore((s) => s.progress)
  const updateVersion = useUpdateStore((s) => s.version)

  const handleCheck = async () => {
    useUpdateStore.setState({ status: 'checking', error: null })
    try {
      const result = await platform.checkForUpdate?.()
      // If check was skipped (another check already in progress), reset UI
      if (result && !result.started) {
        const { status: currentStatus } = useUpdateStore.getState()
        if (currentStatus === 'checking') {
          useUpdateStore.setState({ status: 'idle' })
        }
      }
    } catch {
      useUpdateStore.setState({ status: 'idle' })
    }
    // Safety timeout: if still stuck at 'checking' after 30s, reset
    setTimeout(() => {
      if (useUpdateStore.getState().status === 'checking') {
        useUpdateStore.setState({ status: 'idle' })
      }
    }, 30_000)
  }

  const handleInstall = installUpdate

  switch (status) {
    case 'checking':
      return (
        <Button size="xs" variant="default" radius="xl" className="flex-shrink-0" loading>
          {t('Checking...')}
        </Button>
      )

    case 'available':
    case 'downloading':
      return (
        <Stack gap={4} flex={1} maw={200}>
          <Text size="xs" c="chatbox-brand" ta="right">
            {status === 'downloading'
              ? `${t('Downloading...')} ${progress}%`
              : `${t('New version available')}${updateVersion ? ` v${updateVersion}` : ''}`}
          </Text>
          {status === 'downloading' && <Progress value={progress} size="xs" color="chatbox-brand" animated />}
        </Stack>
      )

    case 'downloaded':
      return (
        <Button
          size="xs"
          variant="filled"
          color="chatbox-brand"
          radius="xl"
          className="flex-shrink-0"
          leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
          onClick={handleInstall}
        >
          {t('Restart & Update')}
          {updateVersion ? ` (v${updateVersion})` : ''}
        </Button>
      )

    case 'error':
      return (
        <Stack gap={2} align="flex-end" className="flex-shrink-0">
          <Flex gap="xs" align="center">
            <Text size="xs" c="chatbox-error">
              {t('Update failed')}
            </Text>
            <Button size="xs" variant="default" radius="xl" onClick={handleCheck}>
              {t('Retry')}
            </Button>
          </Flex>
        </Stack>
      )

    case 'up-to-date':
      return (
        <Text size="xs" c="chatbox-tertiary" className="flex-shrink-0">
          {t('Already up to date')}
        </Text>
      )

    default:
      return (
        <Button size="xs" variant="default" radius="xl" className="flex-shrink-0" onClick={handleCheck}>
          {t('Check Update')}
        </Button>
      )
  }
}
