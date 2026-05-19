#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import {
  createRoachClawAgentRun,
  roachClawNativeAgentStatus,
} from './lib/roachnet_roachclaw_agent.mjs'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..')
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const storageRoot = normalizePath(process.env.ROACHNET_STORAGE_PATH, path.join(os.homedir(), 'RoachNet', 'storage'))
const runtimeStateRoot = normalizePath(process.env.ROACHNET_RUNTIME_STATE_ROOT, path.join(storageRoot, '.runtime'))
const logRoot = path.join(storageRoot, 'logs')
const logPath = path.join(logRoot, 'roachnet-native-api.log')
const statePath = path.join(runtimeStateRoot, 'roachnet-native-api-state.json')
const processInfoPath = path.join(logRoot, 'roachnet-runtime-processes.json')
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:36434'
const openClawBaseUrl = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:13001'
const defaultModel = process.env.ROACHNET_ROACHCLAW_DEFAULT_MODEL || 'qwen2.5-coder:1.5b'
const githubReleasesApiUrl =
  process.env.ROACHNET_GITHUB_RELEASES_API_URL?.trim() ||
  'https://api.github.com/repos/RoachWares/RoachNet/releases'
const githubReleasesUrl =
  process.env.ROACHNET_RELEASES_URL?.trim() ||
  'https://github.com/RoachWares/RoachNet/releases'
const appsDownloadsBaseUrl =
  process.env.ROACHNET_APPS_DOWNLOADS_BASE_URL?.trim() ||
  'https://apps.roachnet.org/downloads'
const NATIVE_API_MAX_REQUEST_BODY_BYTES = positiveIntegerEnv('ROACHNET_NATIVE_API_MAX_BODY_BYTES', 1024 * 1024)
const NATIVE_API_DOWNLOAD_TIMEOUT_MS = positiveIntegerEnv('ROACHNET_NATIVE_API_DOWNLOAD_TIMEOUT_MS', 10 * 60 * 1000)
const NATIVE_API_MAX_DOWNLOAD_BYTES = positiveIntegerEnv('ROACHNET_NATIVE_API_MAX_DOWNLOAD_BYTES', 512 * 1024 ** 3)
let benchmarkStatus = { status: 'idle', benchmarkId: null }
let systemUpdateStatus = updateStatus('idle', 0, 'No update in progress')
let latestReleaseCache = null
let ollamaProcess = null
let companionProcess = null
let downloadJobs = []

mkdirSync(logRoot, { recursive: true })
mkdirSync(runtimeStateRoot, { recursive: true })

if (process.argv.includes('--stop')) {
  await stopExistingRuntime()
  process.exit(0)
}

function normalizePath(value, fallback) {
  const trimmed = String(value || '').trim()
  return trimmed ? path.resolve(trimmed.replace(/^~(?=$|\/)/, os.homedir())) : fallback
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

class NativeApiRequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

async function log(line) {
  await appendFile(logPath, `[${new Date().toISOString()}] ${line}\n`).catch(() => {})
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeLoopbackHost(value) {
  const rawHost = String(value || '').trim().replace(/^\[|\]$/g, '')
  if (!rawHost || rawHost === '0.0.0.0' || rawHost === '::') {
    return '127.0.0.1'
  }
  if (['127.0.0.1', 'localhost', '::1'].includes(rawHost.toLowerCase())) {
    return rawHost
  }

  throw new Error(`RoachNet native API only binds to loopback hosts. Refusing HOST=${rawHost}.`)
}

function commandForPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return ''
  }

  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    timeout: 1_000,
  })
  return result.status === 0 ? String(result.stdout || '').trim() : ''
}

function commandLooksLikeRoachNetProcess(command, allowedNames) {
  if (!command) {
    return false
  }

  return allowedNames.some((name) => command.includes(name))
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPidExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidIsAlive(pid)) {
      return true
    }
    await sleep(150)
  }
  return false
}

async function terminateStatePid(pid, allowedNames, label) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid || !pidIsAlive(pid)) {
    return
  }

  const command = commandForPid(pid)
  if (!commandLooksLikeRoachNetProcess(command, allowedNames)) {
    await log(`skipped ${label} stale pid ${pid}; command did not match RoachNet runtime`)
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
    if (!(await waitForPidExit(pid))) {
      process.kill(pid, 'SIGKILL')
    }
    await log(`stopped previous ${label} pid=${pid}`)
  } catch (error) {
    await log(`failed to stop previous ${label} pid=${pid}: ${error.message}`)
  }
}

function cleanupRuntimeStateFiles() {
  rmSync(statePath, { force: true })
  rmSync(processInfoPath, { force: true })
  if (process.env.ROACHNET_SERVER_INFO_FILE) {
    rmSync(process.env.ROACHNET_SERVER_INFO_FILE, { force: true })
  }
}

async function stopExistingRuntime() {
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    await terminateStatePid(Number(state.pid), ['run-roachnet-native-api.mjs'], 'native api')
    await terminateStatePid(Number(state.companionPid), ['roachnet-companion-server.mjs'], 'companion')
  } catch {}

  cleanupRuntimeStateFiles()
}

function sendJson(response, statusCode, value) {
  const payload = JSON.stringify(value)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function updateStatus(stage, progress, message) {
  return {
    stage,
    progress,
    message,
    timestamp: new Date().toISOString(),
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let settled = false

    const fail = (error, destroy = false) => {
      if (settled) return
      settled = true
      reject(error)
      if (destroy) {
        request.destroy()
      } else {
        request.resume()
      }
    }

    const contentLength = Number(request.headers['content-length'] || 0)
    if (contentLength > NATIVE_API_MAX_REQUEST_BODY_BYTES) {
      fail(
        new NativeApiRequestError(
          `Request body is larger than ${NATIVE_API_MAX_REQUEST_BODY_BYTES} bytes.`,
          413
        )
      )
      return
    }

    request.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.byteLength
      if (bytes > NATIVE_API_MAX_REQUEST_BODY_BYTES) {
        fail(
          new NativeApiRequestError(
            `Request body is larger than ${NATIVE_API_MAX_REQUEST_BODY_BYTES} bytes.`,
            413
          ),
          true
        )
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8').trim())
    })
    request.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })
}

async function readRequestJson(request) {
  const raw = await readRequestBody(request)
  if (!raw) {
    return {}
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new NativeApiRequestError('Request body must be valid JSON.', 400)
  }
}

function parseDownloadUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function isAppsDownloadDescriptorUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim())
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.pathname.endsWith('.json')
  } catch {
    return false
  }
}

function pickDescriptorSource(descriptor) {
  const sources = Array.isArray(descriptor?.sources) ? descriptor.sources : []
  for (const source of sources) {
    const status = String(source?.status || '')
    if (source?.type === 'internet-archive-parts' || /(pending|required|blocked|failed)/i.test(status)) {
      continue
    }
    const candidate = parseDownloadUrl(source?.url)
    if (candidate) {
      return candidate
    }
  }
  return parseDownloadUrl(descriptor?.url || descriptor?.downloadUrl || descriptor?.archiveUrl)
}

function descriptorPartsAreUsable(descriptor) {
  const sources = Array.isArray(descriptor?.sources) ? descriptor.sources : []
  return sources.some((source) => {
    if (source?.type !== 'internet-archive-parts') return false
    const status = String(source?.status || '')
    return status && !/(pending|required|blocked|failed)/i.test(status)
  })
}

function descriptorParts(descriptor) {
  if (!descriptorPartsAreUsable(descriptor)) {
    return []
  }
  const parts = Array.isArray(descriptor?.parts) ? descriptor.parts : []
  const normalized = []
  for (const part of parts) {
    const url = parseDownloadUrl(part?.url)
    const bytes = Number(part?.bytes)
    const offset = Number(part?.offset)
    const sha256 = String(part?.sha256 || '').trim().toLowerCase()
    if (!url || !Number.isSafeInteger(bytes) || bytes <= 0) {
      return []
    }
    normalized.push({
      index: Number.isSafeInteger(Number(part?.index)) ? Number(part.index) : normalized.length,
      url,
      bytes,
      encodedBytes: Number.isSafeInteger(Number(part?.encodedBytes)) ? Number(part.encodedBytes) : null,
      offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : null,
      sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null,
      encoding: part?.encoding || null,
      header: typeof part?.header === 'string' ? part.header : null,
    })
  }
  return normalized.sort((a, b) => a.index - b.index)
}

async function resolveDownloadDescriptor(rawUrl) {
  const descriptorUrl = parseDownloadUrl(rawUrl)
  if (!descriptorUrl || !isAppsDownloadDescriptorUrl(descriptorUrl)) {
    return { url: descriptorUrl, descriptorUrl: null, sha256: null, parts: [] }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(descriptorUrl, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': `RoachNet/${packageJson.version} descriptor-resolver`,
      },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while resolving ${descriptorUrl}`)
    }
    const descriptor = await response.json()
    const resolvedUrl = pickDescriptorSource(descriptor)
    if (!resolvedUrl) {
      const parts = descriptorParts(descriptor)
      if (parts.length === 0) {
        throw new Error(`Download descriptor has no usable HTTP source: ${descriptorUrl}`)
      }
    }
    const sha256 = String(descriptor.sha256 || '').trim().toLowerCase()
    const parts = descriptorParts(descriptor)
    return {
      url: parts.length > 0 ? descriptorUrl : resolvedUrl,
      descriptorUrl,
      sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null,
      filename: descriptor.filename || null,
      bytes: Number.isSafeInteger(Number(descriptor.bytes)) ? Number(descriptor.bytes) : null,
      parts,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function sendError(response, error, fallbackStatusCode = 500) {
  const statusCode = Number(error?.statusCode || fallbackStatusCode)
  sendJson(response, statusCode, { error: error instanceof Error ? error.message : String(error) })
}

function abortErrorMessage(error, label) {
  if (error?.name === 'AbortError') {
    return `${label} timed out after ${NATIVE_API_DOWNLOAD_TIMEOUT_MS}ms.`
  }

  const message = error?.message || String(error)
  return `${label} failed: ${message}`
}

function closeFileStream(file) {
  if (!file || file.closed || file.destroyed) {
    return
  }

  file.destroy()
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '')
}

function parseVersionParts(value) {
  return normalizeVersion(value)
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0
    const rightPart = rightParts[index] || 0
    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

function readJsonFile(candidates, fallback) {
  for (const candidate of candidates) {
    const target = path.isAbsolute(candidate) ? candidate : path.join(repoRoot, candidate)
    try {
      if (existsSync(target)) {
        return JSON.parse(readFileSync(target, 'utf8'))
      }
    } catch {}
  }

  return fallback
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 5_000)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': `RoachNet/${packageJson.version} native-api`,
        ...(options.headers || {}),
      },
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    if (!response.ok) {
      throw new Error(data.error || data.message || `${response.status} ${response.statusText}`)
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

function chooseReleaseForChannel(releases, channel) {
  if (!Array.isArray(releases)) return null
  if (channel === 'stable') {
    return releases.find((release) => !release.draft && !release.prerelease) || null
  }

  return (
    releases.find(
      (release) =>
        !release.draft &&
        (release.prerelease || String(release.tag_name || '').toLowerCase().includes(channel))
    ) ||
    releases.find((release) => !release.draft) ||
    null
  )
}

function selectInstallerAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  return (
    assets.find((asset) => /RoachNet-Setup-macOS\.dmg$/i.test(asset.name || '')) ||
    assets.find((asset) => /RoachNet.*mac.*\.(dmg|zip)$/i.test(asset.name || '')) ||
    null
  )
}

async function resolveLatestRelease({ force = false } = {}) {
  if (!force && latestReleaseCache && Date.now() - latestReleaseCache.cachedAt < 10 * 60 * 1000) {
    return latestReleaseCache.release
  }

  const channel = process.env.ROACHNET_RELEASE_CHANNEL?.trim() || 'stable'
  const releases = await fetchJson(githubReleasesApiUrl, {
    headers: { accept: 'application/vnd.github+json' },
    timeout: 12_000,
  })
  const release = chooseReleaseForChannel(releases, channel)
  if (!release) {
    throw new Error(`No ${channel} RoachNet release was found.`)
  }

  const asset = selectInstallerAsset(release)
  const resolved = {
    currentVersion: packageJson.version,
    latestVersion: normalizeVersion(release.tag_name || release.name || packageJson.version),
    name: release.name || release.tag_name || 'RoachNet release',
    pageUrl: release.html_url || githubReleasesUrl,
    assetName: asset?.name || null,
    assetUrl: asset?.browser_download_url || release.html_url || githubReleasesUrl,
  }
  latestReleaseCache = { cachedAt: Date.now(), release: resolved }
  return resolved
}

async function latestVersionResponse(force = false) {
  try {
    const release = await resolveLatestRelease({ force })
    const updateAvailable = compareVersions(release.latestVersion, packageJson.version) > 0
    return {
      success: true,
      updateAvailable,
      currentVersion: packageJson.version,
      latestVersion: release.latestVersion,
      message: updateAvailable
        ? `RoachNet ${release.latestVersion} is available.`
        : 'RoachNet is current.',
      releaseUrl: release.pageUrl,
      assetUrl: release.assetUrl,
    }
  } catch (error) {
    return {
      success: false,
      updateAvailable: false,
      currentVersion: packageJson.version,
      latestVersion: packageJson.version,
      message: `Update check failed: ${error.message}`,
    }
  }
}

async function isReachable(url) {
  try {
    await fetchJson(url, { timeout: 1_500 })
    return true
  } catch {
    return false
  }
}

function findExecutable(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null
}

async function ensureOllama() {
  if (await isReachable(new URL('/api/version', ollamaBaseUrl).toString())) {
    return
  }

  const localBin = process.env.ROACHNET_LOCAL_BIN_PATH || path.join(repoRoot, 'bin')
  const ollama = findExecutable([
    path.join(localBin, 'ollama'),
    '/opt/homebrew/bin/ollama',
    '/usr/local/bin/ollama',
  ])

  if (!ollama || ollamaProcess) {
    return
  }

  const parsed = new URL(ollamaBaseUrl)
  ollamaProcess = spawn(ollama, ['serve'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      OLLAMA_HOST: `${parsed.hostname}:${parsed.port || '11434'}`,
      OLLAMA_MODELS: process.env.OLLAMA_MODELS || path.join(storageRoot, 'models', 'ollama'),
    },
  })
  ollamaProcess.unref()
  await log(`started ollama pid=${ollamaProcess.pid}`)
}

async function providerStatus(provider, baseUrl) {
  const endpoint = provider === 'ollama' ? '/api/version' : '/health'
  const available = await isReachable(new URL(endpoint, baseUrl).toString())
  return {
    provider,
    available,
    source: available ? 'native-api' : 'configured',
    baseUrl,
    error: available ? null : `${provider} is not reachable yet.`,
  }
}

function systemInfo() {
  const cpus = os.cpus()
  const brand = cpus[0]?.model || 'Apple Silicon'
  const totalMemory = os.totalmem()
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64'
  const memoryGB = totalMemory / 1024 / 1024 / 1024
  const memoryTier = memoryGB >= 32 ? 'creator' : memoryGB >= 16 ? 'balanced' : 'compact'
  const recommendedModelClass = memoryGB >= 32 ? '14b' : memoryGB >= 16 ? '7b' : '1.5b'

  return {
    cpu: {
      manufacturer: isAppleSilicon ? 'Apple' : null,
      brand,
      physicalCores: Math.max(1, Math.round(cpus.length / 2)),
      cores: cpus.length,
    },
    mem: {
      total: totalMemory,
      available: os.freemem(),
      swapused: null,
    },
    os: {
      hostname: os.hostname(),
      arch: process.arch,
      distro: `${os.type()} ${os.release()}`,
    },
    hardwareProfile: {
      platformLabel: isAppleSilicon ? 'Apple Silicon Mac' : `${process.platform} ${process.arch}`,
      chipFamily: isAppleSilicon ? 'apple_silicon' : process.arch,
      isAppleSilicon,
      memoryTier,
      recommendedRuntime: 'native_local',
      recommendedModelClass,
      notes: ['Native API bridge is running without the Electron/WebUI admin runtime.'],
      warnings: isAppleSilicon ? [] : ['This release target is Apple Silicon macOS.'],
    },
  }
}

async function installedModels() {
  await ensureOllama()
  try {
    const tags = await fetchJson(new URL('/api/tags', ollamaBaseUrl).toString(), { timeout: 2_500 })
    return (tags.models || []).map((model) => ({
      name: model.name,
      size: model.size || null,
    }))
  } catch {
    return []
  }
}

async function roachClawStatus() {
  await ensureOllama()
  const [ollama, openclaw, models] = await Promise.all([
    providerStatus('ollama', ollamaBaseUrl),
    providerStatus('openclaw', openClawBaseUrl),
    installedModels(),
  ])
  const modelNames = models.map((model) => model.name)
  const workspacePath = process.env.OPENCLAW_WORKSPACE_PATH || path.join(storageRoot, 'RoachClaw')
  const resolvedDefaultModel = modelNames.includes(defaultModel) ? defaultModel : (modelNames[0] || defaultModel)
  const agent = roachClawNativeAgentStatus({
    storageRoot,
    defaultModel,
    resolvedDefaultModel,
  })

  return {
    label: 'RoachClaw Native',
    ollama,
    openclaw,
    agent,
    cliStatus: {
      openclawAvailable: openclaw.available,
      clawhubAvailable: false,
      workspacePath,
      runner: 'native-api',
    },
    workspacePath,
    defaultModel,
    resolvedDefaultModel,
    preferredMode: 'local',
    ready: ollama.available,
    installedModels: modelNames,
    preferredModels: ['qwen2.5-coder:1.5b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b'],
    configFilePath: null,
    portableProfile: null,
  }
}

function accountState() {
  return {
    linked: false,
    provider: 'local',
    portalUrl: 'https://roachnet.org/',
    accountId: null,
    email: null,
    displayName: null,
    status: 'local-only',
    settingsSyncEnabled: false,
    savedAppsSyncEnabled: false,
    hostedChatEnabled: false,
    aliasHost: process.env.ROACHNET_LOCAL_HOSTNAME || 'RoachNet',
    bridgeUrl: null,
    runtimeOrigin: null,
    linkedAt: null,
    lastSeenAt: null,
    lastUpdatedAt: null,
    notes: ['Native runtime is local-only unless the user arms online account metadata.'],
  }
}

function roachTailState() {
  return {
    enabled: false,
    networkName: 'RoachTail',
    deviceName: os.hostname(),
    deviceId: os.hostname(),
    status: 'local-only',
    transportMode: 'native-local',
    secureOverlay: true,
    relayHost: null,
    advertisedUrl: null,
    runtimeOrigin: null,
    runtimeTunnelUrl: null,
    joinCode: null,
    joinCodeExpiresAt: null,
    pairingPayload: null,
    pairingIssuedAt: null,
    lastUpdatedAt: null,
    notes: ['RoachTail is not armed in the dependency-free native bridge.'],
    peers: [],
  }
}

function roachSyncState() {
  return {
    enabled: false,
    provider: 'local',
    networkName: 'RoachSync',
    deviceName: os.hostname(),
    deviceId: os.hostname(),
    status: 'local-only',
    folderId: 'roachnet-storage',
    folderPath: storageRoot,
    guiUrl: null,
    apiUrl: null,
    transportMode: 'native-local',
    secureOverlay: true,
    notes: ['RoachSync is available when the user arms the companion lane.'],
    peers: [],
    lastUpdatedAt: null,
  }
}

const serviceCatalog = [
  {
    service_name: 'roachnet_kiwix_serve',
    friendly_name: 'RoachNet Library',
    description: 'Offline encyclopedias, field manuals, and reference archives staged inside RoachNet.',
    icon: 'IconBooks',
    powered_by: 'Kiwix',
    ui_location: '8090',
    display_order: 1,
  },
  {
    service_name: 'roachnet_kolibri',
    friendly_name: 'RoachNet Academy',
    description: 'Structured offline education content and coursework surfaced through RoachNet.',
    icon: 'IconSchool',
    powered_by: 'Kolibri',
    ui_location: '8300',
    display_order: 2,
  },
  {
    service_name: 'roachnet_ollama',
    friendly_name: 'RoachNet Chat',
    description: 'Local AI chat and model tooling managed from the RoachNet command grid.',
    icon: 'IconWand',
    powered_by: 'Ollama',
    ui_location: '/chat',
    display_order: 3,
  },
  {
    service_name: 'roachnet_roachsync',
    friendly_name: 'RoachSync',
    description: 'Private sync for the RoachNet vault, settings, and future shared installs.',
    icon: 'IconArrowsExchange',
    powered_by: 'Native companion bridge',
    ui_location: '8384',
    display_order: 4,
  },
  {
    service_name: 'roachnet_flatnotes',
    friendly_name: 'RoachNet Notes',
    description: 'Fast local notes for fragments, checklists, and working references on the same machine.',
    icon: 'IconNotes',
    powered_by: 'Flat file vault',
    ui_location: '/vault',
    display_order: 10,
  },
  {
    service_name: 'roachnet_cyberchef',
    friendly_name: 'RoachNet Data Lab',
    description: 'Encoding, decoding, and analysis tools adapted for RoachNet field workflows.',
    icon: 'IconChefHat',
    powered_by: 'Native utilities',
    ui_location: '/dev',
    display_order: 11,
  },
]

async function systemServices() {
  const ollama = await providerStatus('ollama', ollamaBaseUrl)
  return serviceCatalog.map((service) => {
    const isOllama = service.service_name === 'roachnet_ollama'
    const nativeInstalled = isOllama ? ollama.available : ['roachnet_flatnotes', 'roachnet_cyberchef'].includes(service.service_name)
    return {
      ...service,
      installed: nativeInstalled,
      installation_status: nativeInstalled ? 'installed' : 'idle',
      status: nativeInstalled ? 'running' : 'available',
    }
  })
}

function companionBootstrapState() {
  return {
    appName: 'RoachNet',
    machineName: os.hostname(),
    appsCatalogUrl: 'https://apps.roachnet.org/app-store-catalog.json',
    sessions: [],
    account: accountState(),
    runtime: {
      target: 'native-api',
      version: packageJson.version,
      storagePath: storageRoot,
    },
  }
}

async function companionRuntimeState() {
  const status = await roachClawStatus()
  return {
    providers: {
      ollama: status.ollama,
      openclaw: status.openclaw,
      roachclawNativeAgent: {
        available: true,
        base_url: null,
        native: true,
        runtime: status.agent.runtime,
      },
    },
    roachClaw: status,
    services: [],
    system: systemInfo(),
    benchmark: benchmarkStatus,
  }
}

function companionVaultState() {
  const vaultPath = path.join(storageRoot, 'Vault')
  return {
    vaultPath,
    knowledgeFiles: listFiles(vaultPath),
    roachBrain: [],
  }
}

function listFiles(root, limit = 80) {
  const out = []
  function walk(current) {
    if (out.length >= limit || !existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        out.push(path.relative(root, full))
      }
      if (out.length >= limit) return
    }
  }
  walk(root)
  return out
}

function mapCollections() {
  const manifest = readJsonFile([
    'collections/maps.json',
    'website-apps-dist/collections/maps.json',
  ], { collections: [] })
  const mapsRoot = path.join(storageRoot, 'maps', 'pmtiles')

  return (manifest.collections || []).map((collection) => {
    const resources = (collection.resources || []).map((resource) => ({
      id: resource.id,
      title: resource.title,
      size_mb: resource.size_mb ?? null,
      description: resource.description ?? null,
      url: resource.url ?? null,
      descriptorUrl: resource.url ? descriptorUrlForSource(resource.url, 'maps/pmtiles') : null,
    }))
    const installedCount = resources.filter((resource) => {
      const filename = resource.url ? fileNameForUrl(resource.url, `${resource.id}.pmtiles`) : `${resource.id}.pmtiles`
      return existsSync(path.join(mapsRoot, filename))
    }).length

    return {
      slug: collection.slug,
      name: collection.name,
      description: collection.description ?? null,
      installed_count: installedCount,
      total_count: resources.length,
      resources,
    }
  })
}

function educationCategories() {
  const manifest = readJsonFile([
    'collections/kiwix-categories.json',
    'website-apps-dist/collections/kiwix-categories.json',
  ], { categories: [] })
  const zimRoot = path.join(storageRoot, 'zim')

  return (manifest.categories || []).map((category) => ({
    slug: category.slug,
    name: category.name,
    description: category.description ?? null,
    installedTierSlug: installedTierSlug(category, zimRoot),
    tiers: (category.tiers || []).map((tier) => ({
      name: tier.name,
      slug: tier.slug,
      description: tier.description ?? null,
      recommended: Boolean(tier.recommended),
      resources: (tier.resources || []).map((resource) => ({
        id: resource.id,
        title: resource.title,
        size_mb: resource.size_mb ?? null,
        description: resource.description ?? null,
        url: resource.url ?? null,
        descriptorUrl: resource.url ? descriptorUrlForSource(resource.url, 'content/zim') : null,
      })),
    })),
  }))
}

function installedTierSlug(category, zimRoot) {
  for (const tier of category.tiers || []) {
    const hasInstalledResource = (tier.resources || []).some((resource) => {
      if (!resource.url) return false
      return existsSync(path.join(zimRoot, fileNameForUrl(resource.url, `${resource.id}.zim`)))
    })
    if (hasInstalledResource) return tier.slug
  }
  return null
}

function wikipediaOptions() {
  return readJsonFile([
    'collections/wikipedia.json',
    'website-apps-dist/collections/wikipedia.json',
  ], { options: [] }).options || []
}

function wikipediaSelectionPath() {
  return path.join(storageRoot, 'zim', 'wikipedia-selection.json')
}

function wikipediaState() {
  let currentSelection = null
  try {
    currentSelection = JSON.parse(readFileSync(wikipediaSelectionPath(), 'utf8'))
  } catch {}

  return {
    options: wikipediaOptions().map((option) => ({
      id: option.id,
      name: option.name,
      description: option.description ?? null,
      size_mb: option.size_mb ?? null,
      url: option.url ?? null,
      descriptorUrl: option.url ? descriptorUrlForSource(option.url, 'content/wikipedia') : null,
    })),
    currentSelection,
  }
}

function siteArchives() {
  const records = readJsonFile([
    path.join(storageRoot, 'site-archives', 'index.json'),
    'storage/site-archives/index.json',
    'admin/storage/site-archives/index.json',
  ], [])

  return (Array.isArray(records) ? records : []).map((archive) => ({
    slug: archive.slug,
    title: archive.title ?? archive.slug,
    url: archive.url ?? archive.sourceUrl ?? archive.entryUrl ?? null,
    createdAt: archive.createdAt ?? null,
  })).filter((archive) => archive.slug)
}

function safeFileName(value, fallback = 'download.bin') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 160)
  return cleaned || fallback
}

function fileNameForUrl(rawUrl, fallback) {
  try {
    const parsed = new URL(rawUrl)
    return safeFileName(path.basename(parsed.pathname), fallback)
  } catch {
    return fallback
  }
}

function descriptorUrlForSource(rawUrl, prefix) {
  try {
    const parsed = new URL(rawUrl)
    const basename = path.basename(parsed.pathname)
    if (!basename) return rawUrl
    const descriptorName = basename.replace(/\.[^/.]+$/i, '.json')
    return `${appsDownloadsBaseUrl.replace(/\/+$/, '')}/${prefix}/${descriptorName}`
  } catch {
    return rawUrl
  }
}

function queueDownload(rawUrl, destinationDirectory, filetype, options = {}) {
  const url = parseDownloadUrl(rawUrl)
  if (!url) return null
  mkdirSync(destinationDirectory, { recursive: true })
  const filename = safeFileName(options.filename || fileNameForUrl(url, `${randomUUID()}.${filetype || 'download'}`), `${randomUUID()}.${filetype || 'download'}`)
  const filepath = path.join(destinationDirectory, filename)
  const activeJob = downloadJobs.find((job) =>
    job.url === url &&
    job.filepath === filepath &&
    ['queued', 'downloading'].includes(job.status)
  )

  if (activeJob) {
    return activeJob
  }

  const job = {
    jobId: randomUUID(),
    url,
    progress: 0,
    filepath,
    partialFilepath: `${filepath}.part`,
    filetype,
    status: 'queued',
    failedReason: null,
    descriptorUrl: options.descriptorUrl || null,
    expectedSha256: options.expectedSha256 || null,
    parts: Array.isArray(options.parts) ? options.parts : [],
    totalBytes: null,
    bytesReceived: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    installPath: null,
    installStatus: null,
    afterDownload: options.afterDownload,
  }
  downloadJobs = [job, ...downloadJobs].slice(0, 200)
  downloadFile(job).catch((error) => {
    job.status = 'failed'
    job.failedReason = error.message
    job.progress = 0
    log(`download failed ${job.jobId}: ${error.message}`)
  })
  return job
}

async function queueResolvedDownload(rawUrl, destinationDirectory, filetype, options = {}) {
  const resolvedDownload = await resolveDownloadDescriptor(rawUrl)
  if (!resolvedDownload.url) return null
  return queueDownload(resolvedDownload.url, destinationDirectory, filetype, {
    ...options,
    descriptorUrl: resolvedDownload.descriptorUrl,
    expectedSha256: resolvedDownload.sha256,
    filename: resolvedDownload.filename,
    parts: resolvedDownload.parts,
  })
}

function mirrorDownloadJobToUpdateStatus(job, release) {
  const timer = setInterval(() => {
    if (job.status === 'completed') {
      systemUpdateStatus = updateStatus(
        'ready',
        100,
        `Installer downloaded to ${job.filepath}. Run RoachNet Setup over the existing install.`
      )
      clearInterval(timer)
      if (process.platform === 'darwin' && process.env.ROACHNET_OPEN_UPDATES !== '0') {
        spawn('open', [job.filepath], { detached: true, stdio: 'ignore' }).unref()
      }
      return
    }

    if (job.status === 'failed') {
      systemUpdateStatus = updateStatus('error', 0, job.failedReason || 'Update download failed.')
      clearInterval(timer)
      return
    }

    systemUpdateStatus = updateStatus(
      'downloading',
      job.progress,
      `Downloading ${release.name || release.latestVersion}.`
    )
  }, 750)
}

function modelPacksRootPath() {
  return path.join(storageRoot, 'RoachSpeech', 'ModelPacks')
}

function readRoachSpeechPackRegistry() {
  return readJsonFile([path.join(modelPacksRootPath(), 'pending-packs.json')], [])
}

function writeRoachSpeechPackRegistry(nextRegistry) {
  const registryPath = path.join(modelPacksRootPath(), 'pending-packs.json')
  mkdirSync(path.dirname(registryPath), { recursive: true })
  writeFileSync(registryPath, JSON.stringify(nextRegistry, null, 2))
}

function upsertRoachSpeechPackRegistry(entry) {
  const registry = readRoachSpeechPackRegistry()
  const nextRegistry = [
    {
      ...entry,
      updatedAt: new Date().toISOString(),
    },
    ...(Array.isArray(registry) ? registry.filter((item) => item.packID !== entry.packID) : []),
  ].slice(0, 50)
  writeRoachSpeechPackRegistry(nextRegistry)
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function runQuiet(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: options.stdio || 'pipe',
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr}` : ''}`))
      }
    })
  })
}

function findRoachSpeechPackRoot(candidateRoot, depth = 0) {
  const manifestPath = path.join(candidateRoot, 'RoachSpeechPack.json')
  if (existsSync(manifestPath)) {
    return candidateRoot
  }

  if (depth >= 4) {
    return null
  }

  let entries = []
  try {
    entries = readdirSync(candidateRoot, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }
    const found = findRoachSpeechPackRoot(path.join(candidateRoot, entry.name), depth + 1)
    if (found) {
      return found
    }
  }
  return null
}

function validateRoachSpeechPackRoot(packRoot, expectedPackID, expectedKind) {
  const manifestPath = path.join(packRoot, 'RoachSpeechPack.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.packID !== expectedPackID) {
    throw new Error(`RoachSpeech pack mismatch. Expected ${expectedPackID}, found ${manifest.packID || 'missing'}.`)
  }
  if (expectedKind && manifest.kind !== expectedKind) {
    throw new Error(`RoachSpeech pack kind mismatch. Expected ${expectedKind}, found ${manifest.kind || 'missing'}.`)
  }
  if (manifest.noPackagedBinary !== true || manifest.nativeFormat !== 'coreML') {
    throw new Error(`${expectedPackID} is not a native Core ML RoachSpeech pack.`)
  }
  return manifest
}

async function installRoachSpeechPackArchive(job, packID, kind) {
  const packsRoot = modelPacksRootPath()
  mkdirSync(packsRoot, { recursive: true })
  const extractRoot = mkdtempSync(path.join(packsRoot, `.extract-${packID}-`))
  const finalRoot = path.join(packsRoot, packID)
  const stagingRoot = path.join(packsRoot, `.staging-${packID}-${randomUUID()}`)
  const backupRoot = path.join(packsRoot, `.backup-${packID}-${randomUUID()}`)

  try {
    if (!statSync(job.filepath).isFile()) {
      throw new Error(`Downloaded RoachSpeech pack is not a file: ${job.filepath}`)
    }
    await runQuiet('ditto', ['-x', '-k', job.filepath, extractRoot])
    const packRoot = findRoachSpeechPackRoot(extractRoot)
    if (!packRoot) {
      throw new Error('Downloaded archive did not contain a RoachSpeechPack.json manifest.')
    }

    validateRoachSpeechPackRoot(packRoot, packID, kind)
    renameSync(packRoot, stagingRoot)
    if (existsSync(finalRoot)) {
      renameSync(finalRoot, backupRoot)
    }
    renameSync(stagingRoot, finalRoot)
    rmSync(backupRoot, { recursive: true, force: true })
    job.installPath = finalRoot
    job.installStatus = 'installed'
    upsertRoachSpeechPackRegistry({
      packID,
      kind,
      url: job.url,
      status: 'installed',
      filepath: job.filepath,
      installPath: finalRoot,
    })
  } catch (error) {
    if (existsSync(backupRoot) && !existsSync(finalRoot)) {
      renameSync(backupRoot, finalRoot)
    }
    job.installStatus = 'failed'
    upsertRoachSpeechPackRegistry({
      packID,
      kind,
      url: job.url,
      status: 'failed',
      filepath: job.filepath,
      installPath: existsSync(finalRoot) ? finalRoot : null,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    rmSync(extractRoot, { recursive: true, force: true })
    rmSync(stagingRoot, { recursive: true, force: true })
    rmSync(backupRoot, { recursive: true, force: true })
  }
}

async function requestUpdateDownload(force = false) {
  systemUpdateStatus = updateStatus('checking', 5, 'Checking RoachNet releases.')
  const release = await resolveLatestRelease({ force })
  const updateAvailable = compareVersions(release.latestVersion, packageJson.version) > 0

  if (!updateAvailable) {
    systemUpdateStatus = updateStatus('idle', 100, 'RoachNet is current.')
    return {
      success: true,
      message: 'RoachNet is current.',
      note: release.pageUrl,
    }
  }

  if (!release.assetUrl || !/^https?:\/\//i.test(release.assetUrl)) {
    systemUpdateStatus = updateStatus('error', 0, 'No downloadable installer asset was found.')
    return {
      success: false,
      error: 'No downloadable installer asset was found.',
      note: release.pageUrl,
    }
  }

  const job = queueDownload(release.assetUrl, path.join(storageRoot, 'updates'), 'dmg')
  if (!job) {
    systemUpdateStatus = updateStatus('error', 0, 'Update download could not be queued.')
    return { success: false, error: 'Update download could not be queued.' }
  }

  systemUpdateStatus = updateStatus('downloading', 1, `Downloading ${release.name || release.latestVersion}.`)
  mirrorDownloadJobToUpdateStatus(job, release)
  return {
    success: true,
    message: `RoachNet ${release.latestVersion} installer download queued.`,
    note: job.filepath,
  }
}

async function writeDownloadChunk(file, chunk) {
  if (!file.write(Buffer.from(chunk))) {
    await once(file, 'drain')
  }
}

function decodeChunkPayload(part, body) {
  if (part.encoding !== 'roachnet-ia-chunk-v1') {
    return body
  }

  const header = Buffer.from(part.header || '', 'utf8')
  if (header.length === 0 || body.length < header.length || !body.subarray(0, header.length).equals(header)) {
    throw new Error(`Chunk ${part.index + 1} did not contain the expected RoachNet IA envelope.`)
  }
  return body.subarray(header.length)
}

async function downloadChunkedFile(job, file, controller) {
  const total = job.parts.reduce((sum, part) => sum + Number(part.bytes || 0), 0)
  job.totalBytes = total > 0 ? total : null
  if (total > NATIVE_API_MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download is larger than the configured ${NATIVE_API_MAX_DOWNLOAD_BYTES} byte limit.`)
  }

  let received = 0
  for (const part of job.parts) {
    const expectedTransferBytes = part.encodedBytes || part.bytes
    const response = await fetch(part.url, {
      signal: controller.signal,
      headers: { 'user-agent': `RoachNet/${packageJson.version} native-downloader chunked` },
    })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} while downloading ${part.url}`)
    }

    const partContentLength = Number(response.headers.get('content-length') || 0)
    if (partContentLength > 0 && partContentLength !== expectedTransferBytes) {
      throw new Error(`Chunk ${part.index + 1} reported ${partContentLength} bytes, expected ${expectedTransferBytes}.`)
    }

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length !== expectedTransferBytes) {
      throw new Error(`Chunk ${part.index + 1} ended early after ${body.length} of ${expectedTransferBytes} bytes.`)
    }

    const payload = decodeChunkPayload(part, body)
    if (payload.length !== part.bytes) {
      throw new Error(`Chunk ${part.index + 1} decoded to ${payload.length} bytes, expected ${part.bytes}.`)
    }

    const actualPartSha256 = createHash('sha256').update(payload).digest('hex')
    if (part.sha256 && actualPartSha256 !== part.sha256) {
      throw new Error(`Chunk checksum mismatch for ${part.url}. Expected ${part.sha256}, found ${actualPartSha256}.`)
    }
    received += payload.length
    job.bytesReceived = received
    job.updatedAt = new Date().toISOString()
    if (received > NATIVE_API_MAX_DOWNLOAD_BYTES) {
      throw new Error(`Download exceeded the configured ${NATIVE_API_MAX_DOWNLOAD_BYTES} byte limit.`)
    }
    if (job.totalBytes) {
      job.progress = Math.max(1, Math.min(99, Math.round((received / job.totalBytes) * 100)))
    }
    await writeDownloadChunk(file, payload)
  }

  if (job.totalBytes && received !== job.totalBytes) {
    throw new Error(`Chunked download ended early after ${received} of ${job.totalBytes} bytes.`)
  }
}

async function downloadFile(job) {
  job.status = 'downloading'
  const controller = new AbortController()
  job.abort = () => controller.abort()
  const timeout = setTimeout(() => controller.abort(), NATIVE_API_DOWNLOAD_TIMEOUT_MS)
  let file = null

  try {
    rmSync(job.partialFilepath, { force: true })
    job.updatedAt = new Date().toISOString()
    file = createWriteStream(job.partialFilepath)

    if (Array.isArray(job.parts) && job.parts.length > 0) {
      await downloadChunkedFile(job, file, controller)
    } else {
      const response = await fetch(job.url, {
        signal: controller.signal,
        headers: { 'user-agent': `RoachNet/${packageJson.version} native-downloader` },
      })
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} while downloading ${job.url}`)
      }

      const total = Number(response.headers.get('content-length') || 0)
      job.totalBytes = total > 0 ? total : null
      if (total > NATIVE_API_MAX_DOWNLOAD_BYTES) {
        throw new Error(`Download is larger than the configured ${NATIVE_API_MAX_DOWNLOAD_BYTES} byte limit.`)
      }

      const reader = response.body.getReader()
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        job.bytesReceived = received
        job.updatedAt = new Date().toISOString()
        if (received > NATIVE_API_MAX_DOWNLOAD_BYTES) {
          throw new Error(`Download exceeded the configured ${NATIVE_API_MAX_DOWNLOAD_BYTES} byte limit.`)
        }
        if (total > 0) {
          job.progress = Math.max(1, Math.min(99, Math.round((received / total) * 100)))
        }
        await writeDownloadChunk(file, value)
      }
      if (total > 0 && received !== total) {
        throw new Error(`Download ended early after ${received} of ${total} bytes.`)
      }
    }
    file.end()
    await once(file, 'finish')
    renameSync(job.partialFilepath, job.filepath)
    if (job.expectedSha256) {
      const actualSha256 = await sha256File(job.filepath)
      if (actualSha256 !== job.expectedSha256) {
        throw new Error(`Checksum mismatch for ${job.url}. Expected ${job.expectedSha256}, found ${actualSha256}.`)
      }
      job.sha256 = actualSha256
    }
    if (typeof job.afterDownload === 'function') {
      job.status = 'installing'
      job.installStatus = 'installing'
      job.progress = 99
      job.updatedAt = new Date().toISOString()
      await job.afterDownload(job)
    }
    job.progress = 100
    job.status = 'completed'
    job.installStatus = job.installStatus || 'downloaded'
    job.completedAt = new Date().toISOString()
    job.updatedAt = job.completedAt
  } catch (error) {
    const wasCancelled = job.status === 'cancelled'
    closeFileStream(file)
    rmSync(job.partialFilepath, { force: true })
    rmSync(job.filepath, { force: true })
    job.updatedAt = new Date().toISOString()
    if (wasCancelled) {
      job.progress = 0
      job.completedAt = job.updatedAt
      return
    }
    throw new Error(abortErrorMessage(error, `Download from ${job.url}`))
  } finally {
    clearTimeout(timeout)
    delete job.abort
  }
}

function resourcesForMapCollection(slug) {
  const collection = mapCollections().find((item) => item.slug === slug)
  return collection?.resources || []
}

function resourcesForEducationTier(categorySlug, tierSlug) {
  const category = educationCategories().find((item) => item.slug === categorySlug)
  const tier = category?.tiers?.find((item) => item.slug === tierSlug)
  return tier?.resources || []
}

function resourcesForEducationResource(categorySlug, resourceId) {
  const category = educationCategories().find((item) => item.slug === categorySlug)
  return (category?.tiers || [])
    .flatMap((tier) => tier.resources || [])
    .filter((resource) => resource.id === resourceId)
}

async function queueRoachSpeechPackDownload(body) {
  const packID = safeFileName(body.packID || body.pack || 'roachspeech-pack', 'roachspeech-pack')
  const kind = safeFileName(body.kind || 'roachVoice', 'roachVoice')
  const destination = path.join(storageRoot, 'RoachSpeech', 'ModelPacks', '.downloads', kind, packID)
  const job = await queueResolvedDownload(body.url, destination, 'roachspeech-pack', {
    afterDownload: (downloadJob) => installRoachSpeechPackArchive(downloadJob, packID, kind),
  })
  upsertRoachSpeechPackRegistry({
    packID,
    kind,
    url: job?.url || body.url,
    descriptorUrl: job?.descriptorUrl || null,
    expectedSha256: job?.expectedSha256 || null,
    status: job ? 'queued' : 'idle',
    filepath: job?.filepath || null,
    installPath: job?.installPath || null,
  })
  return { job, packID, kind }
}

function appStoreInstallResponse(action, jobs, message, extra = {}) {
  const normalizedJobs = Array.isArray(jobs) ? jobs.filter(Boolean) : [jobs].filter(Boolean)
  return {
    success: normalizedJobs.length > 0 || extra.success === true,
    ok: normalizedJobs.length > 0 || extra.success === true,
    action,
    message,
    jobId: normalizedJobs[0]?.jobId || null,
    jobIds: normalizedJobs.map((job) => job.jobId),
    queued: normalizedJobs.length,
    ...extra,
  }
}

async function handleCompanionInstall(body) {
  const action = String(body.action || body.type || '').trim()
  if (!action) {
    throw new NativeApiRequestError('App Store install action is missing.', 400)
  }

  switch (action) {
  case 'base-map-assets':
    mkdirSync(path.join(storageRoot, 'maps', 'pmtiles'), { recursive: true })
    mkdirSync(path.join(storageRoot, 'maps', 'basemaps-assets'), { recursive: true })
    return appStoreInstallResponse(action, [], 'Base atlas folders are ready.', { success: true })

  case 'map-collection': {
    const slug = String(body.slug || '').trim()
    if (!slug) throw new NativeApiRequestError('Map collection slug is missing.', 400)
    const jobs = (await Promise.all(resourcesForMapCollection(slug).map((resource) =>
      queueResolvedDownload(resource.descriptorUrl || resource.url, path.join(storageRoot, 'maps', 'pmtiles'), 'pmtiles')
    ))).filter(Boolean)
    return appStoreInstallResponse(action, jobs, `${jobs.length} map download${jobs.length === 1 ? '' : 's'} queued.`, { slug })
  }

  case 'education-tier': {
    const categorySlug = String(body.categorySlug || body.category || '').trim()
    const tierSlug = String(body.tierSlug || body.tier || '').trim()
    if (!categorySlug || !tierSlug) {
      throw new NativeApiRequestError('Education tier install needs category and tier.', 400)
    }
    const jobs = (await Promise.all(resourcesForEducationTier(categorySlug, tierSlug).map((resource) =>
      queueResolvedDownload(resource.descriptorUrl || resource.url, path.join(storageRoot, 'zim'), 'zim')
    ))).filter(Boolean)
    return appStoreInstallResponse(action, jobs, `${jobs.length} knowledge download${jobs.length === 1 ? '' : 's'} queued.`, {
      categorySlug,
      tierSlug,
    })
  }

  case 'education-resource': {
    const categorySlug = String(body.categorySlug || body.category || '').trim()
    const resourceId = String(body.resourceId || body.resource || '').trim()
    if (!categorySlug || !resourceId) {
      throw new NativeApiRequestError('Education resource install needs category and resource.', 400)
    }
    const jobs = (await Promise.all(resourcesForEducationResource(categorySlug, resourceId).map((resource) =>
      queueResolvedDownload(resource.descriptorUrl || resource.url, path.join(storageRoot, 'zim'), 'zim')
    ))).filter(Boolean)
    return appStoreInstallResponse(action, jobs, `${jobs.length} knowledge download${jobs.length === 1 ? '' : 's'} queued.`, {
      categorySlug,
      resourceId,
    })
  }

  case 'direct-download': {
    const rawUrl = body.url || body.mirrorUrl || body.sourceUrl
    const filetype = String(body.filetype || body.resourceType || '').toLowerCase()
    if (!rawUrl) throw new NativeApiRequestError('Direct App Store download URL is missing.', 400)
    if (['map', 'pmtiles'].includes(filetype)) {
      const job = await queueResolvedDownload(rawUrl, path.join(storageRoot, 'maps', 'pmtiles'), 'pmtiles')
      return appStoreInstallResponse(action, job, job ? 'Map download queued.' : 'No map URL provided.', { filetype })
    }
    if (['zim', 'knowledge', 'education'].includes(filetype)) {
      const job = await queueResolvedDownload(rawUrl, path.join(storageRoot, 'zim'), 'zim')
      return appStoreInstallResponse(action, job, job ? 'Knowledge pack queued.' : 'No ZIM URL provided.', { filetype })
    }
    throw new NativeApiRequestError(`Unsupported direct App Store download type: ${filetype || 'unknown'}.`, 400)
  }

  case 'wikipedia-option': {
    const optionId = String(body.optionId || body.option || '').trim()
    const option = wikipediaOptions().find((item) => item.id === optionId)
    mkdirSync(path.join(storageRoot, 'zim'), { recursive: true })
    if (!option || option.id === 'none' || !option.url) {
      writeFileSync(wikipediaSelectionPath(), JSON.stringify({ optionId: optionId || 'none', status: 'skipped', filename: null, url: null }, null, 2))
      return appStoreInstallResponse(action, [], 'Wikipedia install skipped.', { success: true, optionId: optionId || 'none' })
    }
    const descriptorUrl = option.url ? descriptorUrlForSource(option.url, 'content/wikipedia') : null
    const job = await queueResolvedDownload(descriptorUrl || option.url, path.join(storageRoot, 'zim'), 'zim')
    const selection = {
      optionId: option.id,
      status: job ? 'queued' : 'idle',
      filename: option.url ? fileNameForUrl(option.url, `${option.id}.zim`) : null,
      url: option.url,
      descriptorUrl,
    }
    writeFileSync(wikipediaSelectionPath(), JSON.stringify(selection, null, 2))
    return appStoreInstallResponse(action, job, `${option.name} queued.`, { optionId: option.id })
  }

  case 'roachclaw-model': {
    const model = String(body.model || '').trim()
    if (!model) throw new NativeApiRequestError('RoachClaw model name is missing.', 400)
    await pullModel(model)
    return appStoreInstallResponse(action, [], `${model} model pull queued.`, { success: true, model })
  }

  case 'roachspeech-pack':
  case 'roachvoice-pack': {
    if (!body.url) throw new NativeApiRequestError('RoachSpeech pack URL is missing.', 400)
    const { job, packID, kind } = await queueRoachSpeechPackDownload(body)
    return appStoreInstallResponse(
      action,
      job,
      job
        ? `${packID} RoachSpeech pack queued. It will unpack into the local model shelf when the download finishes.`
        : 'No RoachSpeech pack URL provided.',
      { packID, kind }
    )
  }

  default:
    throw new NativeApiRequestError(`Unsupported App Store install action: ${action}.`, 400)
  }
}

async function handleChat(body) {
  await ensureOllama()
  try {
    return await fetchJson(new URL('/api/chat', ollamaBaseUrl).toString(), {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 120_000,
    })
  } catch (error) {
    return {
      message: {
        role: 'assistant',
        content: `Local model route is not ready: ${error.message}`,
      },
    }
  }
}

async function pullModel(model) {
  await ensureOllama()
  if (!model) return
  fetchJson(new URL('/api/pull', ollamaBaseUrl).toString(), {
    method: 'POST',
    body: JSON.stringify({ name: model, stream: false }),
    timeout: 600_000,
  }).catch((error) => log(`model pull failed: ${error.message}`))
}

async function route(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1')
  const method = request.method || 'GET'
  const pathname = url.pathname

  if (method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { status: 'ok' })
  if (method === 'GET' && pathname === '/api/system/internet-status') {
    const online = await lookup('github.com').then(() => true).catch(() => false)
    return sendJson(response, 200, online)
  }
  if (method === 'GET' && pathname === '/api/system/info') return sendJson(response, 200, systemInfo())
  if (method === 'GET' && pathname === '/api/system/services') return sendJson(response, 200, await systemServices())
  if (method === 'GET' && pathname === '/api/system/ai/providers') {
    const providers = {
      ollama: await providerStatus('ollama', ollamaBaseUrl),
      openclaw: await providerStatus('openclaw', openClawBaseUrl),
    }
    return sendJson(response, 200, { providers })
  }
  if (method === 'GET' && pathname === '/api/system/latest-version') {
    return sendJson(response, 200, await latestVersionResponse(url.searchParams.get('force') === '1'))
  }
  if (method === 'GET' && pathname === '/api/system/update/status') {
    return sendJson(response, 200, systemUpdateStatus)
  }
  if (method === 'POST' && pathname === '/api/system/update') {
    return sendJson(response, 202, await requestUpdateDownload(true))
  }
  if (method === 'GET' && pathname === '/api/roachclaw/status') return sendJson(response, 200, await roachClawStatus())
  if (method === 'GET' && pathname === '/api/roachclaw/agent/status') {
    const status = await roachClawStatus()
    return sendJson(response, 200, status.agent)
  }
  if (method === 'POST' && pathname === '/api/roachclaw/agent/run') {
    const status = await roachClawStatus()
    return sendJson(response, 200, createRoachClawAgentRun(await readRequestJson(request), status.agent))
  }
  if (method === 'POST' && pathname === '/api/roachclaw/apply') {
    const body = await readRequestJson(request)
    pullModel(body.model || defaultModel)
    return sendJson(response, 200, { success: true, ok: true, message: 'Local model pull queued.' })
  }
  if (method === 'POST' && pathname === '/api/system/services/install') {
    const body = await readRequestJson(request)
    if (body.service_name === 'roachnet_ollama') {
      await ensureOllama()
      return sendJson(response, 200, { success: true, ok: true, message: 'Ollama start requested.' })
    }
    return sendJson(response, 200, { success: true, ok: true, message: 'Native service registered. Container install is not required for this lane.' })
  }
  if (method === 'POST' && pathname === '/api/system/services/affect') {
    const body = await readRequestJson(request)
    if (body.service_name === 'roachnet_ollama' && body.action === 'start') {
      await ensureOllama()
    }
    return sendJson(response, 200, { success: true, ok: true, message: `${body.action || 'Service'} request recorded.` })
  }
  if (method === 'GET' && pathname === '/api/ollama/installed-models') return sendJson(response, 200, await installedModels())
  if (method === 'POST' && pathname === '/api/ollama/chat') return sendJson(response, 200, await handleChat(await readRequestJson(request)))
  if (method === 'GET' && pathname === '/api/openclaw/skills/installed') {
    return sendJson(response, 200, { workspacePath: process.env.OPENCLAW_WORKSPACE_PATH || path.join(storageRoot, 'RoachClaw'), skills: [] })
  }
  if (method === 'GET' && pathname === '/api/rag/files') {
    return sendJson(response, 200, { files: listFiles(path.join(storageRoot, 'Vault')) })
  }
  if (method === 'GET' && pathname === '/api/maps/curated-collections') return sendJson(response, 200, mapCollections())
  if (method === 'POST' && pathname === '/api/maps/download-base-assets') {
    mkdirSync(path.join(storageRoot, 'maps', 'pmtiles'), { recursive: true })
    mkdirSync(path.join(storageRoot, 'maps', 'basemaps-assets'), { recursive: true })
    return sendJson(response, 200, { success: true, ok: true, message: 'Base atlas folders are ready.' })
  }
  if (method === 'POST' && pathname === '/api/maps/download-collection') {
    const body = await readRequestJson(request)
    const jobs = (await Promise.all(resourcesForMapCollection(body.slug).map((resource) =>
      queueResolvedDownload(resource.descriptorUrl || resource.url, path.join(storageRoot, 'maps', 'pmtiles'), 'pmtiles')
    ))).filter(Boolean)
    return sendJson(response, 200, { success: true, ok: true, message: `${jobs.length} map download${jobs.length === 1 ? '' : 's'} queued.` })
  }
  if (method === 'POST' && pathname === '/api/maps/download-remote') {
    const body = await readRequestJson(request)
    const job = await queueResolvedDownload(body.url, path.join(storageRoot, 'maps', 'pmtiles'), 'pmtiles')
    return sendJson(response, 200, { success: Boolean(job), ok: Boolean(job), message: job ? 'Remote map download queued.' : 'No map URL provided.' })
  }
  if (method === 'GET' && pathname === '/api/zim/curated-categories') return sendJson(response, 200, educationCategories())
  if (method === 'GET' && pathname === '/api/zim/wikipedia') return sendJson(response, 200, wikipediaState())
  if (method === 'POST' && pathname === '/api/zim/download-category-tier') {
    const body = await readRequestJson(request)
    const jobs = (await Promise.all(resourcesForEducationTier(body.categorySlug, body.tierSlug).map((resource) =>
      queueResolvedDownload(resource.descriptorUrl || resource.url, path.join(storageRoot, 'zim'), 'zim')
    ))).filter(Boolean)
    return sendJson(response, 200, { success: true, ok: true, message: `${jobs.length} knowledge download${jobs.length === 1 ? '' : 's'} queued.` })
  }
  if (method === 'POST' && pathname === '/api/zim/download-category-resource') {
    const body = await readRequestJson(request)
    const jobs = (await Promise.all(resourcesForEducationResource(body.categorySlug, body.resourceId).map((resource) =>
      queueResolvedDownload(resource.descriptorUrl || resource.url, path.join(storageRoot, 'zim'), 'zim')
    ))).filter(Boolean)
    return sendJson(response, 200, { success: true, ok: true, message: `${jobs.length} knowledge download${jobs.length === 1 ? '' : 's'} queued.` })
  }
  if (method === 'POST' && pathname === '/api/zim/download-remote') {
    const body = await readRequestJson(request)
    const job = await queueResolvedDownload(body.url, path.join(storageRoot, 'zim'), 'zim')
    return sendJson(response, 200, { success: Boolean(job), ok: Boolean(job), message: job ? 'Remote knowledge pack queued.' : 'No ZIM URL provided.' })
  }
  if (method === 'POST' && pathname === '/api/zim/wikipedia/select') {
    const body = await readRequestJson(request)
    const option = wikipediaOptions().find((item) => item.id === body.optionId)
    mkdirSync(path.join(storageRoot, 'zim'), { recursive: true })
    if (!option || option.id === 'none' || !option.url) {
      writeFileSync(wikipediaSelectionPath(), JSON.stringify({ optionId: body.optionId || 'none', status: 'skipped', filename: null, url: null }, null, 2))
      return sendJson(response, 200, { success: true, ok: true, message: 'Wikipedia install skipped.' })
    }
    const descriptorUrl = option.url ? descriptorUrlForSource(option.url, 'content/wikipedia') : null
    const job = await queueResolvedDownload(descriptorUrl || option.url, path.join(storageRoot, 'zim'), 'zim')
    const selection = {
      optionId: option.id,
      status: job ? 'queued' : 'idle',
      filename: option.url ? fileNameForUrl(option.url, `${option.id}.zim`) : null,
      url: option.url,
      descriptorUrl,
    }
    writeFileSync(wikipediaSelectionPath(), JSON.stringify(selection, null, 2))
    return sendJson(response, 200, { success: true, ok: true, message: `${option.name} queued.` })
  }
  if (method === 'POST' && pathname === '/api/roachspeech/model-packs/download') {
    const body = await readRequestJson(request)
    const { job, packID, kind } = await queueRoachSpeechPackDownload(body)
    return sendJson(response, 200, {
      success: Boolean(job),
      ok: Boolean(job),
      message: job
        ? `${packID} RoachSpeech pack queued. It will unpack into the local model shelf when the download finishes.`
        : 'No RoachSpeech pack URL provided.',
      packID,
      kind,
      jobId: job?.jobId || null,
    })
  }
  if (method === 'GET' && pathname === '/api/roachspeech/model-packs') {
    const packsRoot = modelPacksRootPath()
    const entries = existsSync(packsRoot)
      ? readdirSync(packsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .map((entry) => {
            const root = path.join(packsRoot, entry.name)
            const manifestPath = path.join(root, 'RoachSpeechPack.json')
            const manifest = readJsonFile([manifestPath], null)
            return {
              packID: entry.name,
              root,
              installed: Boolean(manifest),
              manifest,
            }
          })
      : []
    return sendJson(response, 200, {
      success: true,
      ok: true,
      modelPacksRoot: packsRoot,
      packs: entries,
      registry: readRoachSpeechPackRegistry(),
    })
  }
  if (method === 'GET' && pathname === '/api/site-archives') return sendJson(response, 200, { archives: siteArchives() })
  if (method === 'GET' && pathname === '/api/companion/bootstrap') return sendJson(response, 200, companionBootstrapState())
  if (method === 'GET' && pathname === '/api/companion/runtime') return sendJson(response, 200, await companionRuntimeState())
  if (method === 'GET' && pathname === '/api/companion/vault') return sendJson(response, 200, companionVaultState())
  if (method === 'GET' && pathname === '/api/companion/account') return sendJson(response, 200, accountState())
  if (method === 'GET' && pathname === '/api/companion/roachtail') return sendJson(response, 200, roachTailState())
  if (method === 'GET' && pathname === '/api/companion/roachsync') return sendJson(response, 200, roachSyncState())
  if (method === 'POST' && pathname === '/api/companion/install') {
    return sendJson(response, 200, await handleCompanionInstall(await readRequestJson(request)))
  }
  if (method === 'POST' && pathname.startsWith('/api/companion/')) return sendJson(response, 200, { success: true, ok: true, message: 'Native companion action recorded.' })
  if (method === 'DELETE' && pathname.startsWith('/api/downloads/jobs/')) {
    const jobId = decodeURIComponent(pathname.split('/').at(-1) || '')
    const job = downloadJobs.find((item) => item.jobId === jobId)
    if (job && ['queued', 'downloading'].includes(job.status)) {
      job.status = 'cancelled'
      job.failedReason = null
      job.updatedAt = new Date().toISOString()
      if (typeof job.abort === 'function') {
        job.abort()
      }
      rmSync(job.partialFilepath, { force: true })
    }
    downloadJobs = downloadJobs.filter((job) => job.jobId !== jobId)
    return sendJson(response, 200, { success: true, ok: true, cancelled: Boolean(job) })
  }
  if (method === 'GET' && pathname === '/api/downloads/jobs') return sendJson(response, 200, downloadJobs)
  if (method === 'GET' && pathname === '/api/benchmark/status') return sendJson(response, 200, benchmarkStatus)
  if (method === 'POST' && pathname === '/api/benchmark/run') {
    const body = await readRequestJson(request)
    benchmarkStatus = { status: 'starting', benchmarkId: randomUUID() }
    setTimeout(() => {
      benchmarkStatus = { status: 'idle', benchmarkId: null }
    }, 2_000)
    return sendJson(response, 201, {
      success: true,
      job_id: benchmarkStatus.benchmarkId,
      benchmark_id: benchmarkStatus.benchmarkId,
      message: `${body.benchmark_type || 'system'} benchmark started`,
    })
  }

  return sendJson(response, 404, { error: `No native endpoint for ${method} ${pathname}` })
}

function wantsCompanionRuntime() {
  const mode = process.env.ROACHNET_COMPANION_ENABLED?.trim()
  if (mode) {
    return !['0', 'false', 'no', 'off'].includes(mode.toLowerCase())
  }
  return Boolean(process.env.ROACHNET_COMPANION_TOKEN?.trim())
}

function companionLocalUrl() {
  if (!wantsCompanionRuntime()) {
    return null
  }
  const host = process.env.ROACHNET_COMPANION_HOST?.trim() || '127.0.0.1'
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  const port = process.env.ROACHNET_COMPANION_PORT?.trim() || '38111'
  return `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`
}

async function waitForCompanion(localUrl, timeoutMs = 15_000) {
  if (!localUrl) {
    return false
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', localUrl), { headers: { Accept: 'application/json' } })
      if (response.ok) {
        return true
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function maybeStartCompanion(baseUrl) {
  if (!wantsCompanionRuntime()) {
    return { localUrl: null, advertisedUrl: null, pid: null }
  }

  const token = process.env.ROACHNET_COMPANION_TOKEN?.trim()
  if (!token) {
    await log('companion requested without token; skipping companion bridge')
    return { localUrl: null, advertisedUrl: null, pid: null }
  }

  const entrypoint = path.join(repoRoot, 'scripts', 'roachnet-companion-server.mjs')
  if (!existsSync(entrypoint)) {
    await log('companion entrypoint missing; skipping companion bridge')
    return { localUrl: null, advertisedUrl: null, pid: null }
  }

  const localUrl = companionLocalUrl()
  const advertisedUrl = process.env.ROACHNET_COMPANION_ADVERTISED_URL?.trim() || localUrl
  companionProcess = spawn(process.execPath, [entrypoint], {
    cwd: repoRoot,
    detached: false,
    stdio: 'ignore',
    env: {
      ...process.env,
      ROACHNET_COMPANION_ENABLED: '1',
      ROACHNET_COMPANION_HOST: process.env.ROACHNET_COMPANION_HOST?.trim() || '127.0.0.1',
      ROACHNET_COMPANION_PORT: process.env.ROACHNET_COMPANION_PORT?.trim() || '38111',
      ROACHNET_COMPANION_TOKEN: token,
      ROACHNET_COMPANION_ADVERTISED_URL: advertisedUrl || '',
      ROACHNET_COMPANION_TARGET_URL: baseUrl,
    },
  })
  await log(`started companion pid=${companionProcess.pid} url=${localUrl}`)
  await waitForCompanion(localUrl)
  return { localUrl, advertisedUrl, pid: companionProcess.pid }
}

function writeRuntimeInfo({ baseUrl, companion }) {
  const info = {
    pid: process.pid,
    healthUrl: `${baseUrl}/api/health`,
    webUrl: baseUrl,
    companionUrl: companion.localUrl,
    companionAdvertisedUrl: companion.advertisedUrl,
    target: 'native-api',
    repoRoot,
    logPath,
  }
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        pid: process.pid,
        companionPid: companion.pid,
        port: new URL(baseUrl).port,
        baseUrl,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
  writeFileSync(
    processInfoPath,
    JSON.stringify(
      {
        target: 'native-api',
        companionUrl: companion.localUrl,
        companionAdvertisedUrl: companion.advertisedUrl,
        processes: [
          { name: 'native-api', pid: process.pid, port: Number(new URL(baseUrl).port), healthUrl: info.healthUrl },
          ...(companion.pid ? [{ name: 'companion', pid: companion.pid, url: companion.localUrl }] : []),
        ],
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
  if (process.env.ROACHNET_SERVER_INFO_FILE) {
    mkdirSync(path.dirname(process.env.ROACHNET_SERVER_INFO_FILE), { recursive: true })
    writeFileSync(process.env.ROACHNET_SERVER_INFO_FILE, JSON.stringify(info, null, 2))
  }
}

function listenServer(server, port, host) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      reject(error)
    }

    server.once('error', handleError)
    server.listen(port, host, () => {
      server.off('error', handleError)
      resolve(server.address())
    })
  })
}

async function main() {
  await stopExistingRuntime()
  const server = http.createServer((request, response) => {
    route(request, response).catch((error) => {
      log(`request failed: ${error.stack || error.message}`)
      sendError(response, error, 500)
    })
  })

  const listenPort = Number(process.env.PORT || '0')
  const listenHost = normalizeLoopbackHost(process.env.HOST)

  const address = await listenServer(server, listenPort, listenHost)
  const port = typeof address === 'object' && address ? address.port : listenPort
  const baseUrl = `http://127.0.0.1:${port}`
  let companion = { localUrl: null, advertisedUrl: null, pid: null }
  try {
    companion = await maybeStartCompanion(baseUrl)
  } catch (error) {
    await log(`companion start failed: ${error.stack || error.message}`)
  }
  writeRuntimeInfo({ baseUrl, companion })
  await log(`native api listening on ${baseUrl}`)
  ensureOllama().catch((error) => log(`ollama warmup failed: ${error.stack || error.message}`))

  const shutdown = () => {
    cleanupRuntimeStateFiles()
    if (companionProcess && companionProcess.exitCode === null) {
      companionProcess.kill('SIGTERM')
    }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3_000).unref()
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(async (error) => {
  await log(`fatal: ${error.stack || error.message}`)
  process.exit(1)
})
