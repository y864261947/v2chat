import { ActionIcon, Box, Flex, Stack, Text } from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconChevronLeft,
  IconChevronRight,
  IconInfoCircle,
  IconKeyboard,
  IconMessages,
  IconPlugConnected,
  IconUserCircle,
} from '@tabler/icons-react'
import { createFileRoute, Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Page from '@/components/layout/Page'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'

type SettingsNavPath =
  | '/settings/account'
  | '/settings/v2api'
  | '/settings/chat'
  | '/settings/hotkeys'
  | '/settings/general'

type SettingsNavItem = {
  key: string
  path: SettingsNavPath
  label: string
  icon: ReactNode
}

const ITEMS: SettingsNavItem[] = [
  {
    key: 'account',
    path: '/settings/account',
    label: '账号与积分',
    icon: <IconUserCircle className="w-full h-full" />,
  },
  {
    key: 'v2api',
    path: '/settings/v2api',
    label: 'V2API',
    icon: <IconPlugConnected className="w-full h-full" />,
  },
  {
    key: 'chat',
    path: '/settings/chat',
    label: '全局对话默认值',
    icon: <IconMessages className="w-full h-full" />,
  },
  ...(platform.type === 'mobile'
    ? []
    : [
        {
          key: 'hotkeys',
          path: '/settings/hotkeys' as const,
          label: 'Keyboard Shortcuts',
          icon: <IconKeyboard className="w-full h-full" />,
        },
      ]),
  {
    key: 'general',
    path: '/settings/general',
    label: 'General Settings',
    icon: <IconAdjustmentsHorizontal className="w-full h-full" />,
  },
]

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const isSmallScreen = useIsSmallScreen()

  return (
    <Page
      title={t('Settings')}
      className="v2chat-settings-page"
      left={
        isSmallScreen && canGoBack ? (
          <ActionIcon
            className="controls"
            variant="subtle"
            size={28}
            color="chatbox-secondary"
            mr="sm"
            onClick={() => router.history.back()}
          >
            <IconChevronLeft />
          </ActionIcon>
        ) : undefined
      }
    >
      <SettingsRoot />
      <Toaster
        richColors
        position="bottom-center"
        style={{ zIndex: 2147483647 }}
        toastOptions={{ style: { zIndex: 2147483647 } }}
      />
    </Page>
  )
}

export function SettingsRoot() {
  const { t } = useTranslation()
  const routerState = useRouterState()
  const key = routerState.location.pathname.split('/')[2]
  const isSmallScreen = useIsSmallScreen()

  return (
    <Flex className="v2chat-settings-root" flex={1} h="100%" miw={isSmallScreen ? undefined : 800}>
      {(!isSmallScreen || routerState.location.pathname === '/settings') && (
        <Stack
          p={isSmallScreen ? 0 : 'xs'}
          gap={isSmallScreen ? 0 : 'xs'}
          maw={isSmallScreen ? undefined : 256}
          className={clsx(
            'v2chat-settings-nav border-solid border-0 border-r overflow-auto border-chatbox-border-primary',
            isSmallScreen ? 'w-full border-r-0' : 'flex-[1_0_auto]'
          )}
        >
          {ITEMS.map((item) => (
            <Link
              disabled={
                routerState.location.pathname === item.path || routerState.location.pathname.startsWith(`${item.path}/`)
              }
              key={item.key}
              to={item.path}
              className={'v2chat-settings-nav__link block no-underline w-full'}
            >
              <Flex
                component="span"
                className={clsx(
                  'v2chat-settings-nav__item cursor-pointer select-none rounded-md',
                  item.key === key ? 'is-active' : '',
                  item.key === key ? '' : 'hover:!bg-chatbox-background-gray-secondary'
                )}
                gap="xs"
                p="md"
                pr="xl"
                py={isSmallScreen ? 'sm' : undefined}
                align="center"
                c={item.key === key ? 'chatbox-brand' : 'chatbox-secondary'}
                bg={item.key === key ? 'var(--chatbox-background-brand-secondary)' : 'transparent'}
              >
                <Box className="v2chat-settings-nav__icon" component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  {item.icon}
                </Box>
                <Text
                  className={`v2chat-settings-nav__label !text-inherit ${isSmallScreen ? 'min-h-[32px] leading-[32px]' : ''}`}
                  flex={1}
                  lineClamp={1}
                  span={true}
                >
                  {t(item.label)}
                </Text>
                {isSmallScreen && (
                  <ScalableIcon
                    icon={IconChevronRight}
                    size={20}
                    className="v2chat-settings-nav__chevron !text-chatbox-tint-tertiary"
                  />
                )}
              </Flex>

              {isSmallScreen && <Divider />}
            </Link>
          ))}

          {isSmallScreen && (
            <Link to={`/about`} className={'v2chat-settings-nav__link block no-underline w-full'}>
              <Flex
                component="span"
                className={clsx('v2chat-settings-nav__item cursor-pointer select-none rounded-md')}
                gap="xs"
                p="md"
                pr="xl"
                py="sm"
                align="center"
                c={'chatbox-secondary'}
              >
                <Box className="v2chat-settings-nav__icon" component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  <ScalableIcon icon={IconInfoCircle} size={20} />
                </Box>
                <Text
                  className={`v2chat-settings-nav__label !text-inherit ${isSmallScreen ? 'min-h-[32px] leading-[32px]' : ''}`}
                  flex={1}
                  lineClamp={1}
                  span={true}
                >
                  {t('About')}
                </Text>
                <ScalableIcon
                  icon={IconChevronRight}
                  size={20}
                  className="v2chat-settings-nav__chevron !text-chatbox-tint-tertiary"
                />
              </Flex>

              {isSmallScreen && <Divider />}
            </Link>
          )}
        </Stack>
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings') && (
        <Box flex="1 1 80%" className="overflow-auto">
          <Outlet />
        </Box>
      )}
    </Flex>
  )
}
