import { fetchRemoteModels } from '../../models/openai-compatible'
import { ModelProviderEnum, ModelProviderType, type ProviderModelInfo } from '../../types'
import { V2API_BASE_URL, V2API_DEFAULT_CHAT_MODEL, guessV2APIModelCapabilities } from '../../v2api'
import { defineProvider } from '../registry'
import Claude from './models/claude'
import Gemini from './models/gemini'
import OpenAI from './models/openai'
import type { CreateModelConfig } from '../types'

function withV2APICapabilities(models: ProviderModelInfo[]): ProviderModelInfo[] {
  return models
    .filter((model) => !/embedding|rerank|tts|audio|whisper|speech/i.test(model.modelId))
    .map((model) => ({
      ...model,
      capabilities: model.capabilities?.length ? model.capabilities : guessV2APIModelCapabilities(model.modelId),
    }))
}

async function listV2APIModels(config: CreateModelConfig): Promise<ProviderModelInfo[]> {
  const models = await fetchRemoteModels(
    {
      apiHost: V2API_BASE_URL,
      apiKey: config.effectiveApiKey,
      useProxy: false,
    },
    config.dependencies
  )
  return withV2APICapabilities(models)
}

class V2APIOpenAIModel extends OpenAI {
  public name = 'V2API OpenAI'

  public async listModels() {
    return listV2APIModels(this.v2apiConfig)
  }

  constructor(
    options: ConstructorParameters<typeof OpenAI>[0],
    dependencies: ConstructorParameters<typeof OpenAI>[1],
    private v2apiConfig: CreateModelConfig
  ) {
    super(options, dependencies)
  }
}

class V2APIClaudeModel extends Claude {
  public name = 'V2API Claude'

  public async listModels() {
    return listV2APIModels(this.v2apiConfig)
  }

  constructor(
    options: ConstructorParameters<typeof Claude>[0],
    dependencies: ConstructorParameters<typeof Claude>[1],
    private v2apiConfig: CreateModelConfig
  ) {
    super(options, dependencies)
  }
}

class V2APIGeminiModel extends Gemini {
  public name = 'V2API Gemini'

  public async listModels() {
    return listV2APIModels(this.v2apiConfig)
  }

  constructor(
    options: ConstructorParameters<typeof Gemini>[0],
    dependencies: ConstructorParameters<typeof Gemini>[1],
    private v2apiConfig: CreateModelConfig
  ) {
    super(options, dependencies)
  }
}

const defaultModels: ProviderModelInfo[] = [
  {
    modelId: V2API_DEFAULT_CHAT_MODEL,
    capabilities: ['vision', 'tool_use'],
    type: 'chat',
  },
]

export const v2apiOpenAIProvider = defineProvider({
  id: ModelProviderEnum.V2APIOpenAI,
  name: 'V2API OpenAI',
  type: ModelProviderType.OpenAI,
  description: 'V2API OpenAI-compatible protocol. Base URL is fixed.',
  defaultSettings: {
    apiHost: V2API_BASE_URL,
    models: defaultModels,
  },
  createModel: (config) =>
    new V2APIOpenAIModel(
      {
        apiKey: config.effectiveApiKey,
        apiHost: V2API_BASE_URL,
        model: config.model,
        dalleStyle: config.settings.dalleStyle || 'vivid',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        useProxy: false,
        stream: config.settings.stream,
        listModelsFallback: config.providerSetting.models || defaultModels,
      },
      config.dependencies,
      config
    ),
  getDisplayName: (modelId, providerSettings) =>
    `V2API OpenAI (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`,
})

export const v2apiClaudeProvider = defineProvider({
  id: ModelProviderEnum.V2APIClaude,
  name: 'V2API Claude',
  type: ModelProviderType.Claude,
  description: 'V2API Claude protocol. Base URL is fixed.',
  defaultSettings: {
    apiHost: V2API_BASE_URL,
    models: [
      {
        modelId: 'claude-sonnet-4-5',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        type: 'chat',
      },
    ],
  },
  createModel: (config) =>
    new V2APIClaudeModel(
      {
        claudeApiKey: config.effectiveApiKey,
        claudeApiHost: V2API_BASE_URL,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies,
      config
    ),
  getDisplayName: (modelId, providerSettings) =>
    `V2API Claude (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`,
})

export const v2apiGeminiProvider = defineProvider({
  id: ModelProviderEnum.V2APIGemini,
  name: 'V2API Gemini',
  type: ModelProviderType.Gemini,
  description: 'V2API Gemini protocol. Base URL is fixed.',
  defaultSettings: {
    apiHost: V2API_BASE_URL,
    models: [
      {
        modelId: 'gemini-2.5-flash',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        type: 'chat',
      },
    ],
  },
  createModel: (config) =>
    new V2APIGeminiModel(
      {
        geminiAPIKey: config.effectiveApiKey,
        geminiAPIHost: V2API_BASE_URL,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies,
      config
    ),
  getDisplayName: (modelId, providerSettings) =>
    `V2API Gemini (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`,
})
