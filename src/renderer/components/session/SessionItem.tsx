import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Text } from '@mantine/core'
import type { SessionMetaRecord } from '@shared/types'
import { IconCopy, IconDots, IconEdit, IconMessagePlus, IconStar, IconStarFilled, IconTrash } from '@tabler/icons-react'
import clsx from 'clsx'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getTavernCharacterById } from '@/packages/tavernCharacters'
import { createRoleplaySession } from '@/packages/tavernSessions'
import { router } from '@/router'
import {
  deleteSession as deleteSessionStore,
  getSession,
  updateSession as updateSessionStore,
} from '@/stores/chatStore'
import { copyAndSwitchSession, switchCurrentSession } from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { AssistantAvatar } from '../common/Avatar'
import { ScalableIcon } from '../common/ScalableIcon'

export interface Props {
  session: SessionMetaRecord
  selected: boolean
  windowLabel?: string
}

function SessionItem(props: Props) {
  const { session, selected, windowLabel } = props
  const { t } = useTranslation()
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const onClick = () => {
    switchCurrentSession(session.id)
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }
  const isSmallScreen = useIsSmallScreen()
  // const smallSize = theme.typography.pxToRem(20)

  const [menuOpened, setMenuOpened] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const linkedCharacter = getTavernCharacterById(session.characterId)
  const subtitle = session.characterId
    ? [windowLabel || '角色窗口', session.currentScene?.trim()].filter(Boolean).join(' · ')
    : '普通对话'

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () => [
      {
        text: '当前窗口设置',
        icon: IconEdit,
        onClick: async () => {
          await NiceModal.show('session-settings', {
            session: await getSession(session.id),
          })
        },
      },
      ...(linkedCharacter
        ? [
            {
              text: '同角色新窗口',
              icon: IconMessagePlus,
              onClick: () => {
                void createRoleplaySession(linkedCharacter).catch((error) => {
                  toastActions.add(error instanceof Error ? error.message : '无法创建角色对话')
                })
              },
            },
          ]
        : []),
      {
        text: '复制当前窗口',
        icon: IconCopy,
        onClick: () => {
          copyAndSwitchSession(session)
        },
      },
      {
        text: session.starred ? t('Unstar') : t('Star'),
        icon: session.starred ? IconStarFilled : IconStar,
        onClick: () => {
          void updateSessionStore(session.id, { starred: !session.starred })
        },
      },
      { divider: true },
      {
        doubleCheck: true,
        text: t('Delete'),
        icon: IconTrash,
        disabled: deleting,
        onClick: async () => {
          if (deletingRef.current) {
            return
          }
          deletingRef.current = true
          setDeleting(true)
          try {
            await deleteSessionStore(session.id)
            // Only navigate if deleting the currently selected session
            if (selected) {
              router.navigate({ to: '/', replace: true })
            }
          } catch (error) {
            console.error('Failed to delete session:', error)
            deletingRef.current = false
            setDeleting(false)
          }
        },
      },
    ],
    [session, selected, t, deleting, linkedCharacter]
  )

  return (
    <Flex
      align="center"
      className={clsx(
        'v2chat-sidebar-session-item cursor-pointer rounded-sm group/session-item',
        selected && 'is-selected',
        isSmallScreen
          ? ''
          : selected
            ? 'bg-chatbox-background-brand-secondary'
            : 'hover:bg-chatbox-background-gray-secondary'
      )}
      mx="xs"
      px="xs"
      py={10}
      gap={10}
      onClick={onClick}
    >
      <AssistantAvatar
        avatarKey={session.assistantAvatarKey}
        picUrl={session.picUrl}
        sessionType={session.type}
        size="sm"
        type="chat"
        c={selected ? 'chatbox-brand' : 'chatbox-primary'}
      />

      <Flex direction="column" flex={1} gap={1} className="v2chat-sidebar-session-item__content">
        <Text
          span
          lineClamp={1}
          c={selected ? 'chatbox-brand' : 'chatbox-primary'}
          className="v2chat-sidebar-session-item__name"
        >
          {session.name}
        </Text>
        <Text span size="xs" lineClamp={1} className="v2chat-sidebar-session-item__meta">
          {subtitle}
        </Text>
      </Flex>

      <ActionMenu
        type="desktop"
        items={actionMenuItems}
        position="bottom-start"
        opened={menuOpened}
        onChange={(opened) => setMenuOpened(opened)}
      >
        <ActionIcon
          variant="transparent"
          size={20}
          color={session.starred ? 'chatbox-brand' : 'chatbox-tertiary'}
          className={isSmallScreen || session.starred || menuOpened ? '' : 'group-hover/session-item:visible invisible'}
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
          }}
        >
          {session.starred ? (
            <ScalableIcon icon={IconStarFilled} className="text-inherit" size={16} />
          ) : (
            <ScalableIcon icon={IconDots} className="text-inherit" size={16} />
          )}
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}

export default memo(SessionItem)
