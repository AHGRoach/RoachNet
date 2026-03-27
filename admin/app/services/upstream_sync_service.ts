import app from '@adonisjs/core/services/app'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { UpstreamSyncStatus } from '../../types/system.js'

const execFileAsync = promisify(execFile)

type GitResult = {
  stdout: string
  stderr: string
}

type UpstreamSyncMetadata = {
  upstreamRepo: string
  upstreamBranch: string
  trackedUpstreamCommit: string
}

export class UpstreamSyncService {
  private static readonly DEFAULT_UPSTREAM_BRANCH = 'upstream/main'
  private static readonly STATUS_FILE = 'upstream-sync-status.json'
  private static readonly LOG_FILE = 'upstream-sync.log'
  private static readonly METADATA_FILE = 'roachnet.upstream.json'
  private static readonly COMMAND_TIMEOUT_MS = 20_000
  private static readonly OVERLAY_PATCH_EXCLUDES = [
    'README.md',
    'FAQ.md',
    'CONTRIBUTING.md',
    'docs/**',
    'admin/docs/**',
  ]
  private static readonly OVERLAY_COPY_PATHS = [
    'README.md',
    'FAQ.md',
    'CONTRIBUTING.md',
    'docs',
    'admin/docs',
  ]
  private running = false

  private getAdminRoot(): string {
    const cwd = process.cwd()

    if (existsSync(join(cwd, 'ace.js'))) {
      return cwd
    }

    return app.makePath()
  }

  private getRepoRoot(): string | null {
    let current = resolve(this.getAdminRoot())

    while (true) {
      if (existsSync(join(current, '.git'))) {
        return current
      }

      const parent = dirname(current)
      if (parent === current) {
        return null
      }
      current = parent
    }
  }

  private getLogsDir(): string {
    return join(this.getAdminRoot(), 'storage', 'logs')
  }

  private getStatusFilePath(): string {
    return join(this.getLogsDir(), UpstreamSyncService.STATUS_FILE)
  }

  private getLogFilePath(): string {
    return join(this.getLogsDir(), UpstreamSyncService.LOG_FILE)
  }

  private getMetadataFilePath(repoRoot: string): string {
    return join(repoRoot, UpstreamSyncService.METADATA_FILE)
  }

  private ensureLogStorage(): void {
    mkdirSync(this.getLogsDir(), { recursive: true })
  }

  private async appendLog(message: string): Promise<void> {
    this.ensureLogStorage()
    const line = `[${new Date().toISOString()}] ${message}\n`
    await appendFile(this.getLogFilePath(), line, 'utf8')
  }

  private writeStatus(status: UpstreamSyncStatus): void {
    this.ensureLogStorage()
    writeFileSync(this.getStatusFilePath(), JSON.stringify(status, null, 2), 'utf8')
  }

  private warn(message: string): void {
    console.warn(`[UpstreamSyncService] ${message}`)
  }

  private readCachedStatus(): UpstreamSyncStatus | null {
    try {
      const filePath = this.getStatusFilePath()
      if (!existsSync(filePath)) {
        return null
      }

      return JSON.parse(readFileSync(filePath, 'utf8')) as UpstreamSyncStatus
    } catch (error) {
      this.warn(`Failed to parse cached status: ${error instanceof Error ? error.message : error}`)
      return null
    }
  }

  private readMetadata(repoRoot: string): UpstreamSyncMetadata | null {
    try {
      const filePath = this.getMetadataFilePath(repoRoot)
      if (!existsSync(filePath)) {
        return null
      }

      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<UpstreamSyncMetadata>
      if (!raw.trackedUpstreamCommit) {
        return null
      }

      return {
        upstreamRepo: raw.upstreamRepo || 'https://github.com/Crosstalk-Solutions/project-nomad.git',
        upstreamBranch: raw.upstreamBranch || UpstreamSyncService.DEFAULT_UPSTREAM_BRANCH,
        trackedUpstreamCommit: raw.trackedUpstreamCommit,
      }
    } catch (error) {
      this.warn(`Failed to parse upstream metadata: ${error instanceof Error ? error.message : error}`)
      return null
    }
  }

  private writeMetadata(repoRoot: string, metadata: UpstreamSyncMetadata): void {
    writeFileSync(
      this.getMetadataFilePath(repoRoot),
      JSON.stringify(metadata, null, 2) + '\n',
      'utf8'
    )
  }

  private formatCommandError(error: unknown, fallback: string): string {
    if (!error || typeof error !== 'object') {
      return fallback
    }

    const message = 'message' in error && typeof error.message === 'string' ? error.message : fallback
    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : ''
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const detail = stderr || stdout

    if (!detail) {
      return message
    }

    return `${message} :: ${detail.split('\n').slice(-4).join(' | ')}`
  }

  private getDefaultStatus(
    message: string,
    repoRoot: string | null,
    upstreamBranch: string = UpstreamSyncService.DEFAULT_UPSTREAM_BRANCH
  ): UpstreamSyncStatus {
    return {
      stage: this.running ? 'syncing' : 'idle',
      progress: 0,
      message,
      timestamp: new Date().toISOString(),
      supported: false,
      canSync: false,
      syncAvailable: false,
      currentBranch: null,
      currentCommit: null,
      upstreamBranch,
      upstreamCommit: null,
      baseUpstreamCommit: null,
      mergeBase: null,
      patchsetCommits: 0,
      upstreamCommitsAhead: 0,
      hasTrackedChanges: false,
      backupBranch: null,
      repoRoot,
    }
  }

  private async runGit(args: string[], cwd: string): Promise<GitResult> {
    const env = {
      ...process.env,
      GIT_EDITOR: 'true',
      GIT_TERMINAL_PROMPT: '0',
    }

    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      env,
      timeout: UpstreamSyncService.COMMAND_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    })

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }
  }

  private async tryGitValue(args: string[], cwd: string): Promise<string | null> {
    try {
      const result = await this.runGit(args, cwd)
      return result.stdout || null
    } catch {
      return null
    }
  }

  private async remoteExists(repoRoot: string, remoteName: string): Promise<boolean> {
    try {
      await this.runGit(['remote', 'get-url', remoteName], repoRoot)
      return true
    } catch {
      return false
    }
  }

  private async fetchUpstream(repoRoot: string): Promise<void> {
    await this.runGit(['fetch', 'upstream', 'main', '--quiet'], repoRoot)
  }

  private async buildPatch(repoRoot: string, baseCommit: string, currentCommit: string): Promise<string> {
    const diffArgs = ['diff', '--binary', `${baseCommit}..${currentCommit}`, '--', '.']

    for (const excludedPath of UpstreamSyncService.OVERLAY_PATCH_EXCLUDES) {
      diffArgs.push(`:(exclude)${excludedPath}`)
    }

    const { stdout } = await execFileAsync('git', diffArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout: 10 * 60_000,
      maxBuffer: 100 * 1024 * 1024,
    })

    return stdout
  }

  private async syncOverlayManagedPaths(sourceRepoRoot: string, targetRepoRoot: string): Promise<void> {
    for (const relativePath of UpstreamSyncService.OVERLAY_COPY_PATHS) {
      const sourcePath = join(sourceRepoRoot, relativePath)
      const targetPath = join(targetRepoRoot, relativePath)

      await rm(targetPath, { recursive: true, force: true })

      if (existsSync(sourcePath)) {
        mkdirSync(dirname(targetPath), { recursive: true })
        await cp(sourcePath, targetPath, { recursive: true, force: true })
        await this.appendLog(`Preserved RoachNet overlay path ${relativePath}`)
      } else {
        await this.appendLog(`Overlay path ${relativePath} does not exist in the source checkout and was removed`)
      }

      await this.runGit(['add', '-A', '--', relativePath], targetRepoRoot)
    }
  }

  private async runAdminCheck(scriptName: 'typecheck' | 'build', adminRoot: string): Promise<void> {
    const npmBinary = existsSync('/opt/homebrew/opt/node@22/bin/npm')
      ? '/opt/homebrew/opt/node@22/bin/npm'
      : 'npm'

    await this.appendLog(`Running admin ${scriptName} in ${adminRoot}`)

    const result = await execFileAsync(npmBinary, ['run', scriptName], {
      cwd: adminRoot,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/opt/node@22/bin:${process.env.PATH || ''}`,
      },
      timeout: 10 * 60_000,
      maxBuffer: 50 * 1024 * 1024,
    })

    if (result.stdout.trim()) {
      await this.appendLog(result.stdout.trim())
    }
    if (result.stderr.trim()) {
      await this.appendLog(result.stderr.trim())
    }
  }

  private async ensureAdminDependencies(sourceAdminRoot: string, targetAdminRoot: string): Promise<void> {
    const targetNodeModules = join(targetAdminRoot, 'node_modules')
    const targetTscBinary = join(targetNodeModules, '.bin', 'tsc')

    if (existsSync(targetTscBinary)) {
      await this.appendLog(`Temporary admin worktree already has dependencies at ${targetNodeModules}`)
      return
    }

    const sourceNodeModules = join(sourceAdminRoot, 'node_modules')
    const sourceLockfilePath = join(sourceAdminRoot, 'package-lock.json')
    const targetLockfilePath = join(targetAdminRoot, 'package-lock.json')

    if (
      existsSync(sourceNodeModules) &&
      existsSync(sourceLockfilePath) &&
      existsSync(targetLockfilePath) &&
      readFileSync(sourceLockfilePath, 'utf8') === readFileSync(targetLockfilePath, 'utf8')
    ) {
      await rm(targetNodeModules, { recursive: true, force: true })
      symlinkSync(sourceNodeModules, targetNodeModules, 'dir')
      await this.appendLog(
        `Linked admin/node_modules from ${sourceNodeModules} into temporary worktree ${targetNodeModules}`
      )
      return
    }

    const npmBinary = existsSync('/opt/homebrew/opt/node@22/bin/npm')
      ? '/opt/homebrew/opt/node@22/bin/npm'
      : 'npm'

    await this.appendLog(`Installing admin dependencies in ${targetAdminRoot} with npm ci --prefer-offline`)

    const result = await execFileAsync(npmBinary, ['ci', '--prefer-offline'], {
      cwd: targetAdminRoot,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/opt/node@22/bin:${process.env.PATH || ''}`,
      },
      timeout: 10 * 60_000,
      maxBuffer: 50 * 1024 * 1024,
    })

    if (result.stdout.trim()) {
      await this.appendLog(result.stdout.trim())
    }

    if (result.stderr.trim()) {
      await this.appendLog(result.stderr.trim())
    }
  }

  private async syncBuiltArtifacts(sourceAdminRoot: string, targetAdminRoot: string): Promise<void> {
    const paths: Array<{ source: string; target: string; label: string }> = [
      {
        source: join(sourceAdminRoot, 'build'),
        target: join(targetAdminRoot, 'build'),
        label: 'compiled admin server',
      },
      {
        source: join(sourceAdminRoot, 'public', 'assets'),
        target: join(targetAdminRoot, 'public', 'assets'),
        label: 'compiled frontend assets',
      },
    ]

    for (const entry of paths) {
      if (!existsSync(entry.source)) {
        await this.appendLog(`Skip ${entry.label}: ${entry.source} does not exist in the temporary worktree`)
        continue
      }

      await rm(entry.target, { recursive: true, force: true })
      await cp(entry.source, entry.target, { recursive: true, force: true })
      await this.appendLog(`Copied ${entry.label} from ${entry.source} to ${entry.target}`)
    }
  }

  private async buildStatus(forceFetch: boolean): Promise<UpstreamSyncStatus> {
    const repoRoot = this.getRepoRoot()

    if (!repoRoot) {
      return this.getDefaultStatus('RoachNet is not running from a git checkout.', null)
    }

    const metadata = this.readMetadata(repoRoot)
    if (!metadata) {
      return this.getDefaultStatus(
        `Missing ${UpstreamSyncService.METADATA_FILE}. Upstream sync cannot determine the tracked source baseline.`,
        repoRoot
      )
    }

    const upstreamBranch = metadata.upstreamBranch || UpstreamSyncService.DEFAULT_UPSTREAM_BRANCH

    const hasUpstreamRemote = await this.remoteExists(repoRoot, 'upstream')
    if (!hasUpstreamRemote) {
      return this.getDefaultStatus('No upstream git remote is configured for this checkout.', repoRoot, upstreamBranch)
    }

    if (forceFetch) {
      try {
        await this.appendLog(`Fetching latest refs from ${upstreamBranch}`)
        await this.fetchUpstream(repoRoot)
      } catch (error) {
        await this.appendLog(
          `Fetch warning: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    const [
      currentBranch,
      currentCommit,
      upstreamCommit,
      trackedUpstreamCommit,
      mergeBase,
      trackedStatus,
    ] = await Promise.all([
      this.tryGitValue(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot),
      this.tryGitValue(['rev-parse', 'HEAD'], repoRoot),
      this.tryGitValue(['rev-parse', upstreamBranch], repoRoot),
      this.tryGitValue(['rev-parse', metadata.trackedUpstreamCommit], repoRoot),
      this.tryGitValue(['merge-base', 'HEAD', upstreamBranch], repoRoot),
      this.tryGitValue(['status', '--porcelain', '--untracked-files=no'], repoRoot),
    ])

    if (!trackedUpstreamCommit) {
      return this.getDefaultStatus(
        `Tracked upstream commit ${metadata.trackedUpstreamCommit} could not be resolved. Fetch upstream refs and verify ${UpstreamSyncService.METADATA_FILE}.`,
        repoRoot,
        upstreamBranch
      )
    }

    const hasTrackedChanges = Boolean(trackedStatus)
    const currentBranchUsable = Boolean(currentBranch && currentBranch !== 'HEAD')

    const patchsetCommits = Number(
      (await this.tryGitValue(['rev-list', '--count', `${trackedUpstreamCommit}..HEAD`], repoRoot)) || '0'
    )
    const upstreamCommitsAhead = Number(
      (
        await this.tryGitValue(['rev-list', '--count', `${trackedUpstreamCommit}..${upstreamBranch}`], repoRoot)
      ) || '0'
    )

    const cachedStatus = this.readCachedStatus()
    const stage = this.running
      ? cachedStatus?.stage || 'syncing'
      : cachedStatus?.stage === 'error'
        ? 'error'
        : cachedStatus?.stage === 'complete'
          ? 'complete'
          : 'idle'
    const progress = this.running
      ? cachedStatus?.progress || 10
      : cachedStatus?.stage === 'complete'
        ? 100
        : 0
    const backupBranch = cachedStatus?.backupBranch || null

    let message = 'RoachNet patchset is aligned with the tracked upstream source.'
    if (!currentBranchUsable) {
      message = 'Upstream sync requires a named git branch. Detached HEAD checkouts are not supported.'
    } else if (!upstreamCommit) {
      message = `Unable to resolve ${upstreamBranch}. Fetch upstream refs and try again.`
    } else if (hasTrackedChanges) {
      message = 'Tracked local changes must be committed or reverted before syncing upstream.'
    } else if (upstreamCommitsAhead > 0) {
      message = `The upstream source has ${upstreamCommitsAhead} commit(s) ready to sync into ${currentBranch}.`
    }

    return {
      stage,
      progress,
      message,
      timestamp: cachedStatus?.timestamp || new Date().toISOString(),
      supported: currentBranchUsable && Boolean(upstreamCommit) && Boolean(trackedUpstreamCommit),
      canSync:
        !this.running &&
        currentBranchUsable &&
        Boolean(upstreamCommit) &&
        Boolean(trackedUpstreamCommit) &&
        !hasTrackedChanges &&
        upstreamCommitsAhead > 0,
      syncAvailable: upstreamCommitsAhead > 0,
      currentBranch: currentBranchUsable ? currentBranch : currentBranch,
      currentCommit,
      upstreamBranch,
      upstreamCommit,
      baseUpstreamCommit: trackedUpstreamCommit,
      mergeBase,
      patchsetCommits,
      upstreamCommitsAhead,
      hasTrackedChanges,
      backupBranch,
      repoRoot,
    }
  }

  async getStatus(forceFetch: boolean = false): Promise<UpstreamSyncStatus> {
    return this.buildStatus(forceFetch)
  }

  getLogs(): string {
    try {
      const filePath = this.getLogFilePath()
      if (!existsSync(filePath)) {
        return 'No upstream sync logs available.'
      }

      return readFileSync(filePath, 'utf8')
    } catch (error) {
      return `Failed to read upstream sync logs: ${error instanceof Error ? error.message : error}`
    }
  }

  async requestSync(): Promise<{ success: boolean; message: string }> {
    const status = await this.buildStatus(true)

    if (this.running) {
      return {
        success: false,
        message: 'An upstream sync is already in progress.',
      }
    }

    if (!status.supported || !status.canSync) {
      return {
        success: false,
        message: status.message,
      }
    }

    this.running = true
    void this.runSync(status)

    return {
      success: true,
      message: 'Upstream sync started. RoachNet will replay its patchset onto a refreshed upstream worktree in the background.',
    }
  }

  private async runSync(initialStatus: UpstreamSyncStatus): Promise<void> {
    const repoRoot = initialStatus.repoRoot
    const currentBranch = initialStatus.currentBranch
    const currentCommit = initialStatus.currentCommit
    const baseUpstreamCommit = initialStatus.baseUpstreamCommit
    const upstreamBranch = initialStatus.upstreamBranch

    if (!repoRoot || !currentBranch || !currentCommit || !baseUpstreamCommit) {
      this.running = false
      return
    }

    const backupBranch = `roachnet/upstream-sync-backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .replace('Z', '')}`

    let tempWorktreePath: string | null = null

    try {
      this.ensureLogStorage()
      await rm(this.getLogFilePath(), { force: true })
      await this.appendLog(`Starting upstream sync for branch ${currentBranch}`)

      this.writeStatus({
        ...initialStatus,
        stage: 'syncing',
        progress: 10,
        message: `Fetching upstream and creating backup branch ${backupBranch}.`,
        timestamp: new Date().toISOString(),
        backupBranch,
      })

      await this.fetchUpstream(repoRoot)
      await this.appendLog(`Fetched ${upstreamBranch} successfully`)

      await this.runGit(['branch', backupBranch, currentCommit], repoRoot)
      await this.appendLog(`Created backup branch ${backupBranch}`)

      const patchContents = await this.buildPatch(repoRoot, baseUpstreamCommit, currentCommit)
      await this.appendLog(
        `Generated RoachNet patchset from ${baseUpstreamCommit}..${currentCommit} (${patchContents.length} bytes)`
      )

      tempWorktreePath = await mkdtemp(join(tmpdir(), 'roachnet-upstream-sync-'))
      await this.runGit(['worktree', 'add', '--detach', tempWorktreePath, upstreamBranch], repoRoot)
      await this.appendLog(`Created temporary upstream worktree at ${tempWorktreePath}`)

      this.writeStatus({
        ...initialStatus,
        stage: 'syncing',
        progress: 35,
        message: 'Applying the RoachNet patchset to a fresh upstream worktree.',
        timestamp: new Date().toISOString(),
        backupBranch,
      })

      const patchFilePath = join(tempWorktreePath, '.roachnet-upstream.patch')
      writeFileSync(patchFilePath, patchContents, 'utf8')

      if (patchContents.trim()) {
        await this.runGit(['apply', '--3way', '--index', patchFilePath], tempWorktreePath)
        await this.appendLog('Applied RoachNet patchset with git apply --3way --index')
      } else {
        await this.appendLog('Patchset diff is empty. Only upstream baseline metadata will be advanced.')
      }

      await this.syncOverlayManagedPaths(repoRoot, tempWorktreePath)
      await this.appendLog('Reapplied RoachNet-owned documentation and branding overlays')

      const tempMetadata = this.readMetadata(tempWorktreePath)
      if (!tempMetadata) {
        throw new Error(`Temporary worktree is missing ${UpstreamSyncService.METADATA_FILE}`)
      }

      const latestUpstreamCommit = await this.tryGitValue(['rev-parse', upstreamBranch], tempWorktreePath)
      if (!latestUpstreamCommit) {
        throw new Error(`Unable to resolve ${upstreamBranch} inside the temporary worktree`)
      }

      this.writeMetadata(tempWorktreePath, {
        ...tempMetadata,
        upstreamBranch,
        trackedUpstreamCommit: latestUpstreamCommit,
      })
      await this.runGit(['add', UpstreamSyncService.METADATA_FILE], tempWorktreePath)

      const stagedChanges = await this.tryGitValue(['diff', '--cached', '--name-only'], tempWorktreePath)
      if (!stagedChanges) {
        throw new Error('No RoachNet patchset changes were staged for the refreshed upstream worktree')
      }

      await this.runGit(
        [
          'commit',
          '-m',
          `chore: sync upstream and reapply RoachNet patchset\n\nBase upstream: ${baseUpstreamCommit}\nNew upstream: ${latestUpstreamCommit}`,
        ],
        tempWorktreePath
      )
      await this.appendLog('Committed refreshed RoachNet patchset in the temporary worktree')

      this.writeStatus({
        ...initialStatus,
        stage: 'building',
        progress: 70,
        message: 'Patchset replay succeeded. Running typecheck and rebuilding before switching RoachNet over.',
        timestamp: new Date().toISOString(),
        backupBranch,
      })

      try {
        await this.ensureAdminDependencies(this.getAdminRoot(), join(tempWorktreePath, 'admin'))
        await this.runAdminCheck('typecheck', join(tempWorktreePath, 'admin'))
        await this.runAdminCheck('build', join(tempWorktreePath, 'admin'))
      } catch (error) {
        const buildMessage = this.formatCommandError(
          error,
          'Admin validation failed after patchset replay'
        )
        await this.appendLog(`Admin validation failure: ${buildMessage}`)
        throw new Error(`${buildMessage}. See upstream sync logs for details.`)
      }

      const tempCommit = await this.tryGitValue(['rev-parse', 'HEAD'], tempWorktreePath)
      if (!tempCommit) {
        throw new Error('Unable to resolve the refreshed RoachNet sync commit')
      }

      this.writeStatus({
        ...initialStatus,
        stage: 'building',
        progress: 90,
        message: `Validation passed. Updating ${currentBranch} to the refreshed upstream-backed commit.`,
        timestamp: new Date().toISOString(),
        backupBranch,
      })

      await this.runGit(['checkout', '-B', currentBranch, tempCommit], repoRoot)
      await this.appendLog(`Updated ${currentBranch} to ${tempCommit}`)

      await this.syncBuiltArtifacts(join(tempWorktreePath, 'admin'), this.getAdminRoot())

      const finalStatus = await this.buildStatus(false)
      this.writeStatus({
        ...finalStatus,
        stage: 'complete',
        progress: 100,
        message:
          'Upstream sync completed. RoachNet replayed its patchset onto the latest upstream source and refreshed the local production build. Restart RoachNet to load it.',
        timestamp: new Date().toISOString(),
        backupBranch,
      })
      await this.appendLog('Upstream sync completed successfully')
    } catch (error) {
      const failureMessage = this.formatCommandError(error, 'Upstream sync failed')
      await this.appendLog(`Upstream sync failed: ${failureMessage}`)

      const failureStatus = await this.buildStatus(false)
      this.writeStatus({
        ...failureStatus,
        stage: 'error',
        progress: 0,
        message: `Upstream sync failed: ${failureMessage}. RoachNet stayed on its pre-sync branch state. Backup branch: ${backupBranch}`,
        timestamp: new Date().toISOString(),
        backupBranch,
      })
    } finally {
      if (tempWorktreePath) {
        try {
          await this.runGit(['worktree', 'remove', '--force', tempWorktreePath], repoRoot)
          await this.appendLog(`Removed temporary worktree ${tempWorktreePath}`)
        } catch (error) {
          await this.appendLog(
            `Temporary worktree cleanup warning: ${error instanceof Error ? error.message : String(error)}`
          )
          await rm(tempWorktreePath, { recursive: true, force: true })
        }
      }

      this.running = false
    }
  }
}
