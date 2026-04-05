import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ChatService } from '#services/chat_service'
import { OllamaService } from '#services/ollama_service'

type CompanionInstallInput = {
  installUrl?: string
  action?: string
  type?: string
  slug?: string
  category?: string
  tier?: string
  resource?: string
  resourceId?: string
  option?: string
  optionId?: string
  model?: string
  url?: string
  filetype?: string
  resourceType?: string
  metadata?: Record<string, unknown>
}

type CompanionInstallAction = {
  action: string
  slug?: string
  category?: string
  tier?: string
  resource?: string
  option?: string
  model?: string
  url?: string
  filetype?: string
  metadata?: Record<string, unknown>
}

type RoachBrainMemoryRecord = {
  id: string
  title: string
  summary: string
  source: string
  tags: string[]
  pinned: boolean
  lastAccessedAt: string
}

type RelayIssue = {
  path: string
  error: string
}

type CompanionServiceActionInput = {
  serviceName?: string
  action?: 'start' | 'stop' | 'restart'
}

type CompanionChatInputMessage = {
  role?: 'system' | 'user' | 'assistant' | string
  content?: string
}

@inject()
export default class CompanionController {
  constructor(
    private chatService: ChatService,
    private ollamaService: OllamaService
  ) {}

  async bootstrap({ request }: HttpContext) {
    const [runtime, vault, sessions] = await Promise.all([
      this.runtimePayload(request),
      this.vaultPayload(request),
      this.chatService.getAllSessions(),
    ])

    return {
      appName: 'RoachNet Companion',
      machineName: os.hostname(),
      appsCatalogUrl: 'https://apps.roachnet.org/app-store-catalog.json',
      runtime,
      vault,
      sessions: sessions.slice(0, 24),
    }
  }

  async runtime({ request }: HttpContext) {
    return this.runtimePayload(request)
  }

  async vault({ request }: HttpContext) {
    return this.vaultPayload(request)
  }

  async affectService({ request, response }: HttpContext) {
    try {
      const payload = request.body() as CompanionServiceActionInput
      const serviceName = payload.serviceName?.trim()
      const action = payload.action?.trim()

      if (!serviceName) {
        return response.status(400).json({ error: 'Service name is required' })
      }

      if (!action || !['start', 'stop', 'restart'].includes(action)) {
        return response
          .status(400)
          .json({ error: 'Service action must be start, stop, or restart' })
      }

      const result = await this.relayJson('/api/system/services/affect', request, {
        method: 'POST',
        body: JSON.stringify({
          service_name: serviceName,
          action,
        }),
      })

      return {
        ok: true,
        serviceName,
        action,
        result,
      }
    } catch (error) {
      return response.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to affect companion service',
      })
    }
  }

  async sessionsIndex() {
    return this.chatService.getAllSessions()
  }

  async sessionsShow({ params, response }: HttpContext) {
    const sessionId = Number(params.id)
    const session = Number.isFinite(sessionId) ? await this.chatService.getSession(sessionId) : null

    if (!session) {
      return response.status(404).json({ error: 'Session not found' })
    }

    return session
  }

  async sessionsStore({ request, response }: HttpContext) {
    const payload = request.body() as { title?: string; model?: string }
    const title = payload.title?.trim() || 'New Chat'
    const model = payload.model?.trim()

    try {
      const session = await this.chatService.createSession(title, model)
      return response.status(201).json(session)
    } catch (error) {
      return response.status(201).json(this.syntheticSession(title, model))
    }
  }

  async sendMessage({ request, response }: HttpContext) {
    try {
      const payload = request.body() as {
        sessionId?: number | string
        content?: string
        model?: string
        messages?: CompanionChatInputMessage[]
      }
      const content = payload.content?.trim()
      if (!content) {
        return response.status(400).json({ error: 'Message content is required' })
      }

      let sessionId = Number(payload.sessionId)
      let session = Number.isFinite(sessionId) ? await this.chatService.getSession(sessionId) : null

      if (!session) {
        try {
          const created = await this.chatService.createSession('New Chat', payload.model?.trim())
          sessionId = Number(created.id)
          session = await this.chatService.getSession(sessionId)
        } catch {
          session = null
        }
      }

      if (!session) {
        return this.sendEphemeralMessage(payload, content)
      }

      const selectedModel =
        payload.model?.trim() ||
        session.model ||
        process.env.ROACHNET_ROACHCLAW_DEFAULT_MODEL ||
        'qwen2.5-coder:1.5b'

      const userMessage = await this.chatService.addMessage(sessionId, 'user', content)
      const refreshedSession = await this.chatService.getSession(sessionId)
      if (!refreshedSession) {
        throw new Error('Failed to reload the updated chat session')
      }

      const ollamaResponse = await this.ollamaService.chat({
        model: selectedModel,
        messages: refreshedSession.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: false,
      })

      const assistantContent = ollamaResponse?.message?.content?.trim()
      if (!assistantContent) {
        throw new Error('RoachClaw returned an empty response')
      }

      const assistantMessage = await this.chatService.addMessage(
        sessionId,
        'assistant',
        assistantContent
      )
      await this.chatService.updateSession(sessionId, { model: selectedModel })

      const messageCount = await this.chatService.getMessageCount(sessionId)
      let title = refreshedSession.title
      if ((!title || title === 'New Chat') && messageCount <= 2) {
        title =
          (await this.chatService.generateTitle(sessionId, content, assistantContent)) ?? title
      }

      const finalSession = await this.chatService.getSession(sessionId)

      return {
        session: finalSession
          ? {
              id: finalSession.id,
              title: finalSession.title,
              model: finalSession.model || selectedModel,
              timestamp: finalSession.timestamp,
            }
          : {
              id: String(sessionId),
              title: title || 'New Chat',
              model: selectedModel,
              timestamp: new Date(),
            },
        userMessage,
        assistantMessage,
      }
    } catch (error) {
      return response.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to send companion message',
      })
    }
  }

  private async sendEphemeralMessage(
    payload: {
      sessionId?: number | string
      content?: string
      model?: string
      messages?: CompanionChatInputMessage[]
    },
    content: string
  ) {
    const selectedModel =
      payload.model?.trim() || process.env.ROACHNET_ROACHCLAW_DEFAULT_MODEL || 'qwen2.5-coder:1.5b'

    const history = Array.isArray(payload.messages)
      ? payload.messages
          .filter((message) => message && typeof message === 'object')
          .map((message) => ({
            role: ['system', 'user', 'assistant'].includes(String(message.role))
              ? (message.role as 'system' | 'user' | 'assistant')
              : 'user',
            content: String(message.content || '').trim(),
          }))
          .filter((message) => message.content.length > 0)
          .slice(-20)
      : []

    const userMessage = this.syntheticMessage('user', content)
    const ollamaResponse = await this.ollamaService.chat({
      model: selectedModel,
      messages: [...history, { role: 'user', content }],
      stream: false,
    })

    const assistantContent = ollamaResponse?.message?.content?.trim()
    if (!assistantContent) {
      throw new Error('RoachClaw returned an empty response')
    }

    const assistantMessage = this.syntheticMessage('assistant', assistantContent)
    const sessionTitle =
      history.find((message) => message.role === 'user')?.content?.slice(0, 57) ||
      content.slice(0, 57) ||
      'New Chat'

    return {
      session: this.syntheticSession(sessionTitle, selectedModel, String(payload.sessionId || '')),
      userMessage,
      assistantMessage,
    }
  }

  async install({ request, response }: HttpContext) {
    try {
      const action = this.normalizeInstallInput(request.body() as CompanionInstallInput)
      const result = await this.dispatchInstallAction(action, request)
      return {
        ok: true,
        action: action.action,
        result,
      }
    } catch (error) {
      return response.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to queue companion install',
      })
    }
  }

  private async runtimePayload(request: HttpContext['request']) {
    const issues: RelayIssue[] = []
    const [systemInfo, providers, roachClaw, services, downloads, installedModels] =
      await Promise.all([
        this.relayJsonFallback('/api/system/info', request, null, issues),
        this.relayJsonFallback('/api/system/ai/providers', request, { providers: {} }, issues),
        this.relayJsonFallback(
          '/api/roachclaw/status',
          request,
          {
            label: 'RoachClaw',
            ready: false,
            error: 'RoachClaw is still warming up.',
            installedModels: [],
          },
          issues
        ),
        this.relayJsonFallback('/api/system/services', request, [], issues),
        this.relayJsonFallback('/api/downloads/jobs', request, [], issues),
        this.relayJsonFallback('/api/ollama/installed-models', request, [], issues),
      ])

    return {
      systemInfo,
      providers,
      roachClaw,
      services,
      downloads,
      installedModels,
      issues,
    }
  }

  private async vaultPayload(request: HttpContext['request']) {
    const issues: RelayIssue[] = []
    const [knowledgeFiles, siteArchives, roachBrain] = await Promise.all([
      this.relayJsonFallback('/api/rag/files', request, { files: [] }, issues),
      this.relayJsonFallback('/api/site-archives', request, { archives: [] }, issues),
      this.readRoachBrainMemories(),
    ])

    return {
      knowledgeFiles: knowledgeFiles?.files ?? [],
      siteArchives: siteArchives?.archives ?? [],
      roachBrain,
      issues,
    }
  }

  private localBaseUrl(request?: HttpContext['request']) {
    if (request) {
      return new URL(`${request.protocol()}://${request.host()}`)
    }

    const origin = process.env.URL?.trim()
    if (origin) {
      return new URL(origin)
    }

    const host = process.env.HOST?.trim() || '127.0.0.1'
    const port = process.env.PORT?.trim() || '8080'
    return new URL(`http://${host}:${port}`)
  }

  private async relayJson(pathname: string, request?: HttpContext['request'], init?: RequestInit) {
    const url = new URL(pathname, this.localBaseUrl(request))
    const relayRequest = new Request(url, {
      ...init,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })

    const response = await fetch(relayRequest)
    if (!response.ok) {
      throw new Error(`Companion relay failed for ${pathname} (${response.status})`)
    }

    if (response.status === 204) {
      return null
    }

    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  private async relayJsonFallback<T>(
    pathname: string,
    request: HttpContext['request'],
    fallback: T,
    issues: RelayIssue[]
  ): Promise<T> {
    try {
      const value = await this.relayJson(pathname, request)
      return (value ?? fallback) as T
    } catch (error) {
      issues.push({
        path: pathname,
        error: error instanceof Error ? error.message : 'Relay failed',
      })
      return fallback
    }
  }

  private normalizeInstallInput(input: CompanionInstallInput): CompanionInstallAction {
    if (input.installUrl) {
      const url = new URL(input.installUrl)
      const route = (url.host || url.pathname.replace(/\//g, '')).toLowerCase()

      if (url.protocol !== 'roachnet:' || route !== 'install-content') {
        throw new Error('Companion install URLs must use the RoachNet install-content scheme')
      }

      const query = Object.fromEntries(url.searchParams.entries())
      return {
        action: query.action || query.type || '',
        slug: query.slug,
        category: query.category,
        tier: query.tier,
        resource: query.resource || query.resourceId,
        option: query.option || query.optionId,
        model: query.model,
        url: query.url,
        filetype: query.filetype || query.resourceType,
      }
    }

    return {
      action: input.action || input.type || '',
      slug: input.slug,
      category: input.category,
      tier: input.tier,
      resource: input.resource || input.resourceId,
      option: input.option || input.optionId,
      model: input.model,
      url: input.url,
      filetype: input.filetype || input.resourceType,
      metadata: input.metadata,
    }
  }

  private async dispatchInstallAction(
    input: CompanionInstallAction,
    request: HttpContext['request']
  ) {
    switch (input.action) {
      case 'base-map-assets':
        return this.relayJson('/api/maps/download-base-assets', request, { method: 'POST' })
      case 'map-collection':
        if (!input.slug) {
          throw new Error('Map collection installs need a collection slug')
        }
        return this.relayJson('/api/maps/download-collection', request, {
          method: 'POST',
          body: JSON.stringify({ slug: input.slug }),
        })
      case 'education-tier':
        if (!input.category || !input.tier) {
          throw new Error('Education tier installs need category and tier slugs')
        }
        return this.relayJson('/api/zim/download-category-tier', request, {
          method: 'POST',
          body: JSON.stringify({ categorySlug: input.category, tierSlug: input.tier }),
        })
      case 'education-resource':
        if (!input.category || !input.resource) {
          throw new Error('Education resource installs need a category and resource id')
        }
        return this.relayJson('/api/zim/download-category-resource', request, {
          method: 'POST',
          body: JSON.stringify({ categorySlug: input.category, resourceId: input.resource }),
        })
      case 'wikipedia-option':
        if (!input.option) {
          throw new Error('Wikipedia installs need an option id')
        }
        return this.relayJson('/api/zim/wikipedia/select', request, {
          method: 'POST',
          body: JSON.stringify({ optionId: input.option }),
        })
      case 'roachclaw-model':
        if (!input.model) {
          throw new Error('RoachClaw model installs need a model id')
        }
        const queuedModel = await this.relayJson('/api/ollama/models', request, {
          method: 'POST',
          body: JSON.stringify({ model: input.model }),
        })
        const appliedModel = await this.relayJson('/api/roachclaw/apply', request, {
          method: 'POST',
          body: JSON.stringify({ model: input.model }),
        })
        return { queuedModel, appliedModel }
      case 'direct-download':
        if (!input.url) {
          throw new Error('Direct download installs need a URL')
        }
        if (
          (input.filetype || '').toLowerCase() === 'map' ||
          (input.filetype || '').toLowerCase() === 'pmtiles'
        ) {
          return this.relayJson('/api/maps/download-remote', request, {
            method: 'POST',
            body: JSON.stringify({ url: input.url }),
          })
        }
        return this.relayJson('/api/zim/download-remote', request, {
          method: 'POST',
          body: JSON.stringify({ url: input.url, metadata: input.metadata }),
        })
      default:
        throw new Error(`Unknown companion install action: ${input.action || 'missing action'}`)
    }
  }

  private async readRoachBrainMemories(): Promise<RoachBrainMemoryRecord[]> {
    const storagePath =
      process.env.NOMAD_STORAGE_PATH?.trim() || process.env.ROACHNET_HOST_STORAGE_PATH?.trim()

    if (!storagePath) {
      return []
    }

    const catalogPath = path.join(storagePath, 'vault', 'roachbrain', 'memories.json')

    try {
      const raw = await readFile(catalogPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          id: String(entry.id || ''),
          title: String(entry.title || 'RoachBrain note'),
          summary: String(entry.summary || ''),
          source: String(entry.source || 'RoachBrain'),
          tags: Array.isArray(entry.tags) ? entry.tags.map((tag: unknown) => String(tag)) : [],
          pinned: Boolean(entry.pinned),
          lastAccessedAt: String(entry.lastAccessedAt || entry.createdAt || ''),
        }))
        .filter((entry) => entry.id && entry.title)
        .slice(0, 40)
    } catch {
      return []
    }
  }

  private syntheticSession(title: string, model?: string, existingId?: string) {
    return {
      id: existingId?.startsWith('local-') ? existingId : `local-${randomUUID()}`,
      title,
      model: model || null,
      timestamp: new Date().toISOString(),
    }
  }

  private syntheticMessage(role: 'user' | 'assistant', content: string) {
    return {
      id: `local-message-${randomUUID()}`,
      role,
      content,
      createdAt: new Date().toISOString(),
    }
  }
}
