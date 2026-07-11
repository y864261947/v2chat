import { Capacitor, registerPlugin } from '@capacitor/core'

interface SecureStoragePlugin {
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  remove(options: { key: string }): Promise<void>
}

const NativeSecureStorage = registerPlugin<SecureStoragePlugin>('V2ChatSecureStorage')
const WEB_PREFIX = 'v2chat-secure-fallback:'

export const secureCredentials = {
  async get(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      try {
        return (await NativeSecureStorage.get({ key })).value
      } catch (error) {
        console.error('Failed to read secure credential', error)
        return null
      }
    }
    return window.localStorage.getItem(`${WEB_PREFIX}${key}`)
  },

  async set(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeSecureStorage.set({ key, value })
      return
    }
    window.localStorage.setItem(`${WEB_PREFIX}${key}`, value)
  },

  async remove(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await NativeSecureStorage.remove({ key })
      return
    }
    window.localStorage.removeItem(`${WEB_PREFIX}${key}`)
  },
}
