#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const adminDir = path.join(repoRoot, 'admin')
const envPath = path.join(adminDir, '.env')
const buildEntrypointPath = path.join(adminDir, 'build', 'bin', 'server.js')
const storageLogsDir = path.join(adminDir, 'storage', 'logs')
const serverLogPath = path.join(storageLogsDir, 'roachnet-server.log')

const SERVER_BOOT_TIMEOUT_MS = 180_000
const HEALTH_POLL_INTERVAL_MS = 1_500

function parseEnvFile(content) {
  const values = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

async function loadEnv() {
  if (!existsSync(envPath)) {
    throw new Error(`Missing environment file at ${envPath}`)
  }

  const raw = await readFile(envPath, 'utf8')
  return parseEnvFile(raw)
}

function getBaseUrl(envValues) {
  if (envValues.URL) {
    return new URL(envValues.URL)
  }

  const host = envValues.HOST || 'localhost'
  const port = envValues.PORT || '8080'
  return new URL(`http://${host}:${port}`)
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      })

      if (response.ok) {
        return true
      }
    } catch {
      // Server is still booting.
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS))
  }

  return false
}

function getPreferredNodeBinary() {
  const macHomebrewNode22 = '/opt/homebrew/opt/node@22/bin/node'
  return existsSync(macHomebrewNode22) ? macHomebrewNode22 : process.execPath
}

function getServerEntrypoint() {
  if (process.env.ROACHNET_USE_SOURCE === '1') {
    return 'bin/server.js'
  }

  return existsSync(buildEntrypointPath) ? 'build/bin/server.js' : 'bin/server.js'
}

function openBrowser(url) {
  if (process.env.ROACHNET_NO_BROWSER === '1') {
    return
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

async function main() {
  const envValues = await loadEnv()
  const baseUrl = getBaseUrl(envValues)
  const healthUrl = new URL('/api/health', baseUrl)
  const homeUrl = new URL('/home', baseUrl)

  const alreadyRunning = await waitForHealth(healthUrl, 1_000)

  if (alreadyRunning) {
    openBrowser(homeUrl.toString())
    console.log(`RoachNet is already running at ${homeUrl.toString()}`)
    return
  }

  mkdirSync(storageLogsDir, { recursive: true })

  const serverLogFd = openSync(serverLogPath, 'a')
  const nodeBinary = getPreferredNodeBinary()
  const serverEntrypoint = getServerEntrypoint()
  const child = spawn(
    nodeBinary,
    serverEntrypoint === 'bin/server.js'
      ? [
          '--import=ts-node-maintained/register/esm',
          '--enable-source-maps',
          '--disable-warning=ExperimentalWarning',
          serverEntrypoint,
        ]
      : [serverEntrypoint],
    {
      cwd: adminDir,
      detached: true,
      env: {
        ...process.env,
        ...envValues,
      },
      stdio: ['ignore', serverLogFd, serverLogFd],
    }
  )

  let childExited = false
  child.on('exit', () => {
    childExited = true
  })
  child.unref()

  const healthy = await waitForHealth(healthUrl, SERVER_BOOT_TIMEOUT_MS)

  if (!healthy) {
    const reason = childExited
      ? 'The RoachNet server exited before it became healthy.'
      : 'The RoachNet server did not become healthy before the startup timeout.'
    throw new Error(`${reason} Check ${serverLogPath} for startup logs.`)
  }

  openBrowser(homeUrl.toString())

  console.log(`RoachNet server started.`)
  console.log(`Server entrypoint: ${serverEntrypoint}`)
  console.log(`Web UI: ${homeUrl.toString()}`)
  console.log(`Server logs: ${serverLogPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
