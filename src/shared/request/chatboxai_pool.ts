const LOCAL_API_ORIGIN = 'http://localhost:8002'

let API_ORIGIN = LOCAL_API_ORIGIN

let POOL = [API_ORIGIN]

export function isChatboxAPI(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : ((input as Request).url ?? input.toString())
  return POOL.some((o) => url.startsWith(o)) || url.startsWith(API_ORIGIN)
}

export function getChatboxAPIOrigin() {
  return API_ORIGIN
}

/**
 * 按顺序测试 API 的可用性，只要有一个 API 域名可用，就终止测试并切换所有流量到该域名。
 * 在测试过程中，会根据服务器返回添加新的 API 域名，并缓存到本地
 */
export async function testApiOrigins() {
  return POOL
}
