import { afterEach, describe, expect, it, vi } from 'vitest'
import { V2CHAT_SERVICE_BASE_URL, getV2ChatServiceBaseUrl } from './v2api'

describe('getV2ChatServiceBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the local gateway for a web preview on localhost', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost' },
      localStorage: { getItem: () => null },
    })

    expect(getV2ChatServiceBaseUrl()).toBe('http://127.0.0.1:8080/v1')
  })

  it('uses the production gateway when localhost belongs to a native webview', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost' },
      localStorage: { getItem: () => 'http://127.0.0.1:9090/v1' },
    })

    expect(getV2ChatServiceBaseUrl({ allowLocalPreview: false })).toBe(V2CHAT_SERVICE_BASE_URL)
  })
})
