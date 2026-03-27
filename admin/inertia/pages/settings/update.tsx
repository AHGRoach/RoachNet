import { Head } from '@inertiajs/react'
import SettingsLayout from '~/layouts/SettingsLayout'
import StyledButton from '~/components/StyledButton'
import StyledTable from '~/components/StyledTable'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import ActiveDownloads from '~/components/ActiveDownloads'
import Alert from '~/components/Alert'
import { useEffect, useState } from 'react'
import { IconAlertCircle, IconArrowBigUpLines, IconCheck, IconCircleCheck, IconReload } from '@tabler/icons-react'
import { SystemUpdateStatus, UpstreamSyncStatus } from '../../../types/system'
import type { ContentUpdateCheckResult, ResourceUpdateInfo } from '../../../types/collections'
import api from '~/lib/api'
import Input from '~/components/inputs/Input'
import Switch from '~/components/inputs/Switch'
import { useMutation } from '@tanstack/react-query'
import { useNotifications } from '~/context/NotificationContext'
import { useSystemSetting } from '~/hooks/useSystemSetting'

type Props = {
  updateAvailable: boolean
  latestVersion: string
  currentVersion: string
  earlyAccess: boolean
  upstreamSync: UpstreamSyncStatus
}

type VersionInfo = Pick<Props, 'updateAvailable' | 'latestVersion' | 'currentVersion'>

function ContentUpdatesSection() {
  const { addNotification } = useNotifications()
  const [checkResult, setCheckResult] = useState<ContentUpdateCheckResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set())
  const [isApplyingAll, setIsApplyingAll] = useState(false)

  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const result = await api.checkForContentUpdates()
      if (result) {
        setCheckResult(result)
      }
    } catch {
      setCheckResult({
        updates: [],
        checked_at: new Date().toISOString(),
        error: 'Failed to check for content updates',
      })
    } finally {
      setIsChecking(false)
    }
  }

  const handleApply = async (update: ResourceUpdateInfo) => {
    setApplyingIds((prev) => new Set(prev).add(update.resource_id))
    try {
      const result = await api.applyContentUpdate(update)
      if (result?.success) {
        addNotification({ type: 'success', message: `Update started for ${update.resource_id}` })
        // Remove from the updates list
        setCheckResult((prev) =>
          prev
            ? { ...prev, updates: prev.updates.filter((u) => u.resource_id !== update.resource_id) }
            : prev
        )
      } else {
        addNotification({ type: 'error', message: result?.error || 'Failed to start update' })
      }
    } catch {
      addNotification({ type: 'error', message: `Failed to start update for ${update.resource_id}` })
    } finally {
      setApplyingIds((prev) => {
        const next = new Set(prev)
        next.delete(update.resource_id)
        return next
      })
    }
  }

  const handleApplyAll = async () => {
    if (!checkResult?.updates.length) return
    setIsApplyingAll(true)
    try {
      const result = await api.applyAllContentUpdates(checkResult.updates)
      if (result?.results) {
        const succeeded = result.results.filter((r) => r.success).length
        const failed = result.results.filter((r) => !r.success).length
        if (succeeded > 0) {
          addNotification({ type: 'success', message: `Started ${succeeded} update(s)` })
        }
        if (failed > 0) {
          addNotification({ type: 'error', message: `${failed} update(s) could not be started` })
        }
        // Remove successful updates from the list
        const successIds = new Set(result.results.filter((r) => r.success).map((r) => r.resource_id))
        setCheckResult((prev) =>
          prev
            ? { ...prev, updates: prev.updates.filter((u) => !successIds.has(u.resource_id)) }
            : prev
        )
      }
    } catch {
      addNotification({ type: 'error', message: 'Failed to apply updates' })
    } finally {
      setIsApplyingAll(false)
    }
  }

  return (
    <div className="mt-8">
      <StyledSectionHeader title="Content Updates" />

      <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden p-6">
        <div className="flex items-center justify-between">
          <p className="text-desert-stone-dark">
            Check if newer versions of your installed ZIM files and maps are available.
          </p>
          <StyledButton
            variant="primary"
            icon="IconRefresh"
            onClick={handleCheck}
            loading={isChecking}
          >
            Check for Content Updates
          </StyledButton>
        </div>

        {checkResult?.error && (
          <Alert
            type="warning"
            title="Update Check Issue"
            message={checkResult.error}
            variant="bordered"
            className="my-4"
          />
        )}

        {checkResult && !checkResult.error && checkResult.updates.length === 0 && (
          <Alert
            type="success"
            title="All Content Up to Date"
            message="All your installed content is running the latest available version."
            variant="bordered"
            className="my-4"
          />
        )}

        {checkResult && checkResult.updates.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-desert-stone-dark">
                {checkResult.updates.length} update(s) available
              </p>
              <StyledButton
                variant="primary"
                size="sm"
                icon="IconDownload"
                onClick={handleApplyAll}
                loading={isApplyingAll}
              >
                Update All ({checkResult.updates.length})
              </StyledButton>
            </div>
            <StyledTable
              data={checkResult.updates}
              columns={[
                {
                  accessor: 'resource_id',
                  title: 'Title',
                  render: (record) => (
                    <span className="font-medium text-desert-green">{record.resource_id}</span>
                  ),
                },
                {
                  accessor: 'resource_type',
                  title: 'Type',
                  render: (record) => (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${record.resource_type === 'zim'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-emerald-100 text-emerald-800'
                        }`}
                    >
                      {record.resource_type === 'zim' ? 'ZIM' : 'Map'}
                    </span>
                  ),
                },
                {
                  accessor: 'installed_version',
                  title: 'Version',
                  render: (record) => (
                    <span className="text-desert-stone-dark">
                      {record.installed_version} → {record.latest_version}
                    </span>
                  ),
                },
                {
                  accessor: 'resource_id',
                  title: '',
                  render: (record) => (
                    <StyledButton
                      variant="secondary"
                      size="sm"
                      icon="IconDownload"
                      onClick={() => handleApply(record)}
                      loading={applyingIds.has(record.resource_id)}
                    >
                      Update
                    </StyledButton>
                  ),
                },
              ]}
            />
          </div>
        )}

        {checkResult?.checked_at && (
          <p className="text-xs text-desert-stone mt-3">
            Last checked: {new Date(checkResult.checked_at).toLocaleString()}
          </p>
        )}
      </div>

      <ActiveDownloads withHeader />
    </div>
  )
}

function UpstreamSyncSection({ initialStatus }: { initialStatus: UpstreamSyncStatus }) {
  const { addNotification } = useNotifications()
  const [status, setStatus] = useState<UpstreamSyncStatus>(initialStatus)
  const [isChecking, setIsChecking] = useState(false)
  const [isSyncing, setIsSyncing] = useState(
    initialStatus.stage === 'syncing' || initialStatus.stage === 'building'
  )
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState('')

  useEffect(() => {
    if (!isSyncing) return

    const interval = setInterval(async () => {
      try {
        const nextStatus = await api.getUpstreamSyncStatus(false)
        if (!nextStatus) {
          throw new Error('Failed to fetch upstream sync status')
        }

        setStatus(nextStatus)

        if (nextStatus.stage === 'complete') {
          setIsSyncing(false)
          addNotification({
            type: 'success',
            message: 'Upstream sync completed. Restart RoachNet to load the refreshed build.',
          })
        } else if (nextStatus.stage === 'error') {
          setIsSyncing(false)
          addNotification({
            type: 'error',
            message: nextStatus.message,
          })
        }
      } catch (error: any) {
        console.error('Error polling upstream sync status:', error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [addNotification, isSyncing])

  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const nextStatus = await api.getUpstreamSyncStatus(true)
      if (!nextStatus) {
        throw new Error('Failed to check upstream sync status')
      }

      setStatus(nextStatus)
      addNotification({
        type: nextStatus.syncAvailable ? 'success' : 'info',
        message: nextStatus.message,
      })
    } catch (error: any) {
      addNotification({
        type: 'error',
        message: error?.message || 'Failed to check upstream source state',
      })
    } finally {
      setIsChecking(false)
    }
  }

  const handleStartSync = async () => {
    try {
      const result = await api.startUpstreamSync()
      if (!result?.success) {
        throw new Error('Failed to start upstream sync')
      }

      addNotification({
        type: 'success',
        message: result.message,
      })

      setIsSyncing(true)
      const nextStatus = await api.getUpstreamSyncStatus(false)
      if (nextStatus) {
        setStatus(nextStatus)
      }
    } catch (error: any) {
      addNotification({
        type: 'error',
        message: error?.response?.data?.error || error?.message || 'Failed to start upstream sync',
      })
    }
  }

  const handleViewLogs = async () => {
    try {
      const response = await api.getUpstreamSyncLogs()
      if (!response) {
        throw new Error('Failed to fetch upstream sync logs')
      }
      setLogs(response.logs)
      setShowLogs(true)
    } catch (error: any) {
      addNotification({
        type: 'error',
        message: error?.message || 'Failed to load upstream sync logs',
      })
    }
  }

  const canCheck = status.supported || status.repoRoot !== null
  const shortSha = (sha: string | null) => (sha ? sha.slice(0, 8) : 'Unavailable')

  return (
    <div className="mt-8">
      <StyledSectionHeader title="Source Upstream Sync" />

      <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h3 className="text-xl font-bold text-desert-green">Separate upstream patchset sync</h3>
            <p className="mt-3 text-sm leading-7 text-desert-stone-dark">
              This path fetches the latest upstream source commits, creates a backup branch,
              builds a temporary worktree from the refreshed source, and replays the RoachNet patchset onto that new base.
            </p>
            <p className="mt-3 text-sm leading-7 text-desert-stone-dark">
              RoachNet branding, UI changes, and custom integrations stay persistent because the sync flow reapplies the RoachNet patchset instead of replacing your custom tree.
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:min-w-[18rem]">
            <StyledButton
              variant="primary"
              icon="IconGitMerge"
              onClick={handleStartSync}
              disabled={!status.canSync || isSyncing}
            >
              {isSyncing ? 'Sync In Progress' : 'Sync From Upstream'}
            </StyledButton>
            <StyledButton
              variant="ghost"
              icon="IconRefresh"
              onClick={handleCheck}
              loading={isChecking}
              disabled={!canCheck || isSyncing}
            >
              Check Upstream
            </StyledButton>
            <StyledButton
              variant="ghost"
              icon="IconLogs"
              onClick={handleViewLogs}
              disabled={false}
            >
              View Sync Logs
            </StyledButton>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.2rem] border border-border-default bg-surface-secondary/70 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">Current Branch</p>
            <p className="mt-2 text-lg font-semibold text-text-primary">{status.currentBranch || 'Unavailable'}</p>
            <p className="mt-1 text-xs text-text-secondary">{shortSha(status.currentCommit)}</p>
          </div>
          <div className="rounded-[1.2rem] border border-border-default bg-surface-secondary/70 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">Upstream Head</p>
            <p className="mt-2 text-lg font-semibold text-text-primary">{status.upstreamBranch}</p>
            <p className="mt-1 text-xs text-text-secondary">{shortSha(status.upstreamCommit)}</p>
          </div>
          <div className="rounded-[1.2rem] border border-border-default bg-surface-secondary/70 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">RoachNet Patchset</p>
            <p className="mt-2 text-lg font-semibold text-text-primary">{status.patchsetCommits}</p>
            <p className="mt-1 text-xs text-text-secondary">commit(s) carried on top of upstream</p>
          </div>
          <div className="rounded-[1.2rem] border border-border-default bg-surface-secondary/70 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">Upstream Ahead</p>
            <p className="mt-2 text-lg font-semibold text-text-primary">{status.upstreamCommitsAhead}</p>
            <p className="mt-1 text-xs text-text-secondary">
              {status.syncAvailable ? 'Ready to sync' : 'No upstream commits pending'}
            </p>
          </div>
        </div>

        {status.backupBranch && (
          <div className="mt-4 rounded-[1.1rem] border border-border-default bg-surface-secondary/70 px-4 py-3">
            <p className="text-sm text-text-secondary">
              Safety backup branch: <span className="font-mono text-desert-green-light">{status.backupBranch}</span>
            </p>
          </div>
        )}

        {(status.hasTrackedChanges || status.stage === 'error' || status.stage === 'complete') && (
          <div className="mt-4">
            <Alert
              type={status.stage === 'error' ? 'error' : status.stage === 'complete' ? 'success' : 'warning'}
              title={
                status.stage === 'error'
                  ? 'Upstream Sync Failed'
                  : status.stage === 'complete'
                    ? 'Upstream Sync Complete'
                    : 'Tracked Changes Detected'
              }
              message={status.message}
              variant="bordered"
            />
          </div>
        )}

        {!status.hasTrackedChanges && status.stage !== 'error' && status.stage !== 'complete' && (
          <div className="mt-4 rounded-[1.1rem] border border-border-default bg-surface-secondary/70 px-4 py-3">
            <p className="text-sm text-text-secondary">{status.message}</p>
          </div>
        )}

        {(status.stage === 'syncing' || status.stage === 'building') && (
          <div className="mt-6">
            <div className="w-full bg-desert-stone-light rounded-full h-3 overflow-hidden">
              <div
                className="bg-desert-green h-full transition-all duration-500 ease-out"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-desert-stone-dark">
              {status.progress}% complete: {status.message}
            </p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Alert
            type="info"
            title="How RoachNet Stays Persistent"
            message="The sync flow rebuilds a fresh upstream worktree, reapplies the RoachNet patchset there, validates it, and only then switches your main branch over to the refreshed result."
            variant="solid"
          />
          <Alert
            type="warning"
            title="Clean Branch Required"
            message="Only tracked working-tree changes block the sync. Commit your RoachNet edits before syncing so the patchset replay can run safely."
            variant="solid"
          />
        </div>
      </div>

      {showLogs && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface-primary rounded-lg shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-desert-stone-light flex justify-between items-center">
              <h3 className="text-xl font-bold text-desert-green">Upstream Sync Logs</h3>
              <button
                onClick={() => setShowLogs(false)}
                className="text-desert-stone hover:text-desert-green transition-colors"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-auto flex-1">
              <pre className="bg-black text-green-400 p-4 rounded text-xs font-mono whitespace-pre-wrap">
                {logs || 'No upstream sync logs available yet...'}
              </pre>
            </div>
            <div className="p-6 border-t border-desert-stone-light">
              <StyledButton variant="secondary" onClick={() => setShowLogs(false)} fullWidth>
                Close
              </StyledButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SystemUpdatePage(props: { system: Props }) {
  const { addNotification } = useNotifications()

  const [isUpdating, setIsUpdating] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<SystemUpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState<string>('')
  const [email, setEmail] = useState('')
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    updateAvailable: props.system.updateAvailable,
    latestVersion: props.system.latestVersion,
    currentVersion: props.system.currentVersion,
  })
  const [showConnectionLostNotice, setShowConnectionLostNotice] = useState(false)

  const earlyAccessSetting = useSystemSetting({
    key: 'system.earlyAccess', initialData: {
      key: 'system.earlyAccess',
      value: props.system.earlyAccess,
    }
  })

  useEffect(() => {
    if (!isUpdating) return

    const interval = setInterval(async () => {
      try {
        const response = await api.getSystemUpdateStatus()
        if (!response) {
          throw new Error('Failed to fetch update status')
        }
        setUpdateStatus(response)

        // If we can connect again, hide the connection lost notice
        setShowConnectionLostNotice(false)

        // Check if update is complete or errored
        if (response.stage === 'complete') {
          // Re-check version so the KV store clears the stale "update available" flag
          // before we reload, otherwise the banner shows "current → current"
          try {
            await api.checkLatestVersion(true)
          } catch {
            // Non-critical - page reload will still work
          }
          setTimeout(() => {
            window.location.reload()
          }, 2000)
        } else if (response.stage === 'error') {
          setIsUpdating(false)
          setError(response.message)
        }
      } catch (err) {
        // During container restart, we'll lose connection - this is expected
        // Show a notice to inform the user that this is normal
        setShowConnectionLostNotice(true)
        // Continue polling to detect when the container comes back up
        console.log('Polling update status (container may be restarting)...')
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [isUpdating])

  const handleStartUpdate = async () => {
    try {
      setError(null)
      setIsUpdating(true)
      const response = await api.startSystemUpdate()
      if (!response || !response.success) {
        throw new Error('Failed to start update')
      }
    } catch (err: any) {
      setIsUpdating(false)
      setError(err.response?.data?.error || err.message || 'Failed to start update')
    }
  }

  const handleViewLogs = async () => {
    try {
      const response = await api.getSystemUpdateLogs()
      if (!response) {
        throw new Error('Failed to fetch update logs')
      }
      setLogs(response.logs)
      setShowLogs(true)
    } catch (err) {
      setError('Failed to fetch update logs')
    }
  }

  const checkVersionMutation = useMutation({
    mutationKey: ['checkLatestVersion'],
    mutationFn: () => api.checkLatestVersion(true),
    onSuccess: (data) => {
      if (data) {
        setVersionInfo({
          updateAvailable: data.updateAvailable,
          latestVersion: data.latestVersion,
          currentVersion: data.currentVersion,
        })
        if (data.updateAvailable) {
          addNotification({
            type: 'success',
            message: `Update available: ${data.latestVersion}`,
          })
        } else {
          addNotification({ type: 'success', message: 'System is up to date' })
        }
        setError(null)
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.message || 'Failed to check for updates'
      setError(errorMessage)
      addNotification({ type: 'error', message: errorMessage })
    },
  })

  const getProgressBarColor = () => {
    if (updateStatus?.stage === 'error') return 'bg-desert-red'
    if (updateStatus?.stage === 'complete') return 'bg-desert-olive'
    return 'bg-desert-green'
  }

  const getStatusIcon = () => {
    if (updateStatus?.stage === 'complete')
      return <IconCheck className="h-12 w-12 text-desert-olive" />
    if (updateStatus?.stage === 'error')
      return <IconAlertCircle className="h-12 w-12 text-desert-red" />
    if (isUpdating) return <IconReload className="h-12 w-12 text-desert-green animate-spin" />
    if (versionInfo.updateAvailable)
      return <IconArrowBigUpLines className="h-16 w-16 text-desert-green" />
    return <IconCircleCheck className="h-16 w-16 text-desert-olive" />
  }

  const updateSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      return await api.updateSetting(key, value)
    },
    onSuccess: () => {
      addNotification({ message: 'Setting updated successfully.', type: 'success' })
      earlyAccessSetting.refetch()
    },
    onError: (error) => {
      console.error('Error updating setting:', error)
      addNotification({ message: 'There was an error updating the setting. Please try again.', type: 'error' })
    },
  })

  const subscribeToReleaseNotesMutation = useMutation({
    mutationKey: ['subscribeToReleaseNotes'],
    mutationFn: (email: string) => api.subscribeToReleaseNotes(email),
    onSuccess: (data) => {
      if (data && data.success) {
        addNotification({ type: 'success', message: 'Successfully subscribed to release notes!' })
        setEmail('')
      } else {
        addNotification({
          type: 'error',
          message: `Failed to subscribe: ${data?.message || 'Unknown error'}`,
        })
      }
    },
    onError: (error: any) => {
      addNotification({
        type: 'error',
        message: `Error subscribing to release notes: ${error.message || 'Unknown error'}`,
      })
    },
  })

  return (
    <SettingsLayout>
      <Head title="System Update" />
      <div className="xl:pl-72 w-full">
        <main className="px-6 lg:px-12 py-6 lg:py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-desert-green mb-2">RoachNet Updates</h1>
            <p className="text-desert-stone-dark">
              Keep your RoachNet install current with release updates and upstream source syncs.
            </p>
          </div>

          {error && (
            <div className="mb-6">
              <Alert
                type="error"
                title="Update Failed"
                message={error}
                variant="bordered"
                dismissible
                onDismiss={() => setError(null)}
              />
            </div>
          )}
          {isUpdating && updateStatus?.stage === 'recreating' && (
            <div className="mb-6">
              <Alert
                type="info"
                title="Container Restarting"
                message="The admin container is restarting. This page will reload automatically when the update is complete."
                variant="solid"
              />
            </div>
          )}
          {isUpdating && showConnectionLostNotice && (
            <div className="mb-6">
              <Alert
                type="info"
                title="Connection Temporarily Lost (Expected)"
                message="You may see error notifications while the backend restarts during the update. This is completely normal and expected. Connection should be restored momentarily."
                variant="solid"
              />
            </div>
          )}
          <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden">
            <div className="p-8 text-center">
              <div className="flex justify-center mb-4">{getStatusIcon()}</div>

              {!isUpdating && (
                <>
                  <h2 className="text-2xl font-bold text-desert-green mb-2">
                    {versionInfo.updateAvailable ? 'Update Available' : 'System Up to Date'}
                  </h2>
                  <p className="text-desert-stone-dark mb-6">
                    {versionInfo.updateAvailable
                      ? `A new version (${versionInfo.latestVersion}) is available for your RoachNet install.`
                      : 'Your system is running the latest version!'}
                  </p>
                </>
              )}

              {isUpdating && updateStatus && (
                <>
                  <h2 className="text-2xl font-bold text-desert-green mb-2 capitalize">
                    {updateStatus.stage === 'idle' ? 'Preparing Update' : updateStatus.stage}
                  </h2>
                  <p className="text-desert-stone-dark mb-6">{updateStatus.message}</p>
                </>
              )}

              <div className="flex justify-center gap-8 mb-6">
                <div className="text-center">
                  <p className="text-sm text-desert-stone mb-1">Current Version</p>
                  <p className="text-xl font-bold text-desert-green">
                    {versionInfo.currentVersion}
                  </p>
                </div>
                {versionInfo.updateAvailable && (
                  <>
                    <div className="flex items-center">
                      <svg
                        className="h-6 w-6 text-desert-stone"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-desert-stone mb-1">Latest Version</p>
                      <p className="text-xl font-bold text-desert-olive">
                        {versionInfo.latestVersion}
                      </p>
                    </div>
                  </>
                )}
              </div>
              {isUpdating && updateStatus && (
                <div className="mb-4">
                  <div className="w-full bg-desert-stone-light rounded-full h-3 overflow-hidden">
                    <div
                      className={`${getProgressBarColor()} h-full transition-all duration-500 ease-out`}
                      style={{ width: `${updateStatus.progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-desert-stone mt-2">
                    {updateStatus.progress}% complete
                  </p>
                </div>
              )}
              {!isUpdating && (
                <div className="flex justify-center gap-4">
                  <StyledButton
                    variant="primary"
                    size="lg"
                    icon="IconDownload"
                    onClick={handleStartUpdate}
                    disabled={!versionInfo.updateAvailable}
                  >
                    {versionInfo.updateAvailable ? 'Start Update' : 'No Update Available'}
                  </StyledButton>
                  <StyledButton
                    variant="ghost"
                    size="lg"
                    icon="IconRefresh"
                    onClick={() => checkVersionMutation.mutate()}
                    loading={checkVersionMutation.isPending}
                  >
                    Check Again
                  </StyledButton>
                </div>
              )}
            </div>
            <div className="border-t bg-surface-primary p-6">
              <h3 className="text-lg font-semibold text-desert-green mb-4">
                What happens during an update?
              </h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
                    1
                  </div>
                  <div>
                    <p className="font-medium text-desert-stone-dark">Pull Latest Images</p>
                    <p className="text-sm text-desert-stone">
                      Downloads the newest Docker images for all core containers
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-desert-stone-dark">Recreate Containers</p>
                    <p className="text-sm text-desert-stone">
                      Safely stops and recreates all core containers with the new images
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
                    3
                  </div>
                  <div>
                    <p className="font-medium text-desert-stone-dark">Automatic Reload</p>
                    <p className="text-sm text-desert-stone">
                      This page will automatically reload when the update is complete
                    </p>
                  </div>
                </div>
              </div>

              {isUpdating && (
                <div className="mt-6 pt-6 border-t border-desert-stone-light">
                  <StyledButton
                    variant="ghost"
                    size="sm"
                    icon="IconLogs"
                    onClick={handleViewLogs}
                    fullWidth
                  >
                    View Update Logs
                  </StyledButton>
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Alert
              type="info"
              title="Backup Reminder"
              message="While updates are designed to be safe, it's always recommended to backup any critical data before proceeding."
              variant="solid"
            />
            <Alert
              type="warning"
              title="Temporary Downtime"
              message="Services will be briefly unavailable during the update process. This typically takes 2-5 minutes depending on your internet connection."
              variant="solid"
            />
          </div>
          <UpstreamSyncSection initialStatus={props.system.upstreamSync} />
          <StyledSectionHeader title="Early Access" className="mt-8" />
          <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden mt-6 p-6">
            <Switch
              checked={earlyAccessSetting.data?.value || false}
              onChange={(newVal) => {
                updateSettingMutation.mutate({ key: 'system.earlyAccess', value: newVal })
              }}
              disabled={updateSettingMutation.isPending}
              label="Enable Early Access"
              description="Receive release candidate (RC) versions before they are officially released. Note: RC versions may contain bugs and are not recommended for environments where stability and data integrity are critical."
            />
          </div>
          <ContentUpdatesSection />
          <div className="bg-surface-primary rounded-lg border shadow-md overflow-hidden py-6 mt-12">
            <div className="flex flex-col md:flex-row justify-between items-center p-8 gap-y-8 md:gap-y-0 gap-x-8">
              <div>
                <h2 className="max-w-xl text-lg font-bold text-desert-green sm:text-xl lg:col-span-7">
                  Want to stay updated with the latest from RoachNet? Subscribe to receive
                  release notes directly to your inbox. Unsubscribe anytime.
                </h2>
              </div>
              <div className="flex flex-col">
                <div className="flex gap-x-3">
                  <Input
                    name="email"
                    label=""
                    type="email"
                    placeholder="Your email address"
                    disabled={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full"
                    containerClassName="!mt-0"
                  />
                  <StyledButton
                    variant="primary"
                    disabled={!email}
                    onClick={() => subscribeToReleaseNotesMutation.mutateAsync(email)}
                    loading={subscribeToReleaseNotesMutation.isPending}
                  >
                    Subscribe
                  </StyledButton>
                </div>
                <p className="mt-2 text-sm text-desert-stone-dark">
                  We care about your privacy. RoachNet will never share your email with
                  third parties or send you spam.
                </p>
              </div>
            </div>
          </div>

          {showLogs && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-surface-primary rounded-lg shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col">
                <div className="p-6 border-b border-desert-stone-light flex justify-between items-center">
                  <h3 className="text-xl font-bold text-desert-green">Update Logs</h3>
                  <button
                    onClick={() => setShowLogs(false)}
                    className="text-desert-stone hover:text-desert-green transition-colors"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                <div className="p-6 overflow-auto flex-1">
                  <pre className="bg-black text-green-400 p-4 rounded text-xs font-mono whitespace-pre-wrap">
                    {logs || 'No logs available yet...'}
                  </pre>
                </div>
                <div className="p-6 border-t border-desert-stone-light">
                  <StyledButton variant="secondary" onClick={() => setShowLogs(false)} fullWidth>
                    Close
                  </StyledButton>
                </div>
              </div>
            </div>
          )}
        </main>
      </div >
    </SettingsLayout >
  )
}
