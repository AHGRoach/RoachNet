export const APPLE_SILICON_LOCAL_AI_PROFILE = 'apple-silicon-efficient'

export const APPLE_SILICON_LOCAL_AI_DEFAULTS = Object.freeze({
  OLLAMA_FLASH_ATTENTION: '1',
  OLLAMA_KEEP_ALIVE: '15m',
  OLLAMA_MAX_LOADED_MODELS: '1',
  OLLAMA_MAX_QUEUE: '32',
  OLLAMA_NUM_PARALLEL: '1',
  ROACHNET_APPLE_SILICON_NATIVE: '1',
  ROACHNET_LOCAL_AI_PROFILE: APPLE_SILICON_LOCAL_AI_PROFILE,
})

function hasMeaningfulValue(value) {
  return value !== undefined && value !== null && String(value).trim().length > 0
}

function isAppleSiliconRuntime({ platform = process.platform, arch = process.arch } = {}) {
  return platform === 'darwin' && arch === 'arm64'
}

function appleSiliconDefaultsDisabled(values = {}, env = process.env) {
  return (
    values.ROACHNET_DISABLE_APPLE_SILICON_AI_DEFAULTS === '1' ||
    env.ROACHNET_DISABLE_APPLE_SILICON_AI_DEFAULTS === '1'
  )
}

export function appleSiliconLocalAIDefaults(options = {}) {
  const env = options.env || process.env
  if (!isAppleSiliconRuntime(options) || appleSiliconDefaultsDisabled({}, env)) {
    return {}
  }

  return { ...APPLE_SILICON_LOCAL_AI_DEFAULTS }
}

export function applyAppleSiliconLocalAIDefaults(values = {}, options = {}) {
  const env = options.env || process.env
  if (!isAppleSiliconRuntime(options) || appleSiliconDefaultsDisabled(values, env)) {
    return { ...values }
  }

  const next = { ...values }
  for (const [key, defaultValue] of Object.entries(APPLE_SILICON_LOCAL_AI_DEFAULTS)) {
    if (hasMeaningfulValue(next[key])) {
      continue
    }

    if (hasMeaningfulValue(env[key])) {
      next[key] = String(env[key])
      continue
    }

    next[key] = defaultValue
  }

  return next
}
