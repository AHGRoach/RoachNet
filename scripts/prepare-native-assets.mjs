#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const sourceIconPath = path.join(repoRoot, 'admin', 'public', 'roachnet-icon.png')
const desktopAssetsDir = path.join(repoRoot, 'desktop', 'assets')
const generatedDir = path.join(desktopAssetsDir, 'generated')
const iconsetPath = path.join(generatedDir, 'RoachNet.iconset')
const mainIconPath = path.join(desktopAssetsDir, 'icon.png')

const iconSizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
]

if (!existsSync(sourceIconPath)) {
  throw new Error(`Missing source icon at ${sourceIconPath}`)
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${binary} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function prepareMacIcons() {
  await mkdir(iconsetPath, { recursive: true })

  for (const [size, name] of iconSizes) {
    await run('sips', [
      '-z',
      String(size),
      String(size),
      sourceIconPath,
      '--out',
      path.join(iconsetPath, name),
    ])
  }

  const icnsPath = path.join(generatedDir, 'icon.icns')
  await run('iconutil', ['-c', 'icns', iconsetPath, '-o', icnsPath])
  await cp(icnsPath, path.join(desktopAssetsDir, 'icon.icns'), { force: true })
}

await mkdir(desktopAssetsDir, { recursive: true })
await rm(generatedDir, { recursive: true, force: true })
await mkdir(generatedDir, { recursive: true })
await cp(sourceIconPath, mainIconPath, { force: true })

if (process.platform === 'darwin') {
  await prepareMacIcons()
} else {
  await cp(sourceIconPath, path.join(generatedDir, 'icon-512x512.png'), { force: true })
  console.warn('Non-macOS icon generation only refreshes PNG assets. Native macOS packaging uses iconutil.')
}
