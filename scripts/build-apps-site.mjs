#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const websiteRoot = path.join(repoRoot, 'website')
const outputRoot = path.join(repoRoot, 'website-apps-dist')

async function main() {
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })

  const copyTargets = [
    'app.css',
    'app.js',
    'app-store-catalog.json',
    'collections',
    'assets',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
  ]

  for (const target of copyTargets) {
    await cp(path.join(websiteRoot, target), path.join(outputRoot, target), {
      recursive: true,
      force: true,
    })
  }

  await cp(path.join(websiteRoot, 'app-store.html'), path.join(outputRoot, 'index.html'), {
    force: true,
  })

  await writeFile(
    path.join(outputRoot, '_redirects'),
    [
      '/app-store.html / 301',
      '/* /index.html 200',
    ].join('\n') + '\n',
    'utf8'
  )

  console.log(`Built Apps site into ${outputRoot}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
