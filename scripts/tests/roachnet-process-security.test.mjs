import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  commandForLog,
  normalizeProcessLaunch,
  normalizeRelativePathForCopyFilter,
  redactSensitiveObject,
  redactSensitiveText,
} from '../lib/roachnet_process_security.mjs'

test('redactSensitiveText strips process secrets and password-style output', () => {
  const env = {
    DB_PASSWORD: 'db-secret-value',
    ROACHNET_DB_ROOT_PASSWORD: 'root-secret-value',
    MYSQL_ROOT_PASSWORD: 'mysql-root-secret',
    ROACHNET_PUBLIC_VALUE: 'safe',
  }

  const output = redactSensitiveText(
    'DB_PASSWORD=db-secret-value ROACHNET_DB_ROOT_PASSWORD: "root-secret-value" MYSQL_ROOT_PASSWORD=mysql-root-secret mysql -proot-secret-value',
    env
  )

  assert.equal(output.includes('db-secret-value'), false)
  assert.equal(output.includes('root-secret-value'), false)
  assert.equal(output.includes('mysql-root-secret'), false)
  assert.equal(output.includes('[redacted]'), true)
})

test('redactSensitiveObject redacts sensitive keys recursively', () => {
  assert.deepEqual(
    redactSensitiveObject({
      port: 8080,
      nested: {
        DB_PASSWORD: 'secret',
        logs: ['token=visible'],
      },
    }),
    {
      port: 8080,
      nested: {
        DB_PASSWORD: '[redacted]',
        logs: ['token=[redacted]'],
      },
    }
  )
})

test('normalizeProcessLaunch refuses shell launches and unsafe executable names', () => {
  assert.deepEqual(normalizeProcessLaunch('git', ['status']).args, ['status'])
  assert.equal(normalizeProcessLaunch(path.resolve('/bin/echo'), ['hello']).binary, path.resolve('/bin/echo'))

  assert.throws(() => normalizeProcessLaunch('git status', []), /simple executable/)
  assert.throws(() => normalizeProcessLaunch('--help', []), /empty or option-like/)
  assert.throws(() => normalizeProcessLaunch('git', ['status\nrm -rf /']), /control characters/)
  assert.throws(() => normalizeProcessLaunch('git', ['status'], { shell: true }), /does not launch/)
})

test('commandForLog redacts inline secret arguments', () => {
  assert.equal(commandForLog('/usr/bin/mysql', ['-proot-secret'], { MYSQL_PASSWORD: 'root-secret' }), 'mysql -p[redacted]')
})

test('normalizeRelativePathForCopyFilter rejects traversal and normalizes separators', () => {
  assert.equal(normalizeRelativePathForCopyFilter('native\\macos\\Sources'), 'native/macos/Sources')
  assert.equal(normalizeRelativePathForCopyFilter('admin/public'), 'admin/public')
  assert.equal(normalizeRelativePathForCopyFilter('../secrets'), null)
  assert.equal(normalizeRelativePathForCopyFilter('/tmp/secrets'), null)
  assert.equal(normalizeRelativePathForCopyFilter('admin/\u0000.env'), null)
})
