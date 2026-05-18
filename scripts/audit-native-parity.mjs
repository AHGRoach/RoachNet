#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function requireFile(relativePath, description = relativePath) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    failures.push(`Missing ${description}: ${relativePath}`)
  }
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) {
    failures.push(`Missing native parity proof: ${description}`)
  }
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) {
    failures.push(`Forbidden native parity regression: ${description}`)
  }
}

requireFile('native/macos/Sources/RoachNetApp/main.swift', 'native app shell')
requireFile('native/macos/Sources/RoachNetApp/RoachNetSettingsView.swift', 'native settings window')
requireFile('native/macos/Sources/RoachNetApp/RoachNetAboutView.swift', 'native about window')
requireFile('native/macos/Sources/RoachNetApp/RoachArcadeView.swift', 'native RoachArcade')
requireFile('native/macos/Sources/RoachNetApp/RoachArchiveView.swift', 'native vault archive')
requireFile('native/macos/Sources/RoachNetApp/RoachMapsSupport.swift', 'native atlas')
requireFile('native/macos/Sources/RoachNetApp/DevWorkspaceView.swift', 'native dev workspace')
requireFile('native/macos/Sources/RoachNetSetup/main.swift', 'native setup app')
requireFile('scripts/run-roachnet-native-api.mjs', 'dependency-free native API bridge')
requireFile('desktop/updater.cjs', 'legacy Electron updater reference kept for feature parity review')
requireFile('installer/main.cjs', 'legacy Electron setup reference kept for feature parity review')

const rootPackage = JSON.parse(read('package.json'))
if (rootPackage.main !== 'scripts/run-roachnet-native-api.mjs') {
  failures.push('Root package main must boot the dependency-free native API bridge.')
}
for (const [scriptName, command] of Object.entries(rootPackage.scripts ?? {})) {
  if (/electron|electron-builder|desktop:|installer:|build:web|npm\s+--prefix\s+admin|run-roachnet\.mjs/i.test(`${scriptName} ${command}`)) {
    failures.push(`Root script still points at Electron/WebUI shipping lane: ${scriptName}`)
  }
}

const mainSource = read('native/macos/Sources/RoachNetApp/main.swift')
const settingsSource = read('native/macos/Sources/RoachNetApp/RoachNetSettingsView.swift')
const runtimeSource = read('native/macos/Sources/RoachNetCore/ManagedAppRuntime.swift')
const buildSource = read('scripts/build-native-macos-apps.mjs')
const setupSource = read('scripts/run-roachnet-setup.mjs')

for (const pane of ['models', 'apps', 'updates', 'benchmark', 'support', 'legal', 'runtime']) {
  if (!settingsSource.includes(`case .${pane}:`)) {
    failures.push(`Missing native parity proof: settings switch renders native ${pane} pane`)
  }
  requirePattern(settingsSource, new RegExp(`case ${pane}\\b`), `native settings pane enum includes ${pane}`)
}

for (const method of [
  'checkLatestVersion',
  'getSystemUpdateStatus',
  'requestSystemUpdate',
  'getBenchmarkStatus',
  'runBenchmark',
]) {
  requirePattern(runtimeSource, new RegExp(`public func ${method}\\b`), `native runtime bridge exposes ${method}`)
}

for (const route of [
  '/settings/ai',
  '/settings/apps',
  '/settings/models',
  '/settings/update',
  '/settings/benchmark',
  '/settings/support',
  '/settings/legal',
  '/settings/system',
]) {
  requirePattern(mainSource, new RegExp(route.replaceAll('/', '\\/')), `native app maps ${route}`)
}

forbidPattern(mainSource, /openRoute\("\/settings\//, 'native app still opens internal settings routes in embedded WebUI')
forbidPattern(settingsSource, /openRoute\("\/settings\//, 'native settings still opens settings subpages through embedded WebUI')
forbidPattern(settingsSource, /Web Atlas/, 'settings still labels the native atlas path as Web Atlas')
forbidPattern(mainSource, /Web Atlas/, 'main shell still labels the native atlas path as Web Atlas')

requirePattern(buildSource, /includeRuntimeDependencies:\s*false/, 'setup source payload excludes heavy runtime dependencies')
requirePattern(buildSource, /'admin\/'/, 'setup source payload excludes legacy admin WebUI sources')
requirePattern(buildSource, /openclaw-deferred\.marker/, 'setup installer defers giant OpenClaw payload instead of bundling it by default')
requirePattern(setupSource, /run-roachnet-native-api\.mjs/, 'native setup smoke-tests the dependency-free API bridge')
forbidPattern(buildSource + setupSource, /bundled-admin-build-node-modules|ensureAdminBuildRuntimeDependencies|build-admin-runtime\.mjs/, 'shipping lane still hydrates legacy admin runtime dependencies')

const nativeApiSource = read('scripts/run-roachnet-native-api.mjs')
const companionSource = read('scripts/roachnet-companion-server.mjs')
requirePattern(nativeApiSource, /function normalizeLoopbackHost\b/, 'native API refuses non-loopback bind hosts')
requirePattern(
  nativeApiSource,
  /const listenHost = normalizeLoopbackHost\(process\.env\.HOST\)[\s\S]*listenServer\(server,\s*listenPort,\s*listenHost\)/,
  'native API binds through the normalized loopback host'
)
requirePattern(companionSource, /ROACHNET_COMPANION_HOST\?\.[\s\S]*\|\|\s*'127\.0\.0\.1'/, 'companion bridge defaults to loopback')

if (failures.length > 0) {
  console.error('Native parity audit failed.')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Native parity audit passed.')
