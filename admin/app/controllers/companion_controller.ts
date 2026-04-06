import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

type RoachTailPeerRecord = {
  id: string
  name: string
  platform: string
  status: string
  endpoint?: string | null
  lastSeenAt?: string | null
  allowsExitNode?: boolean
  tags?: string[]
}

type InternalRoachTailPeerRecord = RoachTailPeerRecord & {
  tokenHash?: string | null
  pairedAt?: string | null
  appVersion?: string | null
}

type RoachTailStateRecord = {
  enabled: boolean
  networkName: string
  deviceName: string
  deviceId: string
  status: string
  relayHost?: string | null
  advertisedUrl?: string | null
  joinCode?: string | null
  joinCodeIssuedAt?: string | null
  joinCodeExpiresAt?: string | null
  lastUpdatedAt?: string | null
  notes: string[]
  peers: RoachTailPeerRecord[]
}

type InternalRoachTailStateRecord = Omit<RoachTailStateRecord, 'peers'> & {
  peers: InternalRoachTailPeerRecord[]
}

type RoachTailStateSanitizeOptions = {
  hideJoinCode?: boolean
}

const ROACHTAIL_JOIN_CODE_TTL_MS = 10 * 60 * 1000

type RoachTailActionInput = {
  action?:
    | 'enable'
    | 'disable'
    | 'refresh-join-code'
    | 'clear-peers'
    | 'set-relay-host'
    | 'register-peer'
    | 'remove-peer'
  relayHost?: string | null
  peerId?: string | null
  peerName?: string | null
  platform?: string | null
  endpoint?: string | null
  allowsExitNode?: boolean
  tags?: string[]
}

type RoachTailPairInput = {
  joinCode?: string | null
  peerId?: string | null
  peerName?: string | null
  platform?: string | null
  endpoint?: string | null
  appVersion?: string | null
  allowsExitNode?: boolean
  tags?: string[]
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

  async roachtail({ request }: HttpContext) {
    return this.roachTailPayload({
      hideJoinCode: this.isPeerRoachTailRequest(request),
    })
  }

  async pairRoachTail({ request, response }: HttpContext) {
    const payload = request.body() as RoachTailPairInput
    const joinCode = payload.joinCode?.trim().toUpperCase()

    if (!joinCode) {
      return response.status(400).json({
        error: 'A RoachTail join code is required to pair this device.',
      })
    }

    try {
      const pairing = await this.pairRoachTailPeer(joinCode, payload)
      return response.status(201).json(pairing)
    } catch (error) {
      return response.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to pair this device with RoachTail',
      })
    }
  }

  async affectRoachTail({ request, response }: HttpContext) {
    const payload = request.body() as RoachTailActionInput
    const action = payload.action?.trim() as RoachTailActionInput['action']
    const peerRequest = this.isPeerRoachTailRequest(request)
    const peerID = this.roachTailPeerID(request)

    if (
      !action ||
      ![
        'enable',
        'disable',
        'refresh-join-code',
        'clear-peers',
        'set-relay-host',
        'register-peer',
        'remove-peer',
      ].includes(action)
    ) {
      return response.status(400).json({
        error:
          'RoachTail action must be enable, disable, refresh-join-code, clear-peers, set-relay-host, register-peer, or remove-peer.',
      })
    }

    if (peerRequest) {
      const selfScopedAction = action === 'register-peer' || action === 'remove-peer'
      const peerCanAct = action === 'enable' || action === 'disable' || selfScopedAction

      if (!peerCanAct) {
        return response.status(403).json({
          error: 'This RoachTail action requires the desktop companion token.',
        })
      }

      if (selfScopedAction && peerID) {
        const requestedPeerID = payload.peerId?.trim()
        if (requestedPeerID && requestedPeerID !== peerID) {
          return response.status(403).json({
            error: 'Peer-scoped RoachTail changes can only target the paired device token.',
          })
        }
        payload.peerId = peerID
      }
    }

    try {
      const state = await this.mutateRoachTailState(action, payload)
      const actionLabel =
        action === 'refresh-join-code'
          ? 'RoachTail join code refreshed.'
          : action === 'clear-peers'
            ? 'RoachTail peers cleared.'
            : action === 'set-relay-host'
              ? 'RoachTail relay host updated.'
              : action === 'register-peer'
                ? 'Device linked to RoachTail.'
                : action === 'remove-peer'
                  ? 'RoachTail peer removed.'
                  : action === 'enable'
                    ? 'RoachTail enabled.'
                    : 'RoachTail disabled.'

      return {
        success: true,
        message: actionLabel,
        state,
      }
    } catch (error) {
      return response.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update RoachTail state',
      })
    }
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
    const [systemInfo, providers, roachClaw, services, downloads, installedModels, roachTail] =
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
        this.roachTailPayload({
          hideJoinCode: this.isPeerRoachTailRequest(request),
        }),
      ])

    return {
      systemInfo,
      providers,
      roachClaw,
      roachTail,
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
    const storagePath = this.storagePath()

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

  private async roachTailPayload(
    options: RoachTailStateSanitizeOptions = {}
  ): Promise<RoachTailStateRecord> {
    const current = await this.readRoachTailStateRaw()
    const statePath = this.roachTailStatePath()

    if (current.enabled && (!this.isRoachTailJoinCodeFresh(current) || !current.joinCode) && statePath) {
      const joinCodeBundle = this.issueRoachTailJoinCode()
      current.joinCode = joinCodeBundle.joinCode
      current.joinCodeIssuedAt = joinCodeBundle.issuedAt
      current.joinCodeExpiresAt = joinCodeBundle.expiresAt
      current.lastUpdatedAt = new Date().toISOString()
      await mkdir(path.dirname(statePath), { recursive: true })
      await writeFile(statePath, JSON.stringify(current, null, 2), 'utf8')
    }

    return this.sanitizeRoachTailState(current, options)
  }

  private async readRoachTailStateRaw(): Promise<InternalRoachTailStateRecord> {
    const statePath = this.roachTailStatePath()
    const advertisedUrl =
      process.env.ROACHNET_COMPANION_ADVERTISED_URL?.trim() ||
      process.env.ROACHNET_COMPANION_TARGET_URL?.trim() ||
      null
    const relayHost = process.env.ROACHTAIL_RELAY_HOST?.trim() || null
    const configuredDeviceName =
      process.env.ROACHTAIL_DEVICE_NAME?.trim() ||
      process.env.ROACHNET_DEVICE_NAME?.trim() ||
      'RoachNet desktop'
    const configuredNetworkName = process.env.ROACHTAIL_NETWORK_NAME?.trim() || 'RoachTail'
    const configuredDeviceId =
      process.env.ROACHTAIL_DEVICE_ID?.trim() || `roachnet-${randomUUID().slice(0, 8)}`
    const configuredJoinCode = process.env.ROACHTAIL_JOIN_CODE?.trim() || null
    const enabled =
      process.env.ROACHTAIL_ENABLED === '1' || process.env.ROACHNET_COMPANION_ENABLED === '1'

    const fallback: InternalRoachTailStateRecord = {
      enabled,
      networkName: configuredNetworkName,
      deviceName: configuredDeviceName,
      deviceId: configuredDeviceId,
      status: enabled ? 'armed' : 'local-only',
      relayHost,
      advertisedUrl,
      joinCode: configuredJoinCode,
      joinCodeIssuedAt: configuredJoinCode ? new Date().toISOString() : null,
      joinCodeExpiresAt: configuredJoinCode
        ? new Date(Date.now() + ROACHTAIL_JOIN_CODE_TTL_MS).toISOString()
        : null,
      lastUpdatedAt: new Date().toISOString(),
      notes: [
        'RoachTail keeps the companion lane ready for private device-to-device control.',
        enabled
          ? 'This desktop is ready to advertise a private control lane to linked devices.'
          : 'Enable RoachTail to group mobile and desktop lanes behind a private overlay.',
        'Future mesh peers can reuse the same bridge and install-intent flow that powers RoachNet iOS.',
      ],
      peers: [],
    }

    if (!statePath) {
      return fallback
    }

    try {
      const raw = await readFile(statePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') {
        return fallback
      }

      const peers = Array.isArray(parsed.peers)
        ? parsed.peers
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: Record<string, unknown>, index: number) => ({
              id: typeof entry.id === 'string' ? entry.id : `peer-${index}`,
              name: typeof entry.name === 'string' ? entry.name : `Linked device ${index + 1}`,
              platform: typeof entry.platform === 'string' ? entry.platform : 'device',
              status: typeof entry.status === 'string' ? entry.status : 'linked',
              endpoint: typeof entry.endpoint === 'string' ? entry.endpoint : null,
              lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
              allowsExitNode: Boolean(entry.allowsExitNode),
              tags: Array.isArray(entry.tags)
                ? entry.tags.filter((value: unknown) => typeof value === 'string')
                : [],
              tokenHash: typeof entry.tokenHash === 'string' ? entry.tokenHash : null,
              pairedAt: typeof entry.pairedAt === 'string' ? entry.pairedAt : null,
              appVersion: typeof entry.appVersion === 'string' ? entry.appVersion : null,
            }))
        : []

      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
        networkName:
          typeof parsed.networkName === 'string' ? parsed.networkName : fallback.networkName,
        deviceName:
          typeof parsed.deviceName === 'string' ? parsed.deviceName : fallback.deviceName,
        deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : fallback.deviceId,
        status:
          typeof parsed.status === 'string'
            ? parsed.status
            : peers.length > 0
              ? 'connected'
              : fallback.status,
        relayHost: typeof parsed.relayHost === 'string' ? parsed.relayHost : fallback.relayHost,
        advertisedUrl:
          typeof parsed.advertisedUrl === 'string'
            ? parsed.advertisedUrl
            : fallback.advertisedUrl,
        joinCode: typeof parsed.joinCode === 'string' ? parsed.joinCode : fallback.joinCode,
        joinCodeIssuedAt:
          typeof parsed.joinCodeIssuedAt === 'string'
            ? parsed.joinCodeIssuedAt
            : fallback.joinCodeIssuedAt,
        joinCodeExpiresAt:
          typeof parsed.joinCodeExpiresAt === 'string'
            ? parsed.joinCodeExpiresAt
            : fallback.joinCodeExpiresAt,
        lastUpdatedAt:
          typeof parsed.lastUpdatedAt === 'string'
            ? parsed.lastUpdatedAt
            : fallback.lastUpdatedAt,
        notes: Array.isArray(parsed.notes)
          ? parsed.notes.filter((value: unknown) => typeof value === 'string')
          : fallback.notes,
        peers,
      }
    } catch {
      return fallback
    }
  }

  private sanitizeRoachTailState(
    state: InternalRoachTailStateRecord,
    options: RoachTailStateSanitizeOptions = {}
  ): RoachTailStateRecord {
    return {
      ...state,
      joinCode: options.hideJoinCode ? null : state.joinCode ?? null,
      joinCodeIssuedAt: options.hideJoinCode ? null : state.joinCodeIssuedAt ?? null,
      joinCodeExpiresAt: options.hideJoinCode ? null : state.joinCodeExpiresAt ?? null,
      peers: state.peers.map((peer) => ({
        id: peer.id,
        name: peer.name,
        platform: peer.platform,
        status: peer.status,
        endpoint: peer.endpoint ?? null,
        lastSeenAt: peer.lastSeenAt ?? null,
        allowsExitNode: peer.allowsExitNode ?? false,
        tags: peer.tags ?? [],
      })),
    }
  }

  private async mutateRoachTailState(
    action: NonNullable<RoachTailActionInput['action']>,
    payload: RoachTailActionInput
  ): Promise<RoachTailStateRecord> {
    const statePath = this.roachTailStatePath()
    if (!statePath) {
      throw new Error('RoachTail cannot persist state until the contained RoachNet storage lane exists.')
    }

    const roachTailDir = path.dirname(statePath)
    await mkdir(roachTailDir, { recursive: true })

    const current = await this.readRoachTailStateRaw()
    const next: InternalRoachTailStateRecord = {
      ...current,
      notes: [...current.notes],
      peers: current.peers.map((peer) => ({ ...peer })),
      lastUpdatedAt: new Date().toISOString(),
    }

    switch (action) {
      case 'enable':
        {
          const joinCodeBundle = this.issueRoachTailJoinCode()
          next.joinCode = joinCodeBundle.joinCode
          next.joinCodeIssuedAt = joinCodeBundle.issuedAt
          next.joinCodeExpiresAt = joinCodeBundle.expiresAt
        }
        next.enabled = true
        next.status = next.peers.length > 0 ? 'connected' : 'armed'
        next.notes = [
          'RoachTail is armed and ready to pair new devices.',
          'Use the join code from your phone or tablet to register a private control peer.',
          'The companion lane keeps chat carryover, runtime control, and install intents grouped behind the same private overlay.',
        ]
        break
      case 'disable':
        next.enabled = false
        next.status = 'local-only'
        next.joinCode = null
        next.joinCodeIssuedAt = null
        next.joinCodeExpiresAt = null
        next.notes = [
          'RoachTail is disabled and the desktop has fallen back to the local-only companion lane.',
          'Existing peer records are kept so you can re-arm the mesh without rebuilding every device link.',
        ]
        break
      case 'refresh-join-code':
        {
          const joinCodeBundle = this.issueRoachTailJoinCode()
          next.joinCode = joinCodeBundle.joinCode
          next.joinCodeIssuedAt = joinCodeBundle.issuedAt
          next.joinCodeExpiresAt = joinCodeBundle.expiresAt
        }
        next.enabled = true
        next.status = next.peers.length > 0 ? 'connected' : 'armed'
        next.notes = [
          'RoachTail issued a fresh join code for the next device pair.',
          'Share the new code only with devices you want on the private control lane.',
        ]
        break
      case 'clear-peers':
        next.peers = []
        next.status = next.enabled ? 'armed' : 'local-only'
        next.notes = [
          'RoachTail peer records were cleared from the contained state lane.',
          'You can register the phone, tablet, and desktop again from a clean private-mesh slate.',
        ]
        break
      case 'set-relay-host':
        next.relayHost = payload.relayHost?.trim() || null
        next.notes = [
          next.relayHost
            ? `RoachTail will advertise the relay host ${next.relayHost}.`
            : 'RoachTail relay host was cleared and will fall back to the advertised desktop bridge.',
        ]
        break
      case 'register-peer': {
        const peerId = payload.peerId?.trim() || `peer-${randomUUID().slice(0, 8)}`
        const peerName = payload.peerName?.trim() || 'Linked device'
        const platform = payload.platform?.trim() || 'device'
        const endpoint = payload.endpoint?.trim() || null
        const tags = Array.isArray(payload.tags)
          ? payload.tags.map((tag) => String(tag)).filter(Boolean)
          : []
        const existingIndex = next.peers.findIndex((peer) => peer.id === peerId)
        const peerRecord: InternalRoachTailPeerRecord = {
          id: peerId,
          name: peerName,
          platform,
          status: 'linked',
          endpoint,
          lastSeenAt: new Date().toISOString(),
          allowsExitNode: Boolean(payload.allowsExitNode),
          tags,
        }
        if (existingIndex >= 0) {
          next.peers[existingIndex] = peerRecord
        } else {
          next.peers.unshift(peerRecord)
        }
        next.enabled = true
        next.status = 'connected'
        if (!next.joinCode || !this.isRoachTailJoinCodeFresh(next)) {
          const joinCodeBundle = this.issueRoachTailJoinCode()
          next.joinCode = joinCodeBundle.joinCode
          next.joinCodeIssuedAt = joinCodeBundle.issuedAt
          next.joinCodeExpiresAt = joinCodeBundle.expiresAt
        }
        next.notes = [
          `${peerName} joined the RoachTail control lane.`,
          'RoachTail can now route remote chat carryover, runtime toggles, and App installs to this desktop.',
        ]
        break
      }
      case 'remove-peer': {
        const peerId = payload.peerId?.trim()
        if (!peerId) {
          throw new Error('A peerId is required to remove a RoachTail peer.')
        }
        next.peers = next.peers.filter((peer) => peer.id !== peerId)
        next.status = next.enabled ? (next.peers.length > 0 ? 'connected' : 'armed') : 'local-only'
        next.notes = [
          'RoachTail removed one peer from the private device lane.',
          next.peers.length > 0
            ? 'Other linked devices remain available on the overlay.'
            : 'No linked peers remain. Refresh the join code when you are ready to add another device.',
        ]
        break
      }
    }

    await writeFile(statePath, JSON.stringify(next, null, 2), 'utf8')
    return this.sanitizeRoachTailState(next)
  }

  private async pairRoachTailPeer(
    joinCode: string,
    payload: RoachTailPairInput
  ) {
    const statePath = this.roachTailStatePath()
    if (!statePath) {
      throw new Error('RoachTail cannot pair devices until the contained RoachNet storage lane exists.')
    }

    const roachTailDir = path.dirname(statePath)
    await mkdir(roachTailDir, { recursive: true })

    const next = await this.readRoachTailStateRaw()
    if (!next.enabled) {
      throw new Error('RoachTail is off on this desktop. Turn it on before pairing a device.')
    }

    if (!this.isRoachTailJoinCodeFresh(next)) {
      throw new Error('That RoachTail join code expired. Refresh the code on the desktop and try again.')
    }

    if (!next.joinCode || next.joinCode.trim().toUpperCase() != joinCode) {
      throw new Error('That RoachTail join code does not match this desktop.')
    }

    const peerId = payload.peerId?.trim() || `peer-${randomUUID().slice(0, 8)}`
    const peerName = payload.peerName?.trim() || 'Linked device'
    const platform = payload.platform?.trim() || 'device'
    const endpoint = payload.endpoint?.trim() || null
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map((tag) => String(tag)).filter(Boolean)
      : []
    const pairToken = this.generateRoachTailPeerToken()
    const tokenHash = this.hashRoachTailToken(pairToken)
    const existingIndex = next.peers.findIndex((peer) => peer.id === peerId)
    const peerRecord: InternalRoachTailPeerRecord = {
      id: peerId,
      name: peerName,
      platform,
      status: 'paired',
      endpoint,
      lastSeenAt: new Date().toISOString(),
      allowsExitNode: Boolean(payload.allowsExitNode),
      tags,
      tokenHash,
      pairedAt: new Date().toISOString(),
      appVersion: payload.appVersion?.trim() || null,
    }

    if (existingIndex >= 0) {
      next.peers[existingIndex] = peerRecord
    } else {
      next.peers.unshift(peerRecord)
    }

    next.status = 'connected'
    next.lastUpdatedAt = new Date().toISOString()
    next.notes = [
      `${peerName} paired over RoachTail.`,
      'This device now has its own private bridge token for chat carryover, runtime control, and App installs.',
      'Refresh the join code if you want to lock the pairing lane back down for the next device.',
    ]

    await writeFile(statePath, JSON.stringify(next, null, 2), 'utf8')

    return {
      success: true,
      message: `${peerName} paired with RoachTail.`,
      token: pairToken,
      peerId,
      bridgeUrl: this.companionBridgeURL(),
      state: this.sanitizeRoachTailState(next),
    }
  }

  private generateRoachTailJoinCode() {
    const token = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
    return `ROACH-${token.slice(0, 5)}-${token.slice(5)}`
  }

  private issueRoachTailJoinCode() {
    const issuedAt = new Date().toISOString()
    return {
      joinCode: this.generateRoachTailJoinCode(),
      issuedAt,
      expiresAt: new Date(Date.now() + ROACHTAIL_JOIN_CODE_TTL_MS).toISOString(),
    }
  }

  private isRoachTailJoinCodeFresh(state: InternalRoachTailStateRecord) {
    if (!state.joinCode) {
      return false
    }

    const expiresAt = state.joinCodeExpiresAt
    if (!expiresAt) {
      return true
    }

    const expiresAtValue = Date.parse(expiresAt)
    if (Number.isNaN(expiresAtValue)) {
      return true
    }

    return expiresAtValue > Date.now()
  }

  private generateRoachTailPeerToken() {
    return `rtp_${randomBytes(24).toString('hex')}`
  }

  private hashRoachTailToken(value: string) {
    return createHash('sha256').update(value).digest('hex')
  }

  private roachTailStatePath() {
    const storagePath = this.storagePath()
    return storagePath ? path.join(storagePath, 'vault', 'roachtail', 'state.json') : null
  }

  private companionBridgeURL() {
    const advertised = process.env.ROACHNET_COMPANION_ADVERTISED_URL?.trim()
    if (advertised) {
      return advertised
    }

    const configuredHost = process.env.ROACHNET_COMPANION_HOST?.trim() || '127.0.0.1'
    const configuredPort = process.env.ROACHNET_COMPANION_PORT?.trim() || '38111'
    const normalizedHost =
      configuredHost === '0.0.0.0' || configuredHost === '::' ? '127.0.0.1' : configuredHost
    const wrappedHost =
      normalizedHost.includes(':') && !normalizedHost.startsWith('[')
        ? `[${normalizedHost}]`
        : normalizedHost

    return `http://${wrappedHost}:${configuredPort}`
  }

  private storagePath() {
    return process.env.NOMAD_STORAGE_PATH?.trim() || process.env.ROACHNET_HOST_STORAGE_PATH?.trim()
  }

  private isPeerRoachTailRequest(request?: HttpContext['request']) {
    return request?.header('x-roachtail-auth-kind')?.trim().toLowerCase() === 'peer'
  }

  private roachTailPeerID(request?: HttpContext['request']) {
    return request?.header('x-roachtail-peer-id')?.trim() || null
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
