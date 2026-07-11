import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'top.v2api.v2chat',
  appName: 'V2Chat',
  webDir: 'release/app/dist/renderer',
  plugins: {
    SplashScreen: {
      // src/renderer/index.tsx 在初始化完成后手动调用 SplashScreen.hide()
      launchAutoHide: false,
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
