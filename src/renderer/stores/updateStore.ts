import { create } from 'zustand'
import { t } from 'i18next'
import platform from '@/platform'
import { androidUpdater, isAndroidUpdaterAvailable } from '@/platform/androidUpdater'
import { getV2ChatServiceBaseUrl } from '@shared/v2api'

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'

interface UpdateState {
  status: UpdateStatus
  progress: number
  version: string | null
  error: string | null
  dismissedVersion: string | null
  mandatory: boolean
  releaseNotes: string | null
}

interface UpdateActions {
  dismiss(): void
}

export const useUpdateStore = create<UpdateState & UpdateActions>((set, get) => ({
  status: 'idle',
  progress: 0,
  version: null,
  error: null,
  dismissedVersion: null,
  mandatory: false,
  releaseNotes: null,

  dismiss() {
    set({ dismissedVersion: get().version })
  },
}))

export function installUpdate() {
  platform.installUpdate().catch(() => {
    useUpdateStore.setState({ status: 'error', error: t('Update failed') })
  })
}

let initialized = false
let androidRelease: AndroidRelease | null = null
let androidCheckPromise: Promise<{ started: boolean }> | null = null
const ANDROID_LAST_CHECK_KEY = 'v2chat-android-update-last-check'
const DAILY_CHECK_INTERVAL = 24 * 60 * 60 * 1000

interface AndroidRelease {
  version_code: number
  version_name: string
  minimum_version_code: number
  force_update: boolean
  rollout_percent: number
  apk_url: string
  sha256: string
  size_bytes: number
  release_notes: string
  manifest_signature: string
}

interface AndroidReleaseResponse {
  available: boolean
  mandatory?: boolean
  release?: AndroidRelease
  signed_payload?: string
}

export async function checkForAndroidUpdate(manual = false): Promise<{ started: boolean }> {
  if (!isAndroidUpdaterAvailable()) return { started: false }
  if (androidCheckPromise) return { started: false }

  androidCheckPromise = (async () => {
    useUpdateStore.setState({ status: 'checking', error: null })
    try {
      const [version, config] = await Promise.all([androidUpdater.getVersionInfo(), platform.getConfig()])
      const params = new URLSearchParams({
        version_code: String(version.versionCode),
        channel: 'stable',
        install_id: config.uuid,
      })
      const response = await fetch(`${getV2ChatServiceBaseUrl()}/releases/android/check?${params}`)
      if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}`)
      const result = (await response.json()) as AndroidReleaseResponse
      localStorage.setItem(ANDROID_LAST_CHECK_KEY, String(Date.now()))

      if (!result.available) {
        androidRelease = null
        useUpdateStore.setState({
          status: manual ? 'up-to-date' : 'idle', version: null, mandatory: false, releaseNotes: null,
        })
        return { started: true }
      }
      if (!result.release || !result.signed_payload) throw new Error('更新清单不完整')
      const expectedPayload = canonicalAndroidManifest(result.release)
      if (expectedPayload !== result.signed_payload) throw new Error('更新清单字段不一致')
      const verified = await androidUpdater.verifyManifest(result.signed_payload, result.release.manifest_signature)
      if (!verified.valid) throw new Error('更新清单签名无效')

      androidRelease = result.release
      useUpdateStore.setState({
        status: 'available',
        version: result.release.version_name,
        progress: 0,
        mandatory: Boolean(result.mandatory),
        releaseNotes: result.release.release_notes || null,
        error: null,
      })
      return { started: true }
    } catch (error) {
      useUpdateStore.setState({
        status: 'error', progress: 0,
        error: error instanceof Error ? error.message : String(error),
      })
      return { started: true }
    } finally {
      androidCheckPromise = null
    }
  })()
  return androidCheckPromise
}

export async function downloadAndroidUpdate() {
  if (!androidRelease || !isAndroidUpdaterAvailable()) return
  const release = androidRelease
  useUpdateStore.setState({ status: 'downloading', progress: 0, error: null })
  try {
    await androidUpdater.download(release.apk_url, release.sha256, release.size_bytes)
    useUpdateStore.setState({ status: 'downloaded', progress: 100, version: release.version_name })
  } catch (error) {
    useUpdateStore.setState({
      status: 'error', progress: 0,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function canonicalAndroidManifest(release: AndroidRelease) {
  return [
    'v2chat-android-v1',
    release.version_code,
    release.version_name,
    release.minimum_version_code,
    release.force_update,
    release.rollout_percent,
    release.apk_url,
    release.sha256.toLowerCase(),
    release.size_bytes,
    '',
  ].join('\n')
}

/**
 * Initialize update event listeners (desktop only).
 * Idempotent — safe to call multiple times (e.g., during hot reload).
 */
export function initUpdateListeners() {
  if (initialized) return
  initialized = true

  if (isAndroidUpdaterAvailable()) {
    androidUpdater.onProgress((data) => {
      useUpdateStore.setState({ status: 'downloading', progress: data.percent })
    })
    const lastCheck = Number(localStorage.getItem(ANDROID_LAST_CHECK_KEY) || 0)
    if (Date.now() - lastCheck >= DAILY_CHECK_INTERVAL) {
      setTimeout(() => void checkForAndroidUpdate(false), 2_000)
    }
    setInterval(() => void checkForAndroidUpdate(false), DAILY_CHECK_INTERVAL)
    return
  }

  if (platform.onUpdaterChecking) {
    platform.onUpdaterChecking(() => {
      useUpdateStore.setState({ status: 'checking', error: null })
    })
  }

  if (platform.onUpdaterAvailable) {
    platform.onUpdaterAvailable((data) => {
      const { dismissedVersion } = useUpdateStore.getState()
      useUpdateStore.setState({
        status: 'available',
        version: data.version,
        dismissedVersion: dismissedVersion === data.version ? dismissedVersion : null,
      })
    })
  }

  if (platform.onUpdaterNotAvailable) {
    platform.onUpdaterNotAvailable(() => {
      const { status } = useUpdateStore.getState()
      if (status === 'checking') {
        useUpdateStore.setState({ status: 'up-to-date' })
        setTimeout(() => {
          if (useUpdateStore.getState().status === 'up-to-date') {
            useUpdateStore.setState({ status: 'idle' })
          }
        }, 3_000)
      } else if (status !== 'idle') {
        useUpdateStore.setState({ status: 'idle' })
      }
    })
  }

  if (platform.onUpdaterProgress) {
    platform.onUpdaterProgress((data) => {
      const { progress, status } = useUpdateStore.getState()
      if (status === 'downloading' && progress === data.percent) return
      useUpdateStore.setState({ status: 'downloading', progress: data.percent })
    })
  }

  if (platform.onUpdaterDownloaded) {
    platform.onUpdaterDownloaded((data) => {
      const { dismissedVersion } = useUpdateStore.getState()
      useUpdateStore.setState({
        status: 'downloaded',
        version: data.version,
        progress: 100,
        dismissedVersion: dismissedVersion === data.version ? dismissedVersion : null,
      })
    })
  }

  if (platform.onUpdaterError) {
    platform.onUpdaterError((data) => {
      useUpdateStore.setState({ status: 'error', error: data.message, progress: 0 })
    })
  }
}
