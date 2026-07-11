import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core'

interface VersionInfo {
  versionCode: number
  versionName: string
}

interface InstallResult {
  launched: boolean
  permissionRequired: boolean
}

interface DownloadProgress {
  percent: number
  transferred: number
  total: number
}

interface AndroidUpdaterPlugin {
  getVersionInfo(): Promise<VersionInfo>
  verifyManifest(options: { payload: string; signature: string }): Promise<{ valid: boolean }>
  download(options: { url: string; sha256: string; sizeBytes: number }): Promise<{
    path: string
    sha256: string
    sizeBytes: number
  }>
  install(): Promise<InstallResult>
  openInstallPermission(): Promise<void>
  addListener(eventName: 'downloadProgress', listener: (event: DownloadProgress) => void): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<AndroidUpdaterPlugin>('V2ChatUpdater')

export function isAndroidUpdaterAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export const androidUpdater = {
  getVersionInfo: () => plugin.getVersionInfo(),
  verifyManifest: (payload: string, signature: string) => plugin.verifyManifest({ payload, signature }),
  download: (url: string, sha256: string, sizeBytes: number) => plugin.download({ url, sha256, sizeBytes }),
  async install() {
    const result = await plugin.install()
    if (result.permissionRequired) {
      await plugin.openInstallPermission()
      return
    }
  },
  onProgress(listener: (event: DownloadProgress) => void) {
    let handle: PluginListenerHandle | null = null
    void plugin.addListener('downloadProgress', listener).then((value) => {
      handle = value
    })
    return () => void handle?.remove()
  },
}
