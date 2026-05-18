import assert from 'node:assert/strict'
import test from 'node:test'

import {
  APPLE_SILICON_LOCAL_AI_PROFILE,
  appleSiliconLocalAIDefaults,
  applyAppleSiliconLocalAIDefaults,
} from '../lib/roachnet_local_ai_runtime.mjs'

test('appleSiliconLocalAIDefaults are only enabled for native Apple Silicon', () => {
  assert.deepEqual(appleSiliconLocalAIDefaults({ platform: 'linux', arch: 'arm64', env: {} }), {})
  assert.deepEqual(appleSiliconLocalAIDefaults({ platform: 'darwin', arch: 'x64', env: {} }), {})

  const defaults = appleSiliconLocalAIDefaults({ platform: 'darwin', arch: 'arm64', env: {} })
  assert.equal(defaults.ROACHNET_APPLE_SILICON_NATIVE, '1')
  assert.equal(defaults.ROACHNET_LOCAL_AI_PROFILE, APPLE_SILICON_LOCAL_AI_PROFILE)
  assert.equal(defaults.OLLAMA_FLASH_ATTENTION, '1')
  assert.equal(defaults.OLLAMA_NUM_PARALLEL, '1')
  assert.equal(defaults.OLLAMA_MAX_LOADED_MODELS, '1')
})

test('applyAppleSiliconLocalAIDefaults preserves explicit RoachClaw/Ollama tuning', () => {
  const env = {
    OLLAMA_MAX_QUEUE: '8',
    OLLAMA_KEEP_ALIVE: '30m',
  }
  const result = applyAppleSiliconLocalAIDefaults(
    {
      OLLAMA_NUM_PARALLEL: '2',
    },
    { platform: 'darwin', arch: 'arm64', env }
  )

  assert.equal(result.OLLAMA_NUM_PARALLEL, '2')
  assert.equal(result.OLLAMA_MAX_QUEUE, '8')
  assert.equal(result.OLLAMA_KEEP_ALIVE, '30m')
  assert.equal(result.OLLAMA_MAX_LOADED_MODELS, '1')
  assert.equal(result.ROACHNET_LOCAL_AI_PROFILE, APPLE_SILICON_LOCAL_AI_PROFILE)
})

test('applyAppleSiliconLocalAIDefaults honors the disable escape hatch', () => {
  const result = applyAppleSiliconLocalAIDefaults(
    {
      ROACHNET_DISABLE_APPLE_SILICON_AI_DEFAULTS: '1',
    },
    { platform: 'darwin', arch: 'arm64', env: {} }
  )

  assert.deepEqual(result, {
    ROACHNET_DISABLE_APPLE_SILICON_AI_DEFAULTS: '1',
  })
})
