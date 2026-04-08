import type { AIRuntimeStatus } from './ai.js'
import type { OpenClawSkillCliStatus } from './openclaw.js'

export interface RoachClawPortableProfile {
  profileVersion: number
  label: string
  profilePath: string
  portableRoot: string
  workspacePath: string
  stateDir: string
  configFilePath: string | null
  preferredMode: 'ollama' | 'openclaw' | 'offline'
  defaultModel: string | null
  preferredModels: string[]
  installedModels: string[]
  providerEndpoints: {
    ollamaBaseUrl: string | null
    openclawBaseUrl: string | null
  }
  runtimeHints: {
    contained: boolean
    launchMode: 'native-contained' | 'configured-runtime'
    notes: string[]
  }
  updatedAt: string
}

export interface RoachClawStatusResponse {
  label: string
  ollama: AIRuntimeStatus
  openclaw: AIRuntimeStatus
  cliStatus: OpenClawSkillCliStatus
  workspacePath: string
  defaultModel: string | null
  resolvedDefaultModel: string | null
  preferredMode: 'ollama' | 'openclaw' | 'offline'
  ready: boolean
  installedModels: string[]
  preferredModels: string[]
  configFilePath: string | null
  portableProfile?: RoachClawPortableProfile
}

export interface ApplyRoachClawRequest {
  model: string
  workspacePath?: string
  ollamaBaseUrl?: string
  openclawBaseUrl?: string
}

export interface ApplyRoachClawResponse {
  success: boolean
  message: string
  model: string
  workspacePath: string
  configFilePath: string | null
}
