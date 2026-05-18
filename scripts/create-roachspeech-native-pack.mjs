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
    if (!token.startsWith('--')) continue
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

function hasNonEmptyFile(targetPath) {
  if (!fs.existsSync(targetPath)) return false
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) return stat.size > 0
  if (!stat.isDirectory()) return false
  return fs.readdirSync(targetPath, { withFileTypes: true }).some((entry) => hasNonEmptyFile(path.join(targetPath, entry.name)))
}

function requireCompiledModelBundle(bundlePath, label) {
  if (!fs.existsSync(bundlePath) || !fs.statSync(bundlePath).isDirectory() || !hasNonEmptyFile(bundlePath)) {
    throw new Error(`${label} must be a non-empty compiled Core ML bundle: ${bundlePath}`)
  }
}

function requireNonEmptyFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`${label} must be a non-empty file: ${filePath}`)
  }
}

function copyDirectory(sourcePath, destinationPath) {
  fs.rmSync(destinationPath, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true })
}

function copyFile(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.copyFileSync(sourcePath, destinationPath)
}

function writeJson(destinationPath, value) {
  fs.writeFileSync(destinationPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createRoachWhisperPack(args, outputRoot) {
  const encoderPath = resolveRepoPath(requireArg(args, 'encoder'))
  const decoderPath = resolveRepoPath(requireArg(args, 'decoder'))
  const tokenizerPath = resolveRepoPath(requireArg(args, 'tokenizer'))
  const parityPath = resolveRepoPath(requireArg(args, 'parity'))

  requireCompiledModelBundle(encoderPath, 'RoachWhisper encoder')
  requireCompiledModelBundle(decoderPath, 'RoachWhisper decoder')
  requireNonEmptyFile(tokenizerPath, 'RoachWhisper tokenizer')
  requireNonEmptyFile(parityPath, 'RoachWhisper parity manifest')

  const packRoot = path.join(outputRoot, 'RoachWhisper')
  copyDirectory(encoderPath, path.join(packRoot, 'RoachWhisperEncoder.mlmodelc'))
  copyDirectory(decoderPath, path.join(packRoot, 'RoachWhisperDecoder.mlmodelc'))
  copyFile(tokenizerPath, path.join(packRoot, 'RoachWhisperTokenizer.json'))
  copyFile(parityPath, path.join(packRoot, 'RoachWhisperParity.json'))

  return {
    kind: 'roachWhisper',
    features: ['speechToText', 'transcriptSidecars', 'lyricExtraction'],
    parityValidated: true,
    provenance: {
      upstreamProject: 'RoachWares/RoachNet',
      upstreamModelName: args['model-name'] || 'RoachWhisper',
      sourceFormat: 'RoachSpeech native Core ML pack',
      conversionCommand: 'node scripts/create-roachspeech-native-pack.mjs --kind roachWhisper',
      upstreamCommit: args['source-commit'] || null,
      importedAt: new Date().toISOString(),
      referenceProject: args.reference || 'ggml-org/whisper.cpp architecture reference',
    },
  }
}

function createRoachVoicePack(args, outputRoot) {
  const languageModelPath = typeof args['language-model'] === 'string' ? resolveRepoPath(args['language-model']) : null
  const conditionalDecoderPath = typeof args['conditional-decoder'] === 'string' ? resolveRepoPath(args['conditional-decoder']) : null
  const speechEncoderPath = typeof args['speech-encoder'] === 'string' ? resolveRepoPath(args['speech-encoder']) : null
  const embedTokensPath = typeof args['embed-tokens'] === 'string' ? resolveRepoPath(args['embed-tokens']) : null
  const tokenizerPath = typeof args.tokenizer === 'string' ? resolveRepoPath(args.tokenizer) : null
  const narratorPath = typeof args.narrator === 'string' ? resolveRepoPath(args.narrator) : null
  const acousticPath = typeof args.acoustic === 'string' ? resolveRepoPath(args.acoustic) : null
  const vocoderPath = typeof args.vocoder === 'string' ? resolveRepoPath(args.vocoder) : null
  const embeddingPath = resolveRepoPath(requireArg(args, 'embedding'))
  const g2pEncoderPath = typeof args['g2p-encoder'] === 'string' ? resolveRepoPath(args['g2p-encoder']) : null
  const g2pDecoderPath = typeof args['g2p-decoder'] === 'string' ? resolveRepoPath(args['g2p-decoder']) : null
  const chatterboxPaths = [languageModelPath, conditionalDecoderPath, speechEncoderPath, embedTokensPath, tokenizerPath]
  const hasPartialChatterboxStack = chatterboxPaths.some(Boolean)
  const hasChatterboxStack = chatterboxPaths.every(Boolean)

  if (hasPartialChatterboxStack && !hasChatterboxStack) {
    throw new Error('Chatterbox-Turbo RoachVoice packs require --language-model, --conditional-decoder, --speech-encoder, --embed-tokens, and --tokenizer together')
  }

  if (hasChatterboxStack) {
    requireCompiledModelBundle(languageModelPath, 'RoachVoice Chatterbox language model')
    requireCompiledModelBundle(conditionalDecoderPath, 'RoachVoice Chatterbox conditional decoder')
    requireCompiledModelBundle(speechEncoderPath, 'RoachVoice Chatterbox speech encoder')
    requireCompiledModelBundle(embedTokensPath, 'RoachVoice Chatterbox embed tokens model')
    requireNonEmptyFile(tokenizerPath, 'RoachVoice Chatterbox tokenizer')
  } else if (narratorPath) {
    requireCompiledModelBundle(narratorPath, 'RoachVoice narrator model')
  } else {
    if (!acousticPath || !vocoderPath) {
      throw new Error('RoachVoice packs require either a Chatterbox-Turbo stack, --narrator, or both --acoustic and --vocoder')
    }
    requireCompiledModelBundle(acousticPath, 'RoachVoice acoustic model')
    requireCompiledModelBundle(vocoderPath, 'RoachVoice vocoder model')
  }
  requireNonEmptyFile(embeddingPath, 'RoachVoice embedding')

  const packRoot = path.join(outputRoot, 'RoachVoice')
  if (hasChatterboxStack) {
    copyDirectory(languageModelPath, path.join(packRoot, 'RoachVoiceLanguageModel.mlmodelc'))
    copyDirectory(conditionalDecoderPath, path.join(packRoot, 'RoachVoiceConditionalDecoder.mlmodelc'))
    copyDirectory(speechEncoderPath, path.join(packRoot, 'RoachVoiceSpeechEncoder.mlmodelc'))
    copyDirectory(embedTokensPath, path.join(packRoot, 'RoachVoiceEmbedTokens.mlmodelc'))
    copyFile(tokenizerPath, path.join(packRoot, 'RoachVoiceTokenizer.json'))
  } else if (narratorPath) {
    copyDirectory(narratorPath, path.join(packRoot, 'RoachVoiceNarrator.mlmodelc'))
  } else {
    copyDirectory(acousticPath, path.join(packRoot, 'RoachVoiceAcoustic.mlmodelc'))
    copyDirectory(vocoderPath, path.join(packRoot, 'RoachVoiceVocoder.mlmodelc'))
  }
  if (g2pEncoderPath) {
    requireCompiledModelBundle(g2pEncoderPath, 'RoachVoice G2P encoder')
    copyDirectory(g2pEncoderPath, path.join(packRoot, 'RoachVoiceG2PEncoder.mlmodelc'))
  }
  if (g2pDecoderPath) {
    requireCompiledModelBundle(g2pDecoderPath, 'RoachVoice G2P decoder')
    copyDirectory(g2pDecoderPath, path.join(packRoot, 'RoachVoiceG2PDecoder.mlmodelc'))
  }
  copyFile(embeddingPath, path.join(packRoot, 'RoachVoiceEmbedding.json'))

  const features = ['customVoiceSynthesis']
  if (hasChatterboxStack || args['voice-cloning'] === true || args['voice-cloning'] === 'true') {
    features.push('voiceCloning')
  }
  if (hasChatterboxStack) {
    features.push('paralinguisticTags', 'watermarking')
  }

  return {
    kind: 'roachVoice',
    features,
    parityValidated: false,
    provenance: {
      upstreamProject: 'RoachWares/RoachNet',
      upstreamModelName: args['model-name'] || (hasChatterboxStack ? 'RoachVoice Chatterbox-Turbo' : 'RoachVoice'),
      sourceFormat: hasChatterboxStack
        ? 'RoachSpeech native Core ML Chatterbox-Turbo pack'
        : narratorPath
          ? 'RoachSpeech native Core ML narrator pack'
          : 'RoachSpeech native Core ML split synthesis pack',
      conversionCommand: 'node scripts/create-roachspeech-native-pack.mjs --kind roachVoice',
      upstreamCommit: args['source-commit'] || null,
      importedAt: new Date().toISOString(),
      referenceProject: args.reference || (hasChatterboxStack ? 'ResembleAI/chatterbox-turbo MIT reference' : null),
    },
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const kind = requireArg(args, 'kind')
  if (!['roachWhisper', 'roachVoice'].includes(kind)) {
    throw new Error('--kind must be roachWhisper or roachVoice')
  }

  const packID = requireArg(args, 'pack-id')
  const displayName = requireArg(args, 'display-name')
  const version = requireArg(args, 'version')
  const outputRoot = resolveRepoPath(args.output || `native/macos/Vendor/RoachSpeech/ModelPacks/${packID}`)

  fs.rmSync(outputRoot, { recursive: true, force: true })
  fs.mkdirSync(outputRoot, { recursive: true })

  const pack = kind === 'roachWhisper'
    ? createRoachWhisperPack(args, outputRoot)
    : createRoachVoicePack(args, outputRoot)

  writeJson(path.join(outputRoot, 'RoachSpeechPack.json'), {
    packID,
    displayName,
    version,
    kind,
    nativeFormat: 'coreML',
    features: pack.features,
    noNetwork: true,
    noPackagedBinary: true,
    nativeInferenceReady: true,
    parityValidated: pack.parityValidated,
    provenance: pack.provenance,
  })

  console.log(`Created RoachNet-owned ${kind} pack at ${path.relative(repoRoot, outputRoot)}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
