import { getV2ChatServiceBaseUrl } from '@shared/v2api'
import { v2chatAuthenticatedFetch } from '@/stores/v2chatAccountStore'

export type ElevenLabsVoicePreview = {
  generatedVoiceId: string
  audioBase64: string
  mediaType: string
  durationSecs?: number
  language?: string
}

async function readGatewayError(response: Response, fallback: string) {
  const text = await response.text().catch(() => '')
  if (!text) return fallback
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return data.error?.message || data.message || fallback
  } catch {
    return fallback
  }
}

async function postVoiceGateway(body: Record<string, unknown>, fallbackError: string) {
  const response = await v2chatAuthenticatedFetch(`${getV2ChatServiceBaseUrl()}/voices/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readGatewayError(response, fallbackError))
  return response.json()
}

export async function designElevenLabsVoice(params: {
  voiceDescription: string
  previewText?: string
}) {
  const description = params.voiceDescription.trim()
  if (description.length < 20) throw new Error('音色描述至少需要 20 个字符。')

  const body: Record<string, unknown> = {
    action: 'preview',
    voice_description: description,
    auto_generate_text: !params.previewText?.trim(),
    should_enhance: true,
    guidance_scale: 5,
  }
  if (params.previewText?.trim()) body.text = params.previewText.trim()

  const data = (await postVoiceGateway(body, '音色试听生成失败。')) as {
    previews?: Array<{
      audio_base_64?: string
      generated_voice_id?: string
      media_type?: string
      duration_secs?: number
      language?: string
    }>
    text?: string
  }

  return {
    text: data.text || '',
    previews: (data.previews || [])
      .filter((preview) => preview.generated_voice_id && preview.audio_base_64)
      .map(
        (preview): ElevenLabsVoicePreview => ({
          generatedVoiceId: preview.generated_voice_id || '',
          audioBase64: preview.audio_base_64 || '',
          mediaType: preview.media_type || 'audio/mpeg',
          durationSecs: preview.duration_secs,
          language: preview.language,
        })
      ),
  }
}

export async function createElevenLabsVoiceFromPreview(params: {
  voiceName: string
  voiceDescription: string
  generatedVoiceId: string
  playedNotSelectedVoiceIds?: string[]
}) {
  return (await postVoiceGateway(
    {
      action: 'create',
      voice_name: params.voiceName.trim() || 'V2Chat Character Voice',
      voice_description: params.voiceDescription.trim(),
      generated_voice_id: params.generatedVoiceId,
      played_not_selected_voice_ids: params.playedNotSelectedVoiceIds || [],
      labels: { app: 'V2Chat', source: 'character_voice_design' },
    },
    '创建音色失败。'
  )) as { voice_id: string; name?: string; preview_url?: string | null }
}
