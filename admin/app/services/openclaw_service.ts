import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import axios from 'axios'
import env from '#start/env'
import KVStore from '#models/kv_store'
import type { AIRuntimeSource, AIRuntimeStatus } from '../../types/ai.js'

const OPENCLAW_HEALTH_PATHS = ['/health', '/api/health', '/']

@inject()
export class OpenClawService {
  public async getRuntimeStatus(): Promise<AIRuntimeStatus> {
    const candidates = await this.getRuntimeCandidates()
    let lastError: string | null = null

    for (const candidate of candidates) {
      const runtimeStatus = await this.checkRuntimeCandidate(candidate.baseUrl, candidate.source)
      if (runtimeStatus.available) {
        return runtimeStatus
      }

      lastError = runtimeStatus.error || lastError
    }

    return {
      provider: 'openclaw',
      available: false,
      source: 'none',
      baseUrl: null,
      error: lastError || 'OpenClaw runtime is not configured.',
    }
  }

  private async getRuntimeCandidates(): Promise<Array<{ baseUrl: string; source: AIRuntimeSource }>> {
    const settingUrl = (await KVStore.getValue('ai.openclawBaseUrl'))?.trim()
    const configuredUrl = env.get('OPENCLAW_BASE_URL')?.trim()
    const candidates: Array<{ baseUrl: string; source: AIRuntimeSource }> = []
    const seen = new Set<string>()

    const addCandidate = (baseUrl: string | null | undefined, source: AIRuntimeSource) => {
      if (!baseUrl) {
        return
      }

      const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl)
      if (seen.has(normalizedBaseUrl)) {
        return
      }

      seen.add(normalizedBaseUrl)
      candidates.push({ baseUrl: normalizedBaseUrl, source })
    }

    addCandidate(settingUrl, 'configured')
    addCandidate(configuredUrl, 'configured')

    return candidates
  }

  private async checkRuntimeCandidate(
    baseUrl: string,
    source: AIRuntimeSource
  ): Promise<AIRuntimeStatus> {
    let lastError: string | null = null

    for (const pathname of OPENCLAW_HEALTH_PATHS) {
      try {
        const response = await axios.get(this.buildRuntimeUrl(baseUrl, pathname), {
          timeout: 2000,
          validateStatus: () => true,
        })

        if (response.status >= 200 && response.status < 500 && response.status !== 404) {
          return {
            provider: 'openclaw',
            available: true,
            source,
            baseUrl,
            error: null,
          }
        }

        lastError = `OpenClaw runtime at ${baseUrl} returned HTTP ${response.status}.`
      } catch (error) {
        lastError = this.getRuntimeErrorMessage(baseUrl, error)
      }
    }

    logger.debug(`[OpenClawService] Runtime probe failed for ${baseUrl}: ${lastError}`)

    return {
      provider: 'openclaw',
      available: false,
      source,
      baseUrl,
      error: lastError,
    }
  }

  private buildRuntimeUrl(baseUrl: string, pathname: string): string {
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    return new URL(pathname.replace(/^\//, ''), normalizedBaseUrl).toString()
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '')
  }

  private getRuntimeErrorMessage(baseUrl: string, error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response?.status) {
        return `OpenClaw runtime at ${baseUrl} returned HTTP ${error.response.status}.`
      }

      if (error.code) {
        return `OpenClaw runtime at ${baseUrl} is not reachable (${error.code}).`
      }
    }

    if (error instanceof Error && error.message) {
      return `OpenClaw runtime at ${baseUrl} is not reachable: ${error.message}`
    }

    return `OpenClaw runtime at ${baseUrl} is not reachable.`
  }
}
