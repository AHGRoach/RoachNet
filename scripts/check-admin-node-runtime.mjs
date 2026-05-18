#!/usr/bin/env node

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const candidates = [
  process.env.ROACHNET_ADMIN_NODE_BINARY?.trim(),
  '/opt/homebrew/opt/node@24/bin/node',
  '/usr/local/opt/node@24/bin/node',
  'node',
].filter(Boolean)

function readVersion(nodeBinary) {
  if (nodeBinary !== 'node' && !existsSync(nodeBinary)) {
    return null
  }

  const result = spawnSync(nodeBinary, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  })

  if (result.status !== 0) {
    return null
  }

  return String(result.stdout || '').trim()
}

function majorVersion(version) {
  return Number.parseInt(String(version || '').replace(/^v/, '').split('.')[0], 10)
}

function commandLineFor(nodeBinary) {
  if (nodeBinary === 'node') {
    return 'node scripts/build-admin-runtime.mjs'
  }

  return `ROACHNET_ADMIN_NODE_BINARY="${nodeBinary}" node scripts/build-admin-runtime.mjs`
}

for (const nodeBinary of candidates) {
  const version = readVersion(nodeBinary)
  if (majorVersion(version) === 24) {
    console.log(`Admin runtime Node 24 found: ${nodeBinary} (${version}).`)
    console.log(`Build legacy admin runtime with: ${commandLineFor(nodeBinary)}`)
    process.exit(0)
  }
}

const homebrewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local'
const homebrewNode = path.join(homebrewPrefix, 'opt', 'node@24', 'bin', 'node')
const homebrewBin = path.join(homebrewPrefix, 'opt', 'node@24', 'bin')

console.error('Admin runtime Node 24 is not available on this machine.')
console.error('')
console.error('The native RoachNet shipping lane uses Node 26 and does not need this.')
console.error('Only the quarantined legacy admin/WebUI build needs Node 24 because @openzim/libzim declares <25.')
console.error('')
console.error('For local admin maintenance:')
console.error('  brew install node@24')
console.error(`  ROACHNET_ADMIN_NODE_BINARY="${homebrewNode}" node scripts/build-admin-runtime.mjs`)
console.error('')
console.error('For direct admin commands:')
console.error(`  PATH="${homebrewBin}:$PATH" npm --prefix admin ci`)
console.error(`  PATH="${homebrewBin}:$PATH" npm --prefix admin run typecheck`)
process.exit(1)
