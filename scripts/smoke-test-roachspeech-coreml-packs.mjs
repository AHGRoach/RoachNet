#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const whisperPack = process.argv[2] || path.join(
  repoRoot,
  'native/macos/Vendor/RoachSpeech/ModelPacks/roachwhisper-openai-whisper-base-en-coreml/RoachWhisper'
)

const swiftSource = `
import Foundation
import CoreML

func fill(_ array: MLMultiArray, _ value: NSNumber) {
    for index in 0..<array.count { array[index] = value }
}

let root = URL(fileURLWithPath: ${JSON.stringify(whisperPack)}, isDirectory: true)
let configuration = MLModelConfiguration()
configuration.computeUnits = .cpuAndNeuralEngine
let mel = try MLModel(contentsOf: root.appendingPathComponent("RoachWhisperMelSpectrogram.mlmodelc", isDirectory: true), configuration: configuration)
let encoder = try MLModel(contentsOf: root.appendingPathComponent("RoachWhisperEncoder.mlmodelc", isDirectory: true), configuration: configuration)
let decoder = try MLModel(contentsOf: root.appendingPathComponent("RoachWhisperDecoder.mlmodelc", isDirectory: true), configuration: configuration)

let audio = try MLMultiArray(shape: [480000], dataType: .float16)
fill(audio, 0)
let melOutput = try mel.prediction(from: MLDictionaryFeatureProvider(dictionary: [
    "audio": MLFeatureValue(multiArray: audio)
]))
guard let features = melOutput.featureValue(for: "melspectrogram_features")?.multiArrayValue else {
    throw NSError(domain: "RoachSpeechSmoke", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing melspectrogram_features"])
}

let encoderOutput = try encoder.prediction(from: MLDictionaryFeatureProvider(dictionary: [
    "melspectrogram_features": MLFeatureValue(multiArray: features)
]))
guard let embeds = encoderOutput.featureValue(for: "encoder_output_embeds")?.multiArrayValue else {
    throw NSError(domain: "RoachSpeechSmoke", code: 2, userInfo: [NSLocalizedDescriptionKey: "missing encoder_output_embeds"])
}

let inputIDs = try MLMultiArray(shape: [1], dataType: .int32)
inputIDs[0] = 50257
let cacheLength = try MLMultiArray(shape: [1], dataType: .int32)
cacheLength[0] = 0
let keyCache = try MLMultiArray(shape: [1, 3072, 1, 224], dataType: .float16)
let valueCache = try MLMultiArray(shape: [1, 3072, 1, 224], dataType: .float16)
fill(keyCache, 0)
fill(valueCache, 0)
let updateMask = try MLMultiArray(shape: [1, 224], dataType: .float16)
let paddingMask = try MLMultiArray(shape: [1, 224], dataType: .float16)
fill(updateMask, 0)
fill(paddingMask, -10000)
updateMask[0] = 1
paddingMask[0] = 0

let decoderOutput = try decoder.prediction(from: MLDictionaryFeatureProvider(dictionary: [
    "input_ids": MLFeatureValue(multiArray: inputIDs),
    "cache_length": MLFeatureValue(multiArray: cacheLength),
    "key_cache": MLFeatureValue(multiArray: keyCache),
    "value_cache": MLFeatureValue(multiArray: valueCache),
    "kv_cache_update_mask": MLFeatureValue(multiArray: updateMask),
    "encoder_output_embeds": MLFeatureValue(multiArray: embeds),
    "decoder_key_padding_mask": MLFeatureValue(multiArray: paddingMask),
]))
guard let logits = decoderOutput.featureValue(for: "logits")?.multiArrayValue else {
    throw NSError(domain: "RoachSpeechSmoke", code: 3, userInfo: [NSLocalizedDescriptionKey: "missing logits"])
}
guard let keyUpdates = decoderOutput.featureValue(for: "key_cache_updates")?.multiArrayValue else {
    throw NSError(domain: "RoachSpeechSmoke", code: 4, userInfo: [NSLocalizedDescriptionKey: "missing key_cache_updates"])
}

print("RoachWhisper Core ML smoke passed")
print("mel=\\(features.shape.map(String.init).joined(separator: "x"))")
print("encoder=\\(embeds.shape.map(String.init).joined(separator: "x"))")
print("decoder=\\(logits.shape.map(String.init).joined(separator: "x"))")
print("key_cache_updates=\\(keyUpdates.shape.map(String.init).joined(separator: "x"))")
`

const result = spawnSync('swift', ['-'], {
  cwd: repoRoot,
  input: swiftSource,
  encoding: 'utf8',
  timeout: 120_000,
})

if (result.status !== 0) {
  console.error('RoachSpeech Core ML smoke failed.')
  if (result.stdout) console.error(result.stdout.trim())
  if (result.stderr) console.error(result.stderr.trim())
  process.exit(result.status || 1)
}

process.stdout.write(result.stdout)
