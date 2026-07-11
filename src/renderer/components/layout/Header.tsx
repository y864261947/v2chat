import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Avatar, Badge, Box, Flex, Text, Tooltip } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconLayoutSidebarLeftExpand, IconMenu2, IconPencil } from '@tabler/icons-react'
import clsx from 'clsx'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageInStorage } from '@/components/Image'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { scheduleGenerateNameAndThreadName, scheduleGenerateThreadName } from '@/stores/sessionActions'
import * as settingActions from '@/stores/settingActions'
import { useUIStore } from '@/stores/uiStore'
import Divider from '../common/Divider'
import { ScalableIcon } from '../common/ScalableIcon'
import Toolbar from './Toolbar'
import WindowControls from './WindowControls'

export default function Header(props: {
  session: Session
  model?: {
    provider: string
    modelId: string
  }
  onSelectModel?: (provider: string, model: string) => void
}) {
  const { t } = useTranslation()
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)

  const isSmallScreen = useIsSmallScreen()
  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()

  const { session: currentSession } = props

  useEffect(() => {
    const autoGenerateTitle = settingActions.getAutoGenerateTitle()
    if (!autoGenerateTitle) {
      return
    }

    const hasGeneratingMessage = currentSession.messages.some((msg) => msg.generating)

    if (hasGeneratingMessage || currentSession.messages.length < 2) {
      return
    }

    if (currentSession.name === 'Untitled') {
      scheduleGenerateNameAndThreadName(currentSession.id)
    } else if (!currentSession.threadName) {
      scheduleGenerateThreadName(currentSession.id)
    }
  }, [currentSession])

  const editCurrentSession = () => {
    if (!currentSession) {
      return
    }
    void NiceModal.show('session-settings', { session: currentSession })
  }

  const handleNavigationButtonClick = () => {
    if (isSmallScreen) {
      setShowSidebar(true)
      return
    }
    setShowSidebar(!showSidebar)
  }

  return (
    <>
      <Flex
        h={48}
        align="center"
        px="md"
        className={clsx(
          'flex-none title-bar',
          isSmallScreen ? 'bg-chatbox-background-primary v2chat-mobile-im-header' : ''
        )}
      >
        {(!showSidebar || isSmallScreen) && (
          <Flex align="center" className={needRoomForMacWindowControls ? 'pl-20' : ''}>
            <ActionIcon
              className="controls"
              variant="subtle"
              size={isSmallScreen ? 24 : 20}
              color={isSmallScreen ? 'chatbox-secondary' : 'chatbox-tertiary'}
              mr="xs"
              onClick={handleNavigationButtonClick}
              aria-label={isSmallScreen ? '打开侧边栏' : showSidebar ? '收起侧边栏' : '打开侧边栏'}
            >
              {isSmallScreen ? <IconMenu2 /> : <IconLayoutSidebarLeftExpand />}
            </ActionIcon>
          </Flex>
        )}

        <Flex align="center" flex={1} className="min-w-0" {...(isSmallScreen ? { pr: 8 } : {})}>
          {isSmallScreen ? (
            <Flex align="center" gap={9} className="v2chat-mobile-peer min-w-0">
              <Box className="v2chat-mobile-peer__avatar-wrap">
                <Avatar size={42} radius="xl" src={currentSession.picUrl} className="v2chat-mobile-peer__avatar">
                  {currentSession.assistantAvatarKey ? (
                    <ImageInStorage
                      storageKey={currentSession.assistantAvatarKey}
                      className="v2chat-mobile-peer__image"
                    />
                  ) : (
                    currentSession.name.slice(0, 1) || 'V'
                  )}
                </Avatar>
                <span className="v2chat-mobile-peer__online" />
              </Box>
              <Box className="min-w-0">
                <Flex align="center" gap={6} className="min-w-0">
                  <Text fw={800} size="19px" lineClamp={1} className="v2chat-mobile-peer__name">
                    {currentSession?.name}
                  </Text>
                </Flex>
                <Text size="sm" className="v2chat-mobile-peer__status">
                  在线
                </Text>
              </Box>
            </Flex>
          ) : (
            <>
              <Text fw={600} size="18px" lineClamp={1}>
                {currentSession?.name}
              </Text>
              {currentSession?.threadName && currentSession.threadName !== currentSession.name && (
                <Badge
                  size="xs"
                  variant="light"
                  color="gray"
                  ml={6}
                  maw={180}
                  className="flex-shrink-0"
                  classNames={{ label: 'truncate' }}
                >
                  {currentSession.threadName}
                </Badge>
              )}
              <Tooltip label={t('Customize settings for the current conversation')}>
                <ActionIcon
                  className="controls"
                  variant="subtle"
                  color="chatbox-tertiary"
                  size={16}
                  ml={4}
                  onClick={editCurrentSession}
                >
                  <ScalableIcon icon={IconPencil} size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Flex>

        <Toolbar sessionId={currentSession.id} />

        <WindowControls className="-mr-3 ml-2" />
      </Flex>

      <Divider />
    </>
  )
}
