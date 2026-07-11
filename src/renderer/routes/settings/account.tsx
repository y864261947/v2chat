import { ActionIcon, Badge, Button, Divider, Flex, Group, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconCreditCard, IconDeviceMobile, IconHistory, IconLogout, IconLogout2, IconRefresh, IconTicket, IconTrash, IconUserX, IconWallet } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import BackupPanel from '@/components/account/BackupPanel'
import platform from '@/platform'
import { add as addToast } from '@/stores/toastActions'
import {
  type PaymentOrder,
  type PointProduct,
  type PointLedgerEntry,
  createPointOrder,
  deleteV2ChatAccount,
  getPointOrder,
  initializeV2ChatAccount,
  loadPointProducts,
  loadPointLedger,
  loadV2ChatDevices,
  logoutV2ChatAccount,
  logoutAllV2ChatDevices,
  redeemPoints,
  refreshV2ChatAccount,
  revokeV2ChatDevice,
  sendV2ChatEmailCode,
  useV2ChatAccount,
  verifyV2ChatEmail,
} from '@/stores/v2chatAccountStore'

export const Route = createFileRoute('/settings/account')({ component: RouteComponent })

export function RouteComponent() {
  const status = useV2ChatAccount((state) => state.status)
  const user = useV2ChatAccount((state) => state.user)
  const wallet = useV2ChatAccount((state) => state.wallet)
  const devices = useV2ChatAccount((state) => state.devices)
  const currentDeviceId = useV2ChatAccount((state) => state.currentDeviceId)
  const error = useV2ChatAccount((state) => state.error)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [binding, setBinding] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [products, setProducts] = useState<PointProduct[]>([])
  const [buyingProduct, setBuyingProduct] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<PaymentOrder | null>(null)
  const [ledger, setLedger] = useState<PointLedgerEntry[]>([])

  useEffect(() => {
    void initializeV2ChatAccount()
    void loadV2ChatDevices().catch(() => null)
  }, [])

  useEffect(() => {
    if (user?.kind === 'member') {
      void loadPointProducts().then(setProducts).catch(() => setProducts([]))
    }
  }, [user?.kind])

  useEffect(() => {
    if (user) void loadPointLedger(20).then(setLedger).catch(() => setLedger([]))
  }, [user?.id, wallet?.balance])

  useEffect(() => {
    if (!pendingOrder || pendingOrder.status !== 'pending') return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      void getPointOrder(pendingOrder.id)
        .then(async (order) => {
          setPendingOrder(order)
          if (order.status === 'paid') {
            window.clearInterval(timer)
            await refreshV2ChatAccount()
            addToast('充值到账')
          }
          if (Date.now() - startedAt > 120_000) window.clearInterval(timer)
        })
        .catch(() => null)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [pendingOrder?.id, pendingOrder?.status])

  const sendCode = async () => {
    setSendingCode(true)
    try {
      const result = await sendV2ChatEmailCode(email)
      setCodeSent(true)
      if (result.development_code) setCode(result.development_code)
      addToast('验证码已发送')
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSendingCode(false)
    }
  }

  const bindEmail = async () => {
    setBinding(true)
    try {
      await verifyV2ChatEmail(email, code)
      await loadV2ChatDevices()
      addToast('邮箱绑定成功')
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBinding(false)
    }
  }

  const redeem = async () => {
    setRedeeming(true)
    try {
      await redeemPoints(redeemCode)
      setRedeemCode('')
      addToast('兑换成功')
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRedeeming(false)
    }
  }

  const buy = async (product: PointProduct, channel: 'alipay' | 'wxpay') => {
    setBuyingProduct(product.id)
    try {
      const order = await createPointOrder(product.id, channel)
      setPendingOrder(order)
      if (order.pay_url) await platform.openLink(order.pay_url)
    } catch (cause) {
      addToast(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBuyingProduct(null)
    }
  }

  if (status === 'initializing' || status === 'idle') {
    return <Flex h="100%" align="center" justify="center"><Loader size="sm" /></Flex>
  }

  return (
    <Stack p="md" gap="xl" maw={760}>
      <Flex justify="space-between" align="center" gap="md" wrap="wrap">
        <Stack gap={2}>
          <Flex align="center" gap="xs">
            <Title order={5}>账号与积分</Title>
            <Badge variant="light" color={user?.kind === 'member' ? 'green' : 'gray'}>
              {user?.kind === 'member' ? '已绑定' : '游客'}
            </Badge>
          </Flex>
          <Text size="sm" c="chatbox-secondary">{user?.email || '本机游客账号'}</Text>
        </Stack>
        <ActionIcon variant="subtle" aria-label="刷新账号" onClick={() => void refreshV2ChatAccount()}>
          <ScalableIcon icon={IconRefresh} size={18} />
        </ActionIcon>
      </Flex>

      {status === 'error' && <Text c="chatbox-error">{error || '账号服务暂时不可用'}</Text>}

      <Flex
        align="center"
        justify="space-between"
        p="md"
        className="rounded-md border border-solid border-chatbox-border-primary bg-chatbox-background-secondary"
      >
        <Group gap="sm">
          <ScalableIcon icon={IconWallet} size={22} />
          <Stack gap={0}><Text size="sm" c="chatbox-secondary">可用积分</Text><Text fw={700} size="xl">{wallet?.balance ?? 0}</Text></Stack>
        </Group>
        <Text size="xs" c="chatbox-tertiary">1000 积分 = 1 元</Text>
      </Flex>

      <Stack gap="sm">
        <Flex align="center" gap="xs"><ScalableIcon icon={IconHistory} size={17} /><Title order={6}>积分流水</Title></Flex>
        {ledger.length === 0 ? <Text size="sm" c="chatbox-tertiary">暂无积分记录</Text> : ledger.slice(0, 10).map((entry) => (
          <Flex key={entry.id} align="center" justify="space-between" gap="md" py={4}>
            <Stack gap={0} className="min-w-0">
              <Text size="sm" lineClamp={1}>{ledgerLabel(entry.kind, entry.description)}</Text>
              <Text size="xs" c="chatbox-tertiary">{new Date(entry.created_at).toLocaleString()} · 余额 {entry.balance_after}</Text>
            </Stack>
            <Text fw={600} c={entry.delta >= 0 ? 'green' : 'chatbox-primary'}>{entry.delta >= 0 ? '+' : ''}{entry.delta}</Text>
          </Flex>
        ))}
      </Stack>

      {user?.kind !== 'member' ? (
        <Stack gap="md">
          <Title order={6}>绑定邮箱</Title>
          <Flex gap="sm" align="end" wrap="wrap">
            <TextInput label="邮箱" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} flex={1} miw={220} />
            <Button variant="light" loading={sendingCode} disabled={!email.trim()} onClick={() => void sendCode()}>
              {codeSent ? '重新发送' : '获取验证码'}
            </Button>
          </Flex>
          {codeSent && (
            <Flex gap="sm" align="end" wrap="wrap">
              <PasswordInput label="验证码" value={code} onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} flex={1} miw={220} />
              <Button loading={binding} disabled={code.length !== 6} onClick={() => void bindEmail()}>确认绑定</Button>
            </Flex>
          )}
          <Text size="xs" c="chatbox-tertiary">绑定后可使用图片、语音和积分充值。</Text>
        </Stack>
      ) : (
        <>
          <Stack gap="md">
            <Flex align="center" gap="xs"><ScalableIcon icon={IconCreditCard} size={18} /><Title order={6}>积分充值</Title></Flex>
            <Stack gap="xs">
              {products.map((product) => (
                <Flex key={product.id} align="center" justify="space-between" gap="md" p="sm" className="border-0 border-b border-solid border-chatbox-border-primary">
                  <Stack gap={1}><Text fw={600}>{product.name}</Text><Text size="xs" c="chatbox-secondary">{product.points + product.bonus_points} 积分</Text></Stack>
                  <Group gap="xs">
                    <Button size="compact-sm" variant="light" loading={buyingProduct === product.id} onClick={() => void buy(product, 'alipay')}>支付宝 ¥{(product.price_fen / 100).toFixed(2)}</Button>
                    <Button size="compact-sm" variant="light" loading={buyingProduct === product.id} onClick={() => void buy(product, 'wxpay')}>微信</Button>
                  </Group>
                </Flex>
              ))}
            </Stack>
            {pendingOrder && <Text size="xs" c={pendingOrder.status === 'paid' ? 'green' : 'chatbox-secondary'}>订单 {pendingOrder.trade_no}：{pendingOrder.status === 'paid' ? '已到账' : '等待支付'}</Text>}
          </Stack>

          <Divider />

          <Stack gap="md">
            <Flex align="center" gap="xs"><ScalableIcon icon={IconTicket} size={18} /><Title order={6}>兑换码</Title></Flex>
            <Flex gap="sm"><TextInput value={redeemCode} onChange={(event) => setRedeemCode(event.currentTarget.value)} placeholder="V2C-..." flex={1} /><Button loading={redeeming} disabled={!redeemCode.trim()} onClick={() => void redeem()}>兑换</Button></Flex>
          </Stack>
        </>
      )}

      <Divider />

      <BackupPanel />

      <Divider />

      <Stack gap="md">
        <Flex align="center" justify="space-between" gap="md">
          <Flex align="center" gap="xs"><ScalableIcon icon={IconDeviceMobile} size={18} /><Title order={6}>登录设备</Title></Flex>
          {user?.kind === 'member' && (
            <Button
              size="compact-sm"
              variant="subtle"
              color="red"
              leftSection={<ScalableIcon icon={IconLogout2} size={15} />}
              onClick={() => {
                if (window.confirm('退出此账号的全部设备？所有设备都需要重新验证邮箱。')) {
                  void logoutAllV2ChatDevices().catch((cause) => addToast(cause instanceof Error ? cause.message : String(cause)))
                }
              }}
            >
              全部退出
            </Button>
          )}
        </Flex>
        {devices.map((device) => (
          <Flex key={device.id} align="center" justify="space-between" gap="md" p="xs">
            <Stack gap={0}><Text fw={500}>{device.name || device.platform}{device.id === currentDeviceId ? '（当前）' : ''}</Text><Text size="xs" c="chatbox-tertiary">V{device.app_version} · {new Date(device.last_seen_at).toLocaleString()}</Text></Stack>
            <ActionIcon color="red" variant="subtle" disabled={device.id === currentDeviceId} aria-label="移除设备" onClick={() => void revokeV2ChatDevice(device.id)}><ScalableIcon icon={IconTrash} size={17} /></ActionIcon>
          </Flex>
        ))}
      </Stack>

      <Divider />

      <Group gap="xs">
        <Button variant="subtle" color="red" leftSection={<ScalableIcon icon={IconLogout} size={17} />} onClick={() => void logoutV2ChatAccount()}>
          退出当前账号
        </Button>
        {user?.kind === 'member' && (
          <Button
            variant="subtle"
            color="red"
            leftSection={<ScalableIcon icon={IconUserX} size={17} />}
            onClick={() => {
              if (window.confirm('永久注销账号？积分不会退回，本机聊天记录仍会保留。')) {
                void deleteV2ChatAccount().catch((cause) => addToast(cause instanceof Error ? cause.message : String(cause)))
              }
            }}
          >
            注销账号
          </Button>
        )}
      </Group>
    </Stack>
  )
}

function ledgerLabel(kind: string, description: string) {
  const labels: Record<string, string> = {
    'guest-grant': '游客体验积分', reserve: 'AI 请求预扣', release: '释放预扣积分', refund: '失败退款',
    purchase: '充值到账', redemption: '兑换码到账', 'settle-extra': '实际用量补扣', 'admin-adjustment': '人工调整',
  }
  return labels[kind] || description || kind
}
