import { ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
import {
  V2API_BASE_URL,
  V2API_PROVIDER_IDS,
  getV2ChatServiceBaseUrl,
  isRetiredV2ChatTestKey,
} from '@shared/v2api'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import platform from '@/platform'
import { secureCredentials } from '@/platform/secureCredentials'
import { settingsStore } from './settingsStore'

const TOKEN_KEY = 'account-tokens-v1'
const BYOK_KEY = 'v2api-byok-key-v1'

export interface V2ChatUser {
  id: string
  email?: string
  kind: 'guest' | 'member'
  status: string
  email_verified_at?: string
  created_at: string
}

export interface V2ChatWallet {
  user_id: string
  balance: number
  updated_at: string
}

export interface V2ChatDevice {
  id: string
  user_id: string
  name: string
  platform: string
  app_version: string
  last_seen_at: string
  revoked_at?: string
  created_at: string
}

interface AuthTokens {
  access_token: string
  refresh_token: string
  expires_at: string
}

interface AuthPayload {
  user: V2ChatUser
  wallet: V2ChatWallet
  device: V2ChatDevice
  tokens: AuthTokens
}

export interface PointProduct {
  id: string
  name: string
  price_fen: number
  points: number
  bonus_points: number
  enabled: boolean
}

export interface PaymentOrder {
  id: string
  trade_no: string
  amount_fen: number
  points: number
  channel: string
  status: 'pending' | 'paid' | 'closed' | 'refunded'
  pay_url?: string
  created_at: string
}

export interface PointLedgerEntry {
  id: string
  kind: string
  delta: number
  balance_after: number
  description: string
  created_at: string
}

interface AccountState {
  status: 'idle' | 'initializing' | 'ready' | 'error'
  user: V2ChatUser | null
  wallet: V2ChatWallet | null
  device: V2ChatDevice | null
  currentDeviceId: string | null
  devices: V2ChatDevice[]
  error: string | null
  initialized: boolean
}

const initialState: AccountState = {
  status: 'idle',
  user: null,
  wallet: null,
  device: null,
  currentDeviceId: null,
  devices: [],
  error: null,
  initialized: false,
}

export const v2chatAccountStore = createStore<AccountState>(() => initialState)

export function useV2ChatAccount<U>(selector: (state: AccountState) => U) {
  return useStore(v2chatAccountStore, selector)
}

let tokens: AuthTokens | null = null
let initializePromise: Promise<void> | null = null
let walletRefreshTimer: ReturnType<typeof setTimeout> | null = null

export function getV2ChatAPIBaseURL() {
  return getV2ChatServiceBaseUrl({ allowLocalPreview: platform.type === 'web' })
}

export function isV2ChatBusinessURL(value: string) {
  return value.startsWith(`${getV2ChatAPIBaseURL()}/`) || value === getV2ChatAPIBaseURL()
}

async function deviceMetadata() {
  const [config, name, appVersion, platformName] = await Promise.all([
    platform.getConfig(),
    platform.getDeviceName(),
    platform.getVersion(),
    platform.getPlatform(),
  ])
  return {
    install_id: config.uuid,
    device_name: name,
    platform: platformName || platform.type,
    app_version: appVersion || 'unknown',
  }
}

export async function initializeV2ChatAccount(force = false): Promise<void> {
  if (initializePromise && !force) return initializePromise
  initializePromise = (async () => {
    v2chatAccountStore.setState({ status: 'initializing', error: null })
    await hydrateV2ChatCredentials()
    try {
      const stored = await secureCredentials.get(TOKEN_KEY)
      if (stored) {
        try {
          tokens = JSON.parse(stored) as AuthTokens
        } catch {
          await secureCredentials.remove(TOKEN_KEY)
        }
      }

      if (tokens) {
        const me = await requestWithRefresh('/me')
        if (me.ok) {
          const payload = (await me.json()) as { user: V2ChatUser; wallet: V2ChatWallet }
          v2chatAccountStore.setState({
            status: 'ready', initialized: true, user: payload.user, wallet: payload.wallet,
            currentDeviceId: readAccessDeviceId(tokens.access_token), error: null,
          })
          return
        }
      }

      const response = await rawRequest('/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await deviceMetadata()),
      })
      if (!response.ok) throw await responseError(response)
      await applyAuthPayload((await response.json()) as AuthPayload)
    } catch (error) {
      v2chatAccountStore.setState({
        status: 'error', initialized: true,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })().finally(() => {
    initializePromise = null
  })
  return initializePromise
}

async function applyAuthPayload(payload: AuthPayload) {
  tokens = payload.tokens
  await secureCredentials.set(TOKEN_KEY, JSON.stringify(tokens))
  v2chatAccountStore.setState({
    status: 'ready', initialized: true, user: payload.user, wallet: payload.wallet,
    device: payload.device, currentDeviceId: payload.device.id, error: null,
  })
}

async function refreshAccessToken() {
  if (!tokens?.refresh_token) return false
  const response = await rawRequest('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  })
  if (!response.ok) {
    tokens = null
    await secureCredentials.remove(TOKEN_KEY)
    return false
  }
  await applyAuthPayload((await response.json()) as AuthPayload)
  return true
}

async function requestWithRefresh(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (tokens?.access_token) headers.set('Authorization', `Bearer ${tokens.access_token}`)
  let response = await rawRequest(path, { ...init, headers })
  if (response.status === 401 && (await refreshAccessToken())) {
    headers.set('Authorization', `Bearer ${tokens?.access_token || ''}`)
    response = await rawRequest(path, { ...init, headers })
  }
  return response
}

export async function v2chatAuthenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (!v2chatAccountStore.getState().initialized) await initializeV2ChatAccount()
  if (!tokens?.access_token) throw new Error('V2Chat account service is unavailable')

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${tokens.access_token}`)
  const method = (init.method || 'GET').toUpperCase()
  if (method === 'POST' && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', uuidv4())
  }

  let response = await fetch(input, { ...init, headers })
  if (response.status === 401 && (await refreshAccessToken())) {
    headers.set('Authorization', `Bearer ${tokens?.access_token || ''}`)
    response = await fetch(input, { ...init, headers })
  }
  if (isV2ChatBusinessURL(input.toString()) && method === 'POST') scheduleWalletRefresh()
  return response
}

export async function sendV2ChatEmailCode(email: string) {
  const response = await rawRequest('/auth/email/code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<{ sent: boolean; expires_in: number; development_code?: string }>
}

export async function verifyV2ChatEmail(email: string, code: string) {
  if (!v2chatAccountStore.getState().initialized) await initializeV2ChatAccount()
  const response = await requestWithRefresh('/auth/email/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, ...(await deviceMetadata()) }),
  })
  if (!response.ok) throw await responseError(response)
  await applyAuthPayload((await response.json()) as AuthPayload)
}

export async function refreshV2ChatAccount() {
  const response = await requestWithRefresh('/me')
  if (!response.ok) throw await responseError(response)
  const payload = (await response.json()) as { user: V2ChatUser; wallet: V2ChatWallet }
  v2chatAccountStore.setState({ user: payload.user, wallet: payload.wallet, status: 'ready', error: null })
}

export async function loadV2ChatDevices() {
  const response = await requestWithRefresh('/devices')
  if (!response.ok) throw await responseError(response)
  const payload = (await response.json()) as { data: V2ChatDevice[]; current_device_id: string }
  v2chatAccountStore.setState({ devices: payload.data, currentDeviceId: payload.current_device_id })
  return payload.data
}

export async function revokeV2ChatDevice(id: string) {
  const response = await requestWithRefresh(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw await responseError(response)
  await loadV2ChatDevices()
}

export async function loadPointProducts() {
  const response = await requestWithRefresh('/products')
  if (!response.ok) throw await responseError(response)
  return ((await response.json()) as { data: PointProduct[] }).data
}

export async function createPointOrder(productId: string, channel: 'alipay' | 'wxpay') {
  const response = await requestWithRefresh('/payments/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: productId, channel }),
  })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<PaymentOrder>
}

export async function getPointOrder(id: string) {
  const response = await requestWithRefresh(`/payments/orders/${encodeURIComponent(id)}`)
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<PaymentOrder>
}

export async function redeemPoints(code: string) {
  const response = await requestWithRefresh('/redemptions/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  })
  if (!response.ok) throw await responseError(response)
  const payload = (await response.json()) as { balance: number }
  v2chatAccountStore.setState((state) => ({ wallet: state.wallet ? { ...state.wallet, balance: payload.balance } : null }))
  return payload
}

export async function loadPointLedger(limit = 30) {
  const response = await requestWithRefresh(`/wallet/ledger?limit=${Math.max(1, Math.min(limit, 100))}`)
  if (!response.ok) throw await responseError(response)
  return ((await response.json()) as { data: PointLedgerEntry[] }).data
}

export async function logoutV2ChatAccount() {
  if (tokens?.access_token) await requestWithRefresh('/auth/logout', { method: 'POST' }).catch(() => null)
  tokens = null
  await secureCredentials.remove(TOKEN_KEY)
  v2chatAccountStore.setState(initialState)
  await initializeV2ChatAccount(true)
}

export async function logoutAllV2ChatDevices() {
  const response = await requestWithRefresh('/devices', { method: 'DELETE' })
  if (!response.ok) throw await responseError(response)
  await resetToGuest()
}

export async function deleteV2ChatAccount() {
  const response = await requestWithRefresh('/me', { method: 'DELETE' })
  if (!response.ok) throw await responseError(response)
  await resetToGuest()
}

async function resetToGuest() {
  tokens = null
  await secureCredentials.remove(TOKEN_KEY)
  v2chatAccountStore.setState(initialState)
  await initializeV2ChatAccount(true)
}

export async function getV2ChatBYOKKey() {
  return (await secureCredentials.get(BYOK_KEY)) || ''
}

export async function setV2ChatBYOKKey(value: string) {
  const key = value.trim()
  if (!key) await secureCredentials.remove(BYOK_KEY)
  else await secureCredentials.set(BYOK_KEY, key)
  applyConnectionMode(key)
}

export async function hydrateV2ChatCredentials() {
  const settings = settingsStore.getState()
  const storedCandidates = V2API_PROVIDER_IDS.map((id) => settings.providers?.[id]?.apiKey).filter(Boolean) as string[]
  let byokKey = await secureCredentials.get(BYOK_KEY)
  if (!byokKey) {
    for (const candidate of storedCandidates) {
      if (!(await isRetiredV2ChatTestKey(candidate))) {
        byokKey = candidate
        await secureCredentials.set(BYOK_KEY, candidate)
        break
      }
    }
  }
  applyConnectionMode(byokKey || '')
}

function applyConnectionMode(byokKey: string) {
  settingsStore.getState().setSettings((draft) => {
    const accountMode = draft.v2api?.mode !== 'byok'
    const apiHost = accountMode ? getV2ChatAPIBaseURL() : V2API_BASE_URL
    const mediaHost = getV2ChatAPIBaseURL()
    const runtimeKey = accountMode ? 'v2chat-account' : byokKey
    draft.providers = { ...(draft.providers || {}) }
    for (const providerId of V2API_PROVIDER_IDS) {
      draft.providers[providerId] = { ...(draft.providers[providerId] || {}), apiHost, apiKey: runtimeKey }
    }
    draft.v2api = {
      ...draft.v2api,
      mode: accountMode ? 'account' : 'byok',
      ttsBaseUrl: mediaHost,
      ttsApiKey: 'v2chat-account',
      transcriptionBaseUrl: mediaHost,
      transcriptionApiKey: 'v2chat-account',
      imageBaseUrl: accountMode ? getV2ChatAPIBaseURL() : V2API_BASE_URL,
      imageApiKey: runtimeKey,
    }
  })
}

export function updateV2ChatModels(models: ProviderModelInfo[]) {
  settingsStore.getState().setSettings((draft) => {
    for (const providerId of V2API_PROVIDER_IDS) {
      draft.providers![providerId] = { ...(draft.providers?.[providerId] || {}), models }
    }
    const current = draft.defaultChatModel?.model
    const next = models.find((model) => model.modelId === current)?.modelId || models[0]?.modelId
    if (next) {
      draft.defaultChatModel = { provider: ModelProviderEnum.V2APIOpenAI, model: next }
      const vision = models.find((model) => model.capabilities?.includes('vision'))?.modelId || next
      draft.ocrModel = { provider: ModelProviderEnum.V2APIOpenAI, model: vision }
      draft.v2api = { ...draft.v2api, defaultVisionModel: vision }
    }
  })
}

function scheduleWalletRefresh() {
  if (walletRefreshTimer) clearTimeout(walletRefreshTimer)
  walletRefreshTimer = setTimeout(() => void refreshV2ChatAccount().catch(() => null), 800)
}

function rawRequest(path: string, init?: RequestInit) {
  return fetch(`${getV2ChatAPIBaseURL()}${path}`, init)
}

async function responseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  const error = new Error(payload?.error?.message || `V2Chat API returned HTTP ${response.status}`)
  error.name = payload?.error?.code || 'V2CHAT_API_ERROR'
  return error
}

function readAccessDeviceId(accessToken: string) {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { did?: string }
    return payload.did || null
  } catch {
    return null
  }
}
