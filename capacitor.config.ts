import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // 占位包名，首个对外 APK 前必须定死正式包名（docs/plans/android-companion-2dev.md D3/D17）
  appId: 'com.danjoy.companion.dev',
  appName: 'V2Chat',
  webDir: 'release/app/dist/renderer',
  plugins: {
    SplashScreen: {
      // src/renderer/index.tsx 在初始化完成后手动调用 SplashScreen.hide()
      launchAutoHide: false,
    },
  },
}

export default config
