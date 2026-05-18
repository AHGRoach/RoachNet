const { dialog, shell } = require('electron')
const https = require('node:https')

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6
const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/RoachWares/RoachNet/releases'
const RELEASES_URL = 'https://github.com/RoachWares/RoachNet/releases'

function mapReleaseChannel(channel) {
  return channel === 'stable' ? 'latest' : channel
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '')
}

function parseVersionParts(value) {
  return normalizeVersion(value)
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0
    const rightPart = rightParts[index] || 0
    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: options.accept || 'application/json, text/plain;q=0.9',
          'User-Agent': 'RoachNet-Updater',
          ...(options.headers || {}),
        },
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          if ((response.statusCode || 0) >= 300) {
            reject(new Error(`${response.statusCode || 0} ${response.statusMessage || 'Update request failed'}`))
            return
          }

          resolve(body)
        })
      }
    )

    request.setTimeout(options.timeoutMs || 12_000, () => {
      request.destroy(new Error('Update request timed out.'))
    })
    request.on('error', reject)
    request.end()
  })
}

async function requestJson(url, options = {}) {
  return JSON.parse(
    await requestText(url, {
      ...options,
      accept: 'application/vnd.github+json, application/json',
    })
  )
}

function chooseReleaseForChannel(releases, channel) {
  if (!Array.isArray(releases)) {
    return null
  }

  if (channel === 'stable') {
    return releases.find((release) => !release.draft && !release.prerelease) || null
  }

  return (
    releases.find(
      (release) =>
        !release.draft &&
        (release.prerelease || String(release.tag_name || '').toLowerCase().includes(channel))
    ) ||
    releases.find((release) => !release.draft) ||
    null
  )
}

function selectInstallerAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  return (
    assets.find((asset) => /RoachNet-Setup-macOS\.dmg$/i.test(asset.name || '')) ||
    assets.find((asset) => /RoachNet.*mac.*\.(dmg|zip)$/i.test(asset.name || '')) ||
    null
  )
}

async function resolveLatestRelease(config) {
  const releases = await requestJson(GITHUB_RELEASES_API_URL)
  const release = chooseReleaseForChannel(releases, config.releaseChannel)
  if (!release) {
    throw new Error(`No ${config.releaseChannel} release was found.`)
  }

  const asset = selectInstallerAsset(release)
  return {
    version: normalizeVersion(release.tag_name || release.name),
    name: release.name || release.tag_name || 'RoachNet release',
    pageUrl: release.html_url || RELEASES_URL,
    assetUrl: asset?.browser_download_url || release.html_url || RELEASES_URL,
  }
}

function createUpdaterController({ app, getWindow, readConfig }) {
  let updateStatus = 'idle'
  let updateTimer = null
  let lastCheck = null

  const showMessage = async (options) => {
    const window = getWindow?.() || null
    return dialog.showMessageBox(window || undefined, options)
  }

  async function checkForUpdates(options = {}) {
    if (!app.isPackaged) {
      return { skipped: true, reason: 'RoachNet updater is disabled for unpackaged development runs.' }
    }

    const config = readConfig(app)
    if (!config.autoCheckUpdates && !options.manual) {
      return { skipped: true, reason: 'Automatic update checks are disabled.' }
    }

    updateStatus = 'checking'
    try {
      const release = await resolveLatestRelease(config)
      const currentVersion = app.getVersion()
      lastCheck = {
        checkedAt: new Date().toISOString(),
        currentVersion,
        latestVersion: release.version,
        releaseName: release.name,
        releaseUrl: release.pageUrl,
        assetUrl: release.assetUrl,
      }

      if (compareVersions(release.version, currentVersion) <= 0) {
        updateStatus = 'idle'
        if (options.manual) {
          await showMessage({
            type: 'info',
            buttons: ['OK'],
            title: 'RoachNet',
            message: 'RoachNet is up to date.',
            detail: `Current: ${currentVersion}\nChannel: ${config.releaseChannel.toUpperCase()}`,
          })
        }
        return { updateAvailable: false, ...lastCheck }
      }

      updateStatus = 'available'
      if (options.manual || config.autoDownloadUpdates) {
        const result = await showMessage({
          type: 'info',
          buttons: ['Download Installer', 'Release Notes', 'Later'],
          defaultId: 0,
          cancelId: 2,
          title: 'RoachNet Update Available',
          message: `RoachNet ${release.version} is available.`,
          detail: 'Download the current installer and run it over the existing install.',
        })

        if (result.response === 0) {
          await shell.openExternal(release.assetUrl || release.pageUrl || RELEASES_URL)
        } else if (result.response === 1) {
          await shell.openExternal(release.pageUrl || RELEASES_URL)
        }
      }

      return { updateAvailable: true, ...lastCheck }
    } catch (error) {
      updateStatus = 'error'
      if (options.manual) {
        await showMessage({
          type: 'error',
          buttons: ['OK'],
          title: 'RoachNet Update Check Failed',
          message: 'RoachNet could not complete the update check.',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  function start() {
    if (!app.isPackaged) return
    if (!readConfig(app).autoCheckUpdates) return

    clearInterval(updateTimer)
    updateTimer = setInterval(() => {
      checkForUpdates().catch(() => {})
    }, UPDATE_CHECK_INTERVAL_MS)
    setTimeout(() => {
      checkForUpdates().catch(() => {})
    }, 15_000)
  }

  function stop() {
    clearInterval(updateTimer)
    updateTimer = null
  }

  function getStatus() {
    const config = readConfig(app)
    return {
      state: updateStatus,
      releaseChannel: config.releaseChannel,
      updateBaseUrl: config.updateBaseUrl || null,
      autoCheckUpdates: config.autoCheckUpdates,
      latestVersion: lastCheck?.latestVersion || null,
      checkedAt: lastCheck?.checkedAt || null,
      releaseUrl: lastCheck?.releaseUrl || null,
    }
  }

  return {
    checkForUpdates,
    getStatus,
    start,
    stop,
  }
}

module.exports = {
  compareVersions,
  createUpdaterController,
  mapReleaseChannel,
}
