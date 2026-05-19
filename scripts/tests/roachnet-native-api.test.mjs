import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { requestHttp } from '../lib/roachnet_http.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

async function resolveAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function requestJson(url, options = {}) {
  const response = await requestHttp(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 5_000,
  })
  const payload = JSON.parse(await response.text())
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${JSON.stringify(payload)}`)
  return payload
}

async function waitForHealth(url, child, timeoutMs = 20_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`native API exited before health check: ${child.exitCode}`)
    }
    try {
      await requestJson(url)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function waitForPath(targetPath, child, timeoutMs = 20_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(targetPath)) {
      return
    }
    if (child.exitCode !== null) {
      throw new Error(`native API exited before writing ${targetPath}: ${child.exitCode}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${targetPath}`)
}

async function runTool(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      stdio: 'pipe',
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr}`))
      }
    })
  })
}

async function stopNativeApi(child, env) {
  await new Promise((resolve) => {
    const stop = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs'), '--stop'], {
      cwd: repoRoot,
      env,
      stdio: 'ignore',
    })
    stop.once('close', resolve)
  })
  await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function createTestRoachSpeechPackZip(tempRoot, packID = 'test-roachvoice-pack') {
  const sourceRoot = path.join(tempRoot, packID)
  mkdirSync(path.join(sourceRoot, 'RoachVoice'), { recursive: true })
  writeFileSync(
    path.join(sourceRoot, 'RoachSpeechPack.json'),
    JSON.stringify(
      {
        packID,
        displayName: 'Test RoachVoice Pack',
        version: '1.0.5-test',
        kind: 'roachVoice',
        nativeFormat: 'coreML',
        features: ['customVoiceSynthesis'],
        noNetwork: true,
        noPackagedBinary: true,
        nativeInferenceReady: true,
        parityValidated: false,
      },
      null,
      2
    )
  )
  writeFileSync(path.join(sourceRoot, 'RoachVoice', 'placeholder.txt'), 'native test payload\n')
  const archivePath = path.join(tempRoot, `${packID}.zip`)
  await runTool('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', sourceRoot, archivePath])
  return archivePath
}

function startStaticFileServer(port, route, filePath) {
  const server = createServer((request, response) => {
    if (request.url === route) {
      const body = readFileSync(filePath)
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': body.byteLength,
      })
      response.end(body)
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"not found"}')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function startStaticDirectoryServer(port, root) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`)
    const relativePath = requestUrl.pathname.replace(/^\/+/, '')
    const filePath = path.resolve(root, relativePath)
    if (filePath.startsWith(path.resolve(root)) && existsSync(filePath)) {
      const body = readFileSync(filePath)
      response.writeHead(200, {
        'content-type': relativePath.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'content-length': body.byteLength,
      })
      response.end(body)
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"not found"}')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function sha256FileSync(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function splitFileIntoParts(filePath, outputRoot, routePrefix, partSize) {
  const buffer = readFileSync(filePath)
  const parts = []
  for (let offset = 0, index = 0; offset < buffer.length; offset += partSize, index += 1) {
    const part = buffer.subarray(offset, Math.min(offset + partSize, buffer.length))
    const filename = `part-${String(index + 1).padStart(3, '0')}.bin`
    const sha256 = createHash('sha256').update(part).digest('hex')
    const header = `ROACHNET-IA-CHUNK-v1 ${index} ${part.byteLength} ${sha256}\n`
    writeFileSync(path.join(outputRoot, filename), Buffer.concat([Buffer.from(header, 'utf8'), part]))
    parts.push({
      index,
      url: `${routePrefix}/${filename}`,
      offset,
      bytes: part.byteLength,
      sha256,
      encoding: 'roachnet-ia-chunk-v1',
      header,
      encodedBytes: Buffer.byteLength(header) + part.byteLength,
    })
  }
  return parts
}

function startReleaseServer(port) {
  const server = createServer((request, response) => {
    if (request.url === '/releases') {
      const body = JSON.stringify([
        {
          draft: false,
          prerelease: false,
          tag_name: 'v9.9.9',
          name: 'RoachNet 9.9.9',
          html_url: `http://127.0.0.1:${port}/release`,
          assets: [
            {
              name: 'RoachNet-Setup-macOS.dmg',
              browser_download_url: `http://127.0.0.1:${port}/RoachNet-Setup-macOS.dmg`,
            },
          ],
        },
      ])
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      })
      response.end(body)
      return
    }

    if (request.url === '/RoachNet-Setup-macOS.dmg') {
      const body = Buffer.from('roachnet test installer payload')
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': body.byteLength,
      })
      response.end(body)
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"not found"}')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function startBrokenReleaseServer(port) {
  const server = createServer((request, response) => {
    if (request.url === '/releases') {
      const body = JSON.stringify([
        {
          draft: false,
          prerelease: false,
          tag_name: 'v9.9.9',
          name: 'RoachNet 9.9.9',
          html_url: `http://127.0.0.1:${port}/release`,
          assets: [
            {
              name: 'RoachNet-Setup-macOS.dmg',
              browser_download_url: `http://127.0.0.1:${port}/broken.dmg`,
            },
          ],
        },
      ])
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      })
      response.end(body)
      return
    }

    if (request.url === '/broken.dmg') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': '4096',
      })
      response.write(Buffer.from('partial roachnet installer payload'))
      response.destroy()
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"not found"}')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function startSlowDownloadServer(port) {
  const server = createServer((request, response) => {
    if (request.url === '/slow.pmtiles') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(1024 * 128),
      })
      let sent = 0
      const timer = setInterval(() => {
        if (sent >= 1024 * 128 || response.destroyed) {
          clearInterval(timer)
          if (!response.destroyed) response.end()
          return
        }
        sent += 1024
        response.write(Buffer.alloc(1024, 1))
      }, 25)
      response.once('close', () => clearInterval(timer))
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"not found"}')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

test('native API exposes app catalogs and companion payloads without the legacy WebUI runtime', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-test-'))
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const companionPort = await resolveAvailablePort()
  const releasesPort = await resolveAvailablePort()
  const releaseServer = await startReleaseServer(releasesPort)
  const token = 'native-api-companion-test-token'
  const statePath = path.join(runtimeStateRoot, 'roachnet-native-api-state.json')
  const processInfoPath = path.join(storagePath, 'logs', 'roachnet-runtime-processes.json')
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    ROACHNET_COMPANION_ENABLED: '1',
    ROACHNET_COMPANION_HOST: '127.0.0.1',
    ROACHNET_COMPANION_PORT: String(companionPort),
    ROACHNET_COMPANION_TOKEN: token,
    ROACHNET_GITHUB_RELEASES_API_URL: `http://127.0.0.1:${releasesPort}/releases`,
    ROACHNET_RELEASES_URL: `http://127.0.0.1:${releasesPort}/release`,
    ROACHNET_OPEN_UPDATES: '0',
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)

    const services = await requestJson(`http://127.0.0.1:${port}/api/system/services`)
    assert.equal(services.some((service) => service.service_name === 'roachnet_ollama'), true)

    const maps = await requestJson(`http://127.0.0.1:${port}/api/maps/curated-collections`)
    assert.equal(Array.isArray(maps), true)
    assert.equal(maps.length > 0, true)
    assert.equal(Array.isArray(maps[0].resources), true)

    const categories = await requestJson(`http://127.0.0.1:${port}/api/zim/curated-categories`)
    assert.equal(categories.length > 0, true)
    assert.equal(Array.isArray(categories[0].tiers), true)

    const wikipedia = await requestJson(`http://127.0.0.1:${port}/api/zim/wikipedia`)
    assert.equal(wikipedia.options.length > 0, true)

    const latest = await requestJson(`http://127.0.0.1:${port}/api/system/latest-version?force=1`)
    assert.equal(latest.success, true)
    assert.equal(latest.updateAvailable, true)
    assert.equal(latest.latestVersion, '9.9.9')

    const agentStatus = await requestJson(`http://127.0.0.1:${port}/api/roachclaw/agent/status`)
    assert.equal(agentStatus.runtime, 'roachclaw-native-agent')
    assert.equal(agentStatus.upstreamRuntimeDependency, 'none')
    assert.equal(agentStatus.references.hermesAgent.role, 'design-reference-only')
    assert.equal(agentStatus.skills.some((skill) => skill.id === 'app-context-router'), true)

    const agentRun = await requestJson(`http://127.0.0.1:${port}/api/roachclaw/agent/run`, {
      method: 'POST',
      body: {
        prompt: 'Help with the active game.',
        execute: false,
        activeSurface: 'RoachArcade',
        enabledScopes: ['arcade'],
        context: {
          arcade: 'running game: Test Cartridge',
          vault: 'locked book note',
        },
      },
    })
    assert.equal(agentRun.runtime, 'roachclaw-native-agent')
    assert.equal(agentRun.executed, false)
    assert.match(agentRun.prompt.messages[1].content, /running game: Test Cartridge/)
    assert.doesNotMatch(agentRun.prompt.messages[1].content, /locked book note/)

    const update = await requestJson(`http://127.0.0.1:${port}/api/system/update`, { method: 'POST' })
    assert.equal(update.success, true)
    let updateStatus = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      updateStatus = await requestJson(`http://127.0.0.1:${port}/api/system/update/status`)
      if (updateStatus.stage === 'ready' || updateStatus.stage === 'error') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.equal(updateStatus.stage, 'ready')
    assert.equal(existsSync(path.join(storagePath, 'updates', 'RoachNet-Setup-macOS.dmg')), true)
    assert.equal(existsSync(path.join(storagePath, 'updates', 'RoachNet-Setup-macOS.dmg.part')), false)

    await waitForPath(processInfoPath, child)
    const processInfo = JSON.parse(readFileSync(processInfoPath, 'utf8'))
    assert.equal(processInfo.companionUrl, `http://127.0.0.1:${companionPort}`)

    const bootstrap = await requestJson(`${processInfo.companionUrl}/api/companion/bootstrap`, { token })
    assert.equal(bootstrap.appName, 'RoachNet')
    assert.match(bootstrap.appsCatalogUrl, /^https:\/\/apps\.roachnet\.org\//)
  } finally {
    await stopNativeApi(child, env)
    assert.equal(child.exitCode === 0 || child.signalCode === 'SIGTERM', true)
    assert.equal(existsSync(statePath), false)
    assert.equal(existsSync(processInfoPath), false)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => releaseServer.close(resolve))
  }
})

test('companion App Store installs route descriptor downloads into the native app', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-appstore-install-test-'))
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const publicRoot = path.join(tempRoot, 'public')
  const artifactRoot = path.join(publicRoot, 'artifacts')
  const descriptorRoot = path.join(publicRoot, 'downloads', 'maps', 'pmtiles')
  mkdirSync(artifactRoot, { recursive: true })
  mkdirSync(descriptorRoot, { recursive: true })
  const payloadPath = path.join(artifactRoot, 'test-map.pmtiles')
  writeFileSync(payloadPath, 'roachnet app store map payload\n')
  const downloadPort = await resolveAvailablePort()
  const descriptorPath = path.join(descriptorRoot, 'test-map.json')
  writeFileSync(
    descriptorPath,
    JSON.stringify({
      schema: 'org.roachnet.apps.download-descriptor.v1',
      id: 'test-map',
      filename: 'test-map.pmtiles',
      sha256: sha256FileSync(payloadPath),
      sources: [
        {
          type: 'test-source',
          status: 'published',
          url: `http://127.0.0.1:${downloadPort}/artifacts/test-map.pmtiles`,
        },
      ],
    })
  )
  const staticServer = await startStaticDirectoryServer(downloadPort, publicRoot)
  const port = await resolveAvailablePort()
  const companionPort = await resolveAvailablePort()
  const token = 'native-api-appstore-install-token'
  const processInfoPath = path.join(storagePath, 'logs', 'roachnet-runtime-processes.json')
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    ROACHNET_COMPANION_ENABLED: '1',
    ROACHNET_COMPANION_HOST: '127.0.0.1',
    ROACHNET_COMPANION_PORT: String(companionPort),
    ROACHNET_COMPANION_TOKEN: token,
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    await waitForPath(processInfoPath, child)
    const processInfo = JSON.parse(readFileSync(processInfoPath, 'utf8'))

    const descriptorUrl = `http://127.0.0.1:${downloadPort}/downloads/maps/pmtiles/test-map.json`
    const queued = await requestJson(`${processInfo.companionUrl}/api/companion/install`, {
      method: 'POST',
      token,
      body: {
        action: 'direct-download',
        id: 'test-map',
        title: 'Test Map',
        url: descriptorUrl,
        filetype: 'map',
      },
    })
    assert.equal(queued.success, true)
    assert.equal(queued.action, 'direct-download')
    assert.equal(queued.queued, 1)

    let jobs = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      jobs = await requestJson(`http://127.0.0.1:${port}/api/downloads/jobs`)
      if (jobs[0]?.status === 'completed' || jobs[0]?.status === 'failed') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    assert.equal(jobs[0]?.status, 'completed')
    assert.equal(jobs[0]?.descriptorUrl, descriptorUrl)
    assert.equal(jobs[0]?.sha256, sha256FileSync(payloadPath))
    assert.equal(existsSync(path.join(storagePath, 'maps', 'pmtiles', 'test-map.pmtiles')), true)
    assert.equal(existsSync(path.join(storagePath, 'maps', 'pmtiles', 'test-map.pmtiles.part')), false)
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => staticServer.close(resolve))
  }
})

test('native API downloads through temporary partial files with an explicit byte ceiling', () => {
  const source = readRepoFile('scripts/run-roachnet-native-api.mjs')

  assert.match(source, /NATIVE_API_MAX_DOWNLOAD_BYTES/)
  assert.match(source, /partialFilepath:\s*`\$\{filepath\}\.part`/)
  assert.match(source, /bytesReceived/)
  assert.match(source, /completedAt/)
  assert.match(source, /createWriteStream\(job\.partialFilepath\)/)
  assert.match(source, /renameSync\(job\.partialFilepath,\s*job\.filepath\)/)
  assert.match(source, /rmSync\(job\.partialFilepath,\s*\{\s*force:\s*true\s*\}\)/)
  assert.match(source, /Download exceeded the configured/)
})

test('native API cancels active download jobs and removes partial files', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-cancel-test-'))
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const downloadPort = await resolveAvailablePort()
  const slowServer = await startSlowDownloadServer(downloadPort)
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    const queued = await requestJson(`http://127.0.0.1:${port}/api/maps/download-remote`, {
      method: 'POST',
      body: { url: `http://127.0.0.1:${downloadPort}/slow.pmtiles` },
    })
    assert.equal(queued.success, true)

    let jobs = []
    for (let attempt = 0; attempt < 20; attempt += 1) {
      jobs = await requestJson(`http://127.0.0.1:${port}/api/downloads/jobs`)
      if (jobs.length > 0 && jobs[0].status === 'downloading') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].status, 'downloading')
    assert.equal(typeof jobs[0].bytesReceived, 'number')

    const cancelled = await requestJson(`http://127.0.0.1:${port}/api/downloads/jobs/${jobs[0].jobId}`, {
      method: 'DELETE',
    })
    assert.equal(cancelled.cancelled, true)

    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal(existsSync(path.join(storagePath, 'maps', 'pmtiles', 'slow.pmtiles')), false)
    assert.equal(existsSync(path.join(storagePath, 'maps', 'pmtiles', 'slow.pmtiles.part')), false)
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => slowServer.close(resolve))
  }
})

test('native API installs downloaded RoachSpeech packs into the active model shelf', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-roachspeech-test-'))
  const packID = 'test-roachvoice-pack'
  const archivePath = await createTestRoachSpeechPackZip(tempRoot, packID)
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const downloadPort = await resolveAvailablePort()
  const packServer = await startStaticFileServer(downloadPort, '/test-roachvoice-pack.zip', archivePath)
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    const queued = await requestJson(`http://127.0.0.1:${port}/api/roachspeech/model-packs/download`, {
      method: 'POST',
      body: {
        url: `http://127.0.0.1:${downloadPort}/test-roachvoice-pack.zip`,
        packID,
        kind: 'roachVoice',
      },
    })
    assert.equal(queued.success, true)
    assert.equal(queued.packID, packID)

    let jobs = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      jobs = await requestJson(`http://127.0.0.1:${port}/api/downloads/jobs`)
      if (jobs[0]?.status === 'completed' || jobs[0]?.status === 'failed') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.equal(jobs[0]?.status, 'completed')
    assert.equal(jobs[0]?.installStatus, 'installed')
    assert.equal(existsSync(path.join(storagePath, 'RoachSpeech', 'ModelPacks', packID, 'RoachSpeechPack.json')), true)

    const packs = await requestJson(`http://127.0.0.1:${port}/api/roachspeech/model-packs`)
    const installedPack = packs.packs.find((pack) => pack.packID === packID)
    assert.equal(installedPack?.installed, true)
    assert.equal(installedPack.manifest.kind, 'roachVoice')
    assert.equal(packs.registry[0].status, 'installed')
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => packServer.close(resolve))
  }
})

test('native API resolves Apps download descriptors before installing RoachSpeech packs', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-roachspeech-descriptor-test-'))
  const packID = 'test-roachvoice-descriptor-pack'
  const archivePath = await createTestRoachSpeechPackZip(tempRoot, packID)
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const downloadPort = await resolveAvailablePort()
  const descriptorPort = await resolveAvailablePort()
  const packServer = await startStaticFileServer(downloadPort, '/test-roachvoice-descriptor-pack.zip', archivePath)
  const descriptorPath = path.join(tempRoot, 'descriptor.json')
  writeFileSync(
    descriptorPath,
    JSON.stringify({
      schema: 'org.roachnet.apps.download-descriptor.v1',
      id: packID,
      filename: 'test-roachvoice-descriptor-pack.zip',
      sha256: sha256FileSync(archivePath),
      sources: [
        {
          type: 'test-source',
          url: `http://127.0.0.1:${downloadPort}/test-roachvoice-descriptor-pack.zip`,
        },
      ],
    })
  )
  const descriptorServer = await startStaticFileServer(descriptorPort, '/downloads/model-packs/test-roachvoice-descriptor-pack.json', descriptorPath)
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    const queued = await requestJson(`http://127.0.0.1:${port}/api/roachspeech/model-packs/download`, {
      method: 'POST',
      body: {
        url: `http://127.0.0.1:${descriptorPort}/downloads/model-packs/test-roachvoice-descriptor-pack.json`,
        packID,
        kind: 'roachVoice',
      },
    })
    assert.equal(queued.success, true)
    assert.equal(queued.packID, packID)

    let jobs = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      jobs = await requestJson(`http://127.0.0.1:${port}/api/downloads/jobs`)
      if (jobs[0]?.status === 'completed' || jobs[0]?.status === 'failed') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.equal(jobs[0]?.status, 'completed')
    assert.equal(jobs[0]?.installStatus, 'installed')
    assert.equal(jobs[0]?.descriptorUrl, `http://127.0.0.1:${descriptorPort}/downloads/model-packs/test-roachvoice-descriptor-pack.json`)
    assert.equal(existsSync(path.join(storagePath, 'RoachSpeech', 'ModelPacks', packID, 'RoachSpeechPack.json')), true)
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => packServer.close(resolve))
    await new Promise((resolve) => descriptorServer.close(resolve))
  }
})

test('native API reassembles chunked Apps descriptors before installing RoachSpeech packs', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-roachspeech-chunked-test-'))
  const packID = 'test-roachvoice-chunked-pack'
  const archivePath = await createTestRoachSpeechPackZip(tempRoot, packID)
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const downloadPort = await resolveAvailablePort()
  const publicRoot = path.join(tempRoot, 'public')
  const partsRoot = path.join(publicRoot, 'parts')
  mkdirSync(partsRoot, { recursive: true })
  const parts = splitFileIntoParts(
    archivePath,
    partsRoot,
    `http://127.0.0.1:${downloadPort}/parts`,
    512
  )
  const descriptorPath = path.join(publicRoot, 'downloads', 'model-packs', 'test-roachvoice-chunked-pack.json')
  mkdirSync(path.dirname(descriptorPath), { recursive: true })
  writeFileSync(
    descriptorPath,
    JSON.stringify({
      schema: 'org.roachnet.apps.download-descriptor.v1',
      id: packID,
      filename: 'test-roachvoice-chunked-pack.zip',
      bytes: readFileSync(archivePath).byteLength,
      sha256: sha256FileSync(archivePath),
      parts,
      sources: [
        {
          type: 'internet-archive-parts',
          status: 'published-after-upload',
          partCount: parts.length,
        },
      ],
    })
  )
  const staticServer = await startStaticDirectoryServer(downloadPort, publicRoot)
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    const queued = await requestJson(`http://127.0.0.1:${port}/api/roachspeech/model-packs/download`, {
      method: 'POST',
      body: {
        url: `http://127.0.0.1:${downloadPort}/downloads/model-packs/test-roachvoice-chunked-pack.json`,
        packID,
        kind: 'roachVoice',
      },
    })
    assert.equal(queued.success, true)
    assert.equal(queued.packID, packID)

    let jobs = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      jobs = await requestJson(`http://127.0.0.1:${port}/api/downloads/jobs`)
      if (jobs[0]?.status === 'completed' || jobs[0]?.status === 'failed') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.equal(jobs[0]?.status, 'completed')
    assert.equal(jobs[0]?.installStatus, 'installed')
    assert.equal(jobs[0]?.sha256, sha256FileSync(archivePath))
    assert.equal(existsSync(path.join(storagePath, 'RoachSpeech', 'ModelPacks', packID, 'RoachSpeechPack.json')), true)
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => staticServer.close(resolve))
  }
})

test('native API rejects oversized JSON bodies with a public 413 response', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-body-test-'))
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    ROACHNET_NATIVE_API_MAX_BODY_BYTES: '64',
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    const response = await requestHttp(`http://127.0.0.1:${port}/api/benchmark/run`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: 'x'.repeat(128) }),
      timeoutMs: 5_000,
    })
    assert.equal(response.status, 413)
    assert.match((await response.json()).error, /larger than 64 bytes/)
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('native API removes partial update downloads after transfer failure', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-update-test-'))
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const port = await resolveAvailablePort()
  const releasesPort = await resolveAvailablePort()
  const releaseServer = await startBrokenReleaseServer(releasesPort)
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    ROACHNET_GITHUB_RELEASES_API_URL: `http://127.0.0.1:${releasesPort}/releases`,
    ROACHNET_RELEASES_URL: `http://127.0.0.1:${releasesPort}/release`,
    ROACHNET_OPEN_UPDATES: '0',
    HOST: '127.0.0.1',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, child)
    const update = await requestJson(`http://127.0.0.1:${port}/api/system/update`, { method: 'POST' })
    assert.equal(update.success, true)

    let updateStatus = null
    for (let attempt = 0; attempt < 80; attempt += 1) {
      updateStatus = await requestJson(`http://127.0.0.1:${port}/api/system/update/status`)
      if (updateStatus.stage === 'error') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    assert.equal(updateStatus.stage, 'error')
    assert.match(updateStatus.message, /Download from/)
    assert.equal(existsSync(path.join(storagePath, 'updates', 'broken.dmg')), false)
    assert.equal(existsSync(path.join(storagePath, 'updates', 'broken.dmg.part')), false)
  } finally {
    await stopNativeApi(child, env)
    await rm(tempRoot, { recursive: true, force: true })
    await new Promise((resolve) => releaseServer.close(resolve))
  }
})

test('native API refuses non-loopback bind hosts before listening', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roachnet-native-api-host-test-'))
  const storagePath = path.join(tempRoot, 'storage')
  const runtimeStateRoot = path.join(tempRoot, 'state')
  const logPath = path.join(storagePath, 'logs', 'roachnet-native-api.log')
  const port = await resolveAvailablePort()
  const env = {
    ...process.env,
    ROACHNET_STORAGE_PATH: storagePath,
    ROACHNET_RUNTIME_STATE_ROOT: runtimeStateRoot,
    HOST: '192.0.2.10',
    PORT: String(port),
  }
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'run-roachnet-native-api.mjs')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const exitCode = await new Promise((resolve) => child.once('exit', (code) => resolve(code)))
    assert.equal(exitCode, 1)
    assert.match(readFileSync(logPath, 'utf8'), /only binds to loopback hosts/)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
