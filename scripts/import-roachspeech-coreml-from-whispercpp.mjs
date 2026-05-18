#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function requireArg(args, key) {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required --${key}`)
  }
  return value.trim()
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value)
}

function hasNonEmptyFile(directoryPath) {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return false
  }
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory() && hasNonEmptyFile(entryPath)) {
      return true
    }
    if (entry.isFile() && fs.statSync(entryPath).size > 0) {
      return true
    }
  }
  return false
}

function requireCompiledModelBundle(bundlePath, label) {
  if (!hasNonEmptyFile(bundlePath)) {
    throw new Error(`${label} must be a non-empty compiled Core ML bundle: ${bundlePath}`)
  }
}

function copyDirectory(sourcePath, destinationPath) {
  fs.rmSync(destinationPath, { recursive: true, force: true })
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true })
}

function copyFile(sourcePath, destinationPath, label) {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || fs.statSync(sourcePath).size === 0) {
    throw new Error(`${label} must be a non-empty file: ${sourcePath}`)
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.copyFileSync(sourcePath, destinationPath)
}

function writeJson(destinationPath, value) {
  fs.writeFileSync(destinationPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const modelName = requireArg(args, 'model')
  const whisperCppModelsPath = resolveRepoPath(requireArg(args, 'whispercpp-models'))
  const outputRoot = resolveRepoPath(
    args.output || `native/macos/Vendor/RoachSpeech/ModelPacks/RoachWhisper-${modelName}`
  )
  const sourceEncoderPath = resolveRepoPath(
    args.encoder || path.join(whisperCppModelsPath, `ggml-${modelName}-encoder.mlmodelc`)
  )

  requireCompiledModelBundle(sourceEncoderPath, 'whisper.cpp Core ML encoder')

  const packWhisperPath = path.join(outputRoot, 'RoachWhisper')
  fs.mkdirSync(packWhisperPath, { recursive: true })
  copyDirectory(sourceEncoderPath, path.join(packWhisperPath, 'RoachWhisperEncoder.mlmodelc'))

  const hasDecoder = typeof args.decoder === 'string'
  const hasTokenizer = typeof args.tokenizer === 'string'
  const hasParity = typeof args.parity === 'string'
  if (hasDecoder) {
    const decoderPath = resolveRepoPath(args.decoder)
    requireCompiledModelBundle(decoderPath, 'RoachNet native decoder')
    copyDirectory(decoderPath, path.join(packWhisperPath, 'RoachWhisperDecoder.mlmodelc'))
  }
  if (hasTokenizer) {
    copyFile(resolveRepoPath(args.tokenizer), path.join(packWhisperPath, 'RoachWhisperTokenizer.json'), 'RoachNet tokenizer')
  }
  if (hasParity) {
    copyFile(resolveRepoPath(args.parity), path.join(packWhisperPath, 'RoachWhisperParity.json'), 'RoachWhisper parity manifest')
  }

  const releaseReady = args['release-ready'] === true
  if (releaseReady) {
    throw new Error('whisper.cpp imports are staging/reference packs only. Use scripts/create-roachspeech-native-pack.mjs for release-ready RoachNet-owned packs.')
  }

  const manifest = {
    packID: args['pack-id'] || `roachwhisper-${modelName}-coreml`,
    displayName: args['display-name'] || `RoachWhisper ${modelName}`,
    version: args.version || '0.1.0',
    kind: 'roachWhisper',
    nativeFormat: 'coreML',
    features: ['speechToText'],
    noNetwork: true,
    noPackagedBinary: true,
    nativeInferenceReady: false,
    parityValidated: false,
    provenance: {
      upstreamProject: 'ggml-org/whisper.cpp',
      upstreamModelName: modelName,
      sourceFormat: `ggml-${modelName}-encoder.mlmodelc`,
      conversionCommand: `./models/generate-coreml-model.sh ${modelName}`,
      upstreamCommit: typeof args['upstream-commit'] === 'string' ? args['upstream-commit'] : null,
      importedAt: new Date().toISOString(),
    },
  }

  writeJson(path.join(outputRoot, 'RoachSpeechPack.json'), manifest)
  console.log(`Imported whisper.cpp Core ML encoder into ${path.relative(repoRoot, outputRoot)}`)
  if (!releaseReady) {
    console.log('Pack is staged only. Add RoachNet decoder/tokenizer/parity assets and rerun with --release-ready before shipping.')
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
