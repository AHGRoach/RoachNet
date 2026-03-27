import { inject } from '@adonisjs/core'
import { OllamaService } from '#services/ollama_service'
import { OpenClawService } from '#services/openclaw_service'
import type {
  AIRuntimeProviderName,
  AIRuntimeProvidersResponse,
  AIRuntimeStatus,
} from '../../types/ai.js'

@inject()
export class AIRuntimeService {
  constructor(
    private ollamaService: OllamaService,
    private openClawService: OpenClawService
  ) {}

  async getProvider(provider: AIRuntimeProviderName): Promise<AIRuntimeStatus> {
    switch (provider) {
      case 'ollama':
        return await this.ollamaService.getRuntimeStatus()
      case 'openclaw':
        return await this.openClawService.getRuntimeStatus()
      default:
        return {
          provider,
          available: false,
          source: 'none',
          baseUrl: null,
          error: `Unsupported AI provider: ${provider}`,
        }
    }
  }

  async getProviders(): Promise<AIRuntimeProvidersResponse> {
    const [ollama, openclaw] = await Promise.all([
      this.getProvider('ollama'),
      this.getProvider('openclaw'),
    ])

    return {
      providers: {
        ollama,
        openclaw,
      },
    }
  }

  async isProviderAvailable(provider: AIRuntimeProviderName): Promise<boolean> {
    const runtimeStatus = await this.getProvider(provider)
    return runtimeStatus.available
  }
}
