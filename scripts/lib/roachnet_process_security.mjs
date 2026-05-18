import path from 'node:path'

const SENSITIVE_KEY_PATTERN = /(PASSWORD|PASS|TOKEN|SECRET|CREDENTIAL|PRIVATE|AUTH|APP_KEY|API_KEY)/i
const SIMPLE_COMMAND_PATTERN = /^[A-Za-z0-9._+-]+$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

function uniqueSensitiveValues(env = {}) {
  return [
    ...new Set(
      Object.entries(env)
        .filter(([key, value]) => SENSITIVE_KEY_PATTERN.test(key) && typeof value === 'string' && value.length >= 4)
        .map(([, value]) => value)
    ),
  ].sort((left, right) => right.length - left.length)
}

function replaceAllLiteral(input, search, replacement) {
  return input.split(search).join(replacement)
}

export function redactSensitiveText(value, env = process.env) {
  let output = String(value ?? '')

  for (const secret of uniqueSensitiveValues(env)) {
    output = replaceAllLiteral(output, secret, '[redacted]')
  }

  output = output
    .replace(/\b(DB_PASSWORD|ROACHNET_DB_ROOT_PASSWORD|MYSQL_ROOT_PASSWORD|APP_KEY|API_KEY|TOKEN|SECRET)\s*=\s*[^\s"']+/gi, '$1=[redacted]')
    .replace(
      /\b(DB_PASSWORD|ROACHNET_DB_ROOT_PASSWORD|MYSQL_ROOT_PASSWORD|APP_KEY|API_KEY|TOKEN|SECRET)\s*:\s*("[^"]*"|'[^']*'|[^\s,}]+)/gi,
      '$1: [redacted]'
    )
    .replace(/(-p)([^\s]+)/g, '$1[redacted]')

  return output
}

export function redactSensitiveObject(value, env = process.env, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value, env)
  }

  if (typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item, env, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactSensitiveObject(entry, env, seen),
    ])
  )
}

function assertNoControlCharacters(value, label) {
  if (CONTROL_CHARACTER_PATTERN.test(String(value ?? ''))) {
    throw new Error(`${label} must not contain control characters.`)
  }
}

export function normalizeExecutableForSpawn(binary) {
  const rawBinary = String(binary || '').trim()
  if (!rawBinary || rawBinary.startsWith('-')) {
    throw new Error('Process command is empty or option-like.')
  }
  assertNoControlCharacters(rawBinary, 'Process command')

  const hasPathSeparator = rawBinary.includes('/') || rawBinary.includes('\\')
  if (!hasPathSeparator) {
    if (!SIMPLE_COMMAND_PATTERN.test(rawBinary)) {
      throw new Error('Process command must be a simple executable name.')
    }
    return rawBinary
  }

  const resolvedBinary = path.resolve(rawBinary)
  if (!path.isAbsolute(resolvedBinary)) {
    throw new Error('Process command path must resolve to an absolute path.')
  }
  return resolvedBinary
}

export function normalizeSpawnArguments(args = []) {
  if (!Array.isArray(args)) {
    throw new Error('Process arguments must be an array.')
  }

  return args.map((arg) => {
    const value = String(arg ?? '')
    assertNoControlCharacters(value, 'Process argument')
    return value
  })
}

export function normalizeProcessLaunch(binary, args = [], { shell = false } = {}) {
  if (shell) {
    throw new Error('RoachNet setup does not launch installer commands through a shell.')
  }

  return {
    binary: normalizeExecutableForSpawn(binary),
    args: normalizeSpawnArguments(args),
  }
}

export function commandForLog(binary, args = [], env = process.env) {
  return redactSensitiveText([path.basename(String(binary || 'command')), ...normalizeSpawnArguments(args)].join(' '), env)
}

export function normalizeRelativePathForCopyFilter(relativePath) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/')
  if (!normalizedPath || normalizedPath === '.') {
    return ''
  }
  if (path.posix.isAbsolute(normalizedPath) || path.isAbsolute(relativePath)) {
    return null
  }

  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.includes('..') || segments.some((segment) => CONTROL_CHARACTER_PATTERN.test(segment))) {
    return null
  }

  return segments.join('/')
}
