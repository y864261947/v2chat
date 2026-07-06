import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'

/**
 * 零遥测（决策 D14）：Sentry 适配器 no-op 化。
 * 保留类名与接口，调用面不动；错误排查依赖本地日志 + 用户反馈。
 */
export class MainSentryAdapter implements SentryAdapter {
  captureException(_error: unknown): void {}

  withScope(callback: (scope: SentryScope) => void): void {
    const scope: SentryScope = {
      setTag(_key: string, _value: string): void {},
      setExtra(_key: string, _value: unknown): void {},
    }
    callback(scope)
  }
}

export const sentry = new MainSentryAdapter()
