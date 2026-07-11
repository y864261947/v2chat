import { V2API_DEFAULT_IMAGE_BASE_URL, V2API_DEFAULT_IMAGE_MODEL } from '@shared/v2api'
import { isV2ChatBusinessURL, v2chatAuthenticatedFetch } from '@/stores/v2chatAccountStore'

function normalizeOpenAIBaseUrl(baseUrl?: string) {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!trimmed) return V2API_DEFAULT_IMAGE_BASE_URL
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function dataUrlToBlob(dataUrl: string) {
  const [header, base64 = ''] = dataUrl.split(',')
  const mimeType = header.match(/^data:(.*?);base64$/)?.[1] || 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

async function urlToDataUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download generated image: HTTP ${response.status}`)
  }
  const blob = await response.blob()
  return blobToDataUrl(blob)
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function parseImageResponse(response: Response) {
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Image generation failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>
    error?: { message?: string }
  }
  if (payload.error?.message) {
    throw new Error(payload.error.message)
  }

  const images = payload.data || []
  const dataUrls = await Promise.all(
    images.map(async (image) => {
      if (image.b64_json) return `data:image/png;base64,${image.b64_json}`
      if (image.url) return urlToDataUrl(image.url)
      return ''
    })
  )
  return dataUrls.filter(Boolean)
}

export async function generateOpenAICompatibleImages(params: {
  apiKey: string
  baseUrl?: string
  model?: string
  prompt: string
  num?: number
  referenceImageDataUrls?: string[]
  signal?: AbortSignal
}) {
  const apiKey = params.apiKey.trim()
  if (!apiKey.trim()) {
    throw new Error('Image API Key is required.')
  }
  if (!params.prompt.trim()) {
    throw new Error('Prompt is required.')
  }

  const baseUrl = normalizeOpenAIBaseUrl(params.baseUrl)
  const model = params.model || V2API_DEFAULT_IMAGE_MODEL
  const n = params.num || 1

  if (params.referenceImageDataUrls?.length) {
    const formData = new FormData()
    formData.append('model', model)
    formData.append('prompt', params.prompt)
    formData.append('n', String(n))
    formData.append('response_format', 'b64_json')
    params.referenceImageDataUrls.forEach((dataUrl, index) => {
      const blob = dataUrlToBlob(dataUrl)
      formData.append('image', new File([blob], `reference-${index + 1}.png`, { type: blob.type || 'image/png' }))
    })

    const request = isV2ChatBusinessURL(`${baseUrl}/images/edit`) ? v2chatAuthenticatedFetch : fetch
    const response = await request(`${baseUrl}/images/edit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: params.signal,
    })
    return parseImageResponse(response)
  }

  const request = isV2ChatBusinessURL(`${baseUrl}/images/generations`) ? v2chatAuthenticatedFetch : fetch
  const response = await request(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: params.prompt,
      n,
      response_format: 'b64_json',
    }),
    signal: params.signal,
  })
  return parseImageResponse(response)
}
