import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  setBlob: vi.fn(),
}))

vi.mock('@shared/v2api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/v2api')>()
  return {
    ...actual,
    getV2ChatServiceBaseUrl: () => 'https://chat.v2api.top/v1',
  }
})

vi.mock('@/stores/v2chatAccountStore', () => ({
  v2chatAuthenticatedFetch: mocks.authenticatedFetch,
}))

vi.mock('@/storage', () => ({
  default: { setBlob: mocks.setBlob },
}))

vi.mock('@/storage/StoreStorage', () => ({
  StorageKeyGenerator: {
    audio: (id: string) => `audio:${id}`,
  },
}))

import { createElevenLabsVoiceFromPreview, designElevenLabsVoice } from './elevenlabs-voices'
import { generateSpeech, transcribeAudio } from './v2api-tts'

describe('V2Chat media gateway', () => {
  beforeEach(() => {
    mocks.authenticatedFetch.mockReset()
    mocks.setBlob.mockReset()
  })

  it('routes TTS through the authenticated V2Chat gateway and stores the audio', async () => {
    mocks.authenticatedFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
    )

    const result = await generateSpeech({
      input: '今晚见。',
      sessionId: 'session-1',
      messageId: 'message-1',
      voice: 'voice-1',
    })

    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      'https://chat.v2api.top/v1/audio/speech',
      expect.objectContaining({ method: 'POST' })
    )
    const request = mocks.authenticatedFetch.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({ input: '今晚见。', voice: 'voice-1' })
    expect(new Headers(request.headers).has('Authorization')).toBe(false)
    expect(mocks.setBlob).toHaveBeenCalledWith('audio:session-1:message-1', expect.stringMatching(/^data:audio\/mpeg;base64,/))
    expect(result).toEqual({ storageKey: 'audio:session-1:message-1', mimeType: 'audio/mpeg' })
  })

  it('routes transcription through the authenticated V2Chat gateway', async () => {
    mocks.authenticatedFetch.mockResolvedValue(Response.json({ text: '转写完成' }))

    await expect(
      transcribeAudio({ audio: new Blob(['audio'], { type: 'audio/webm' }), durationMs: 1250 })
    ).resolves.toBe('转写完成')

    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      'https://chat.v2api.top/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    )
    const request = mocks.authenticatedFetch.mock.calls[0][1] as RequestInit
    expect(new Headers(request.headers).get('X-Audio-Duration-Ms')).toBe('1250')
    expect(new Headers(request.headers).has('Authorization')).toBe(false)
  })

  it('routes voice preview and creation through the same gateway', async () => {
    mocks.authenticatedFetch
      .mockResolvedValueOnce(
        Response.json({ previews: [{ generated_voice_id: 'preview-1', audio_base_64: 'YQ==' }] })
      )
      .mockResolvedValueOnce(Response.json({ voice_id: 'voice-1' }))

    const preview = await designElevenLabsVoice({
      voiceDescription: '温柔、清晰、略带故事感的成年女性中文音色',
    })
    const created = await createElevenLabsVoiceFromPreview({
      voiceName: '角色音色',
      voiceDescription: '温柔、清晰、略带故事感的成年女性中文音色',
      generatedVoiceId: preview.previews[0].generatedVoiceId,
    })

    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2)
    expect(mocks.authenticatedFetch.mock.calls.map((call) => call[0])).toEqual([
      'https://chat.v2api.top/v1/voices/design',
      'https://chat.v2api.top/v1/voices/design',
    ])
    expect(created.voice_id).toBe('voice-1')
  })
})
