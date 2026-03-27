export type AIRuntimeProviderName = 'ollama' | 'openclaw'

export type AIRuntimeSource = 'configured' | 'local' | 'docker' | 'none'

export type AIRuntimeStatus = {
  provider: AIRuntimeProviderName
  available: boolean
  source: AIRuntimeSource
  baseUrl: string | null
  error: string | null
}

export type AIRuntimeProvidersResponse = {
  providers: Record<AIRuntimeProviderName, AIRuntimeStatus>
}
