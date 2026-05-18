#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const mainSwiftPath = path.join(repoRoot, 'native', 'macos', 'Sources', 'RoachNetApp', 'main.swift')

function assertPattern(source, pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`Command bar release gate failed: missing ${description}`)
  }
}

function assertNotPattern(source, pattern, description) {
  if (pattern.test(source)) {
    throw new Error(`Command bar release gate failed: found ${description}`)
  }
}

function main() {
  const source = fs.readFileSync(mainSwiftPath, 'utf8')

  assertPattern(source, /Ctrl-Cmd-R/, 'global hotkey hint')
  assertPattern(source, /UInt32\(cmdKey\) \| UInt32\(controlKey\)/, 'Ctrl-Cmd-R global modifier registration')
  assertNotPattern(
    source,
    /collectionBehavior\s*=\s*\[[^\]]*\.canJoinAllSpaces[^\]]*\.moveToActiveSpace[^\]]*\]/s,
    'invalid detached palette Space behavior mix'
  )
  assertNotPattern(
    source,
    /filteredCommandPaletteEntries\(from:\s*entries,\s*query:\s*query\)\.prefix\(10\)/,
    'global command palette result cap'
  )
  assertPattern(source, /CommandPaletteFeaturedRail/, 'featured command rail')
  assertPattern(source, /CommandPalettePreview/, 'preview surface')
  assertPattern(source, /@Environment\(\\\.openSettings\)/, 'native Settings scene opener')
  assertPattern(source, /case openNativeSettings/, 'native Settings command target')
  assertPattern(source, /id:\s*"settings"[\s\S]*?target:\s*target/, 'Settings command routes through native command target')
  assertNotPattern(
    source,
    /shell(?:Compact|Expanded)UtilityButton\("Settings"[\s\S]{0,240}openRoute\("\/settings\/system"/,
    'web Settings route wired to shell Settings button'
  )
  assertPattern(source, /featuredCommandPaletteEntries/, 'featured-entry provider')
  assertPattern(source, /recordRecentCommand/, 'recent-command tracking')
  assertPattern(source, /commandPaletteVisibleEntries/, 'recent-first command list')
  assertPattern(source, /commandPaletteScore\(for:[\s\S]*?aliases/, 'alias-aware fuzzy command scoring')
  assertPattern(source, /commandPaletteNumberIndex/, 'command-number activation support')
  assertPattern(source, /action-copy-diagnostics/, 'copy diagnostics command')
  assertPattern(source, /action-open-runtime-log/, 'runtime log command')
  assertPattern(source, /⌥↵/, 'secondary command action hint')
  assertPattern(source, /showActionPanel/, 'Raycast-style action panel reveal')
  assertPattern(source, /action-voice-prompt/, 'voice prompt command')
  assertPattern(source, /action-latest-reply/, 'latest reply playback command')
  assertPattern(source, /action-save-latest-reply/, 'save-to-RoachBrain command')
  assertPattern(source, /action-stage-next-useful-move/, 'starter prompt staging command')
  assertPattern(source, /action-stage-runtime-summary/, 'runtime summary staging command')
  assertPattern(source, /action-toggle-vault-context/, 'vault-context command')
  assertPattern(source, /action-toggle-archive-context/, 'archive-context command')
  assertPattern(source, /action-toggle-project-context/, 'project-context command')
  assertPattern(source, /action-toggle-roachnet-context/, 'RoachNet-context command')
  assertPattern(source, /action-open-model-store/, 'model store command')
  assertPattern(source, /action-open-apps-store/, 'apps store command')
  assertPattern(source, /action-open-storage-root/, 'storage root command')
  assertPattern(source, /action-open-projects-root/, 'projects root command')
  assertPattern(source, /action-import-obsidian-vault/, 'Obsidian import command')

  console.log('RoachNet command bar release gate passed.')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
