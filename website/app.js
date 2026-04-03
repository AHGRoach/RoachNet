const owner = 'AHGRoach'
const repo = 'RoachNet'
const releaseVersion = '1.30.10'
const latestReleaseApi = `https://api.github.com/repos/${owner}/${repo}/releases/latest`
const latestReleasePage = `https://github.com/${owner}/${repo}/releases/latest`
const latestDownloadBase = `https://github.com/${owner}/${repo}/releases/latest/download`
const hostedDownloads = {
  mac: {
    url: `${latestDownloadBase}/RoachNet-Setup-macOS.dmg`,
    name: 'RoachNet-Setup-macOS.dmg',
    version: releaseVersion,
  },
}

const primaryDownloadButton = document.querySelector('#primary-download')
const downloadsPrimaryButton = document.querySelector('#downloads-primary')
const downloadMeta = document.querySelector('#download-meta')
const platformButtons = [...document.querySelectorAll('[data-platform]')]
const commandLaunchButton = document.querySelector('#command-launch')
const commandPalette = document.querySelector('#command-palette')
const commandScrim = document.querySelector('#command-scrim')
const commandInput = document.querySelector('#command-input')
const commandItems = [...document.querySelectorAll('.command-item')]
const heroTime = document.querySelector('[data-hero-time]')
const heroConnectivity = document.querySelector('[data-hero-connectivity]')
const heroStorage = document.querySelector('[data-hero-storage]')
const appStoreFilterBar = document.querySelector('#app-store-filter-bar')
const appStoreSearchInput = document.querySelector('#app-store-search')
const appStoreResults = document.querySelector('#app-store-results')
const appStoreFeatured = document.querySelector('#app-store-featured')
const appStoreGrid = document.querySelector('#app-store-grid')
const appStoreUpdated = document.querySelector('#app-store-updated')
const appDetailOverlay = document.querySelector('#app-detail-overlay')
const appDetailContent = document.querySelector('#app-detail-content')
const appDetailClose = document.querySelector('#app-detail-close')

const platformPresets = {
  mac: {
    label: 'macOS',
    patterns: [/^RoachNet-Setup-macOS\.dmg$/i, /RoachNet-Setup-.*-mac-.*\.dmg$/i, /RoachNet-Setup-.*-mac-.*\.zip$/i],
  },
  win: {
    label: 'Windows 11',
    patterns: [/RoachNet-Setup-.*-win-.*\.exe$/i],
  },
  linux: {
    label: 'Linux',
    patterns: [/RoachNet-Setup-.*-linux-.*\.AppImage$/i, /RoachNet-Setup-.*-linux-.*\.deb$/i],
  },
}

let latestRelease = null
let activePlatform = detectPlatform()
let selectedCommandIndex = -1
let timeTicker = null
let appStoreCatalog = null
let appStoreActiveSection = 'All'
let appStoreSearchQuery = ''
let featuredRotationTimer = null
let featuredRotationItems = []
let featuredRotationIndex = 0
let storeRevealObserver = null

const fallbackCatalog = {
  updatedAt: '2026-04-03T14:45:00-04:00',
  featuredId: 'base-atlas',
  items: [
    {
      id: 'base-atlas',
      title: 'Base Atlas',
      subtitle: 'Core renderer and shared basemap',
      category: 'Maps',
      section: 'Field Ops',
      size: '320 MB',
      status: 'Ready',
      source: 'RoachNet mirror',
      icon: './assets/app-store/base-atlas.svg',
      summary:
        'Install the shared vector atlas and base map assets first so regional packs open cleanly inside the RoachNet Maps lane.',
      featured: true,
      accent: 'blue',
      machineFit: 'Best first install on every supported Mac',
      includes: [
        'Shared vector atlas and renderer assets',
        'Required before regional map collections',
        'Installs directly into the native Maps lane',
      ],
      installLabel: 'Get',
      detailLabel: 'View manifest',
      detailUrl: './collections/maps.json',
      installIntent: {
        action: 'base-map-assets',
      },
    },
    {
      id: 'pacific-region',
      title: 'Pacific Region',
      subtitle: 'Alaska, California, Hawaii, Oregon, Washington',
      category: 'Maps',
      section: 'Field Ops',
      size: '2.6 GB',
      status: 'Ready',
      source: 'Geofabrik + curated packs',
      icon: './assets/app-store/pacific-region.svg',
      summary:
        'Queue the Pacific regional collection directly into RoachNet so the field map lane is useful immediately after install.',
      accent: 'blue',
      machineFit: 'Ideal once Base Atlas is already installed',
      includes: [
        'Pacific region collection manifest',
        'Regional downloads for Alaska, California, Hawaii, Oregon, and Washington',
        'Mapped install path inside the field-ops shelf',
      ],
      installLabel: 'Get',
      detailLabel: 'Open collection',
      detailUrl: './collections/maps.json',
      installIntent: {
        action: 'map-collection',
        slug: 'pacific',
      },
    },
    {
      id: 'medicine-essential',
      title: 'Medicine Essentials',
      subtitle: 'Field medicine, NHS meds, CDC travel health',
      category: 'Knowledge',
      section: 'Knowledge Packs',
      size: '331 MB',
      status: 'Recommended',
      source: 'Kiwix mirror',
      icon: './assets/app-store/medicine-essential.svg',
      summary:
        'A compact medical reference pack for first aid, medications, emergency care, and field medicine without pulling the full library on day one.',
      accent: 'green',
      machineFit: 'Lean enough for first boot and travel installs',
      includes: [
        'Emergency care and first-aid references',
        'Medication and travel-health docs',
        'Contained knowledge install in the Education lane',
      ],
      installLabel: 'Get',
      detailLabel: 'View catalog',
      detailUrl: './collections/kiwix-categories.json',
      installIntent: {
        action: 'education-tier',
        category: 'medicine',
        tier: 'medicine-essential',
      },
    },
    {
      id: 'survival-essential',
      title: 'Survival Essentials',
      subtitle: 'Winter prep and bug-out basics',
      category: 'Knowledge',
      section: 'Knowledge Packs',
      size: '2.3 GB',
      status: 'Ready',
      source: 'Kiwix mirror',
      icon: './assets/app-store/survival-essential.svg',
      summary:
        'Queue the lean survival pack first so RoachNet has practical emergency references without waiting on the larger preparedness tiers.',
      accent: 'gold',
      machineFit: 'Good default for field kits and travel setups',
      includes: [
        'Prepper and bug-out references',
        'Offline winter and emergency planning docs',
        'Install queue lands in the Education lane',
      ],
      installLabel: 'Get',
      detailLabel: 'View catalog',
      detailUrl: './collections/kiwix-categories.json',
      installIntent: {
        action: 'education-tier',
        category: 'survival',
        tier: 'survival-essential',
      },
    },
    {
      id: 'wikipedia-quick-reference',
      title: 'Wikipedia Quick Reference',
      subtitle: 'Top 100,000 articles, minimal images',
      category: 'Knowledge',
      section: 'Knowledge Packs',
      size: '313 MB',
      status: 'Fast first install',
      source: 'Kiwix mirror',
      icon: './assets/app-store/wikipedia-quick-reference.svg',
      summary:
        'A small Wikipedia lane for quick lookup work. It is the best default when the user wants offline reference without committing to a multi-gigabyte encyclopedia on first boot.',
      accent: 'blue',
      machineFit: 'Fastest encyclopedia option for smaller installs',
      includes: [
        'Top article quick-reference pack',
        'Minimal image footprint for faster sync',
        'Wikipedia option queued directly in RoachNet',
      ],
      installLabel: 'Get',
      detailLabel: 'View options',
      detailUrl: './collections/wikipedia.json',
      installIntent: {
        action: 'wikipedia-option',
        option: 'top-mini',
      },
    },
    {
      id: 'roachclaw-quickstart',
      title: 'RoachClaw Quickstart',
      subtitle: 'Contained qwen2.5-coder:1.5b model',
      category: 'AI',
      section: 'AI Packs',
      size: '1-2 GB',
      status: 'Best first boot',
      source: 'Contained Ollama lane',
      icon: './assets/app-store/roachclaw-quickstart.svg',
      summary:
        'Open RoachNet and queue the fast contained starter model so RoachClaw can answer on a clean machine without borrowing a host Ollama install.',
      accent: 'violet',
      machineFit: 'Best on all Apple Silicon Macs, especially 16 GB systems',
      includes: [
        'Contained Ollama-backed model download',
        'RoachClaw bootstrap queue on first launch',
        'Cloud fallback remains available while the model downloads',
      ],
      installLabel: 'Get',
      detailLabel: 'Open RoachClaw',
      detailUrl: './index.html#screens',
      installIntent: {
        action: 'roachclaw-model',
        model: 'qwen2.5-coder:1.5b',
      },
    },
    {
      id: 'roachclaw-studio',
      title: 'RoachClaw Studio',
      subtitle: 'Contained qwen2.5-coder:7b upgrade',
      category: 'AI',
      section: 'AI Packs',
      size: '4-5 GB',
      status: 'For larger Apple Silicon Macs',
      source: 'Contained Ollama lane',
      icon: './assets/app-store/roachclaw-studio.svg',
      summary:
        'A bigger local coding model for machines with more headroom. Queue it from the site and RoachNet will open directly into the RoachClaw workbench to stage the download.',
      accent: 'violet',
      machineFit: 'Best on M2 Pro, Max, and higher-memory Apple Silicon',
      includes: [
        'Contained 7B coding model queue',
        'RoachClaw workbench handoff',
        'Larger local lane for stronger coding and agent tasks',
      ],
      installLabel: 'Get',
      detailLabel: 'Open RoachClaw',
      detailUrl: './index.html#screens',
      installIntent: {
        action: 'roachclaw-model',
        model: 'qwen2.5-coder:7b',
      },
    },
  ],
}

function markActivePlatform(platformKey) {
  platformButtons.forEach((button) => {
    button.dataset.active = button.dataset.platform === platformKey ? 'true' : 'false'
  })
}

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()

  if (platform.includes('mac') || ua.includes('mac os')) {
    return 'mac'
  }

  if (platform.includes('win') || ua.includes('windows')) {
    return 'win'
  }

  return 'linux'
}

function findAssetForPlatform(platformKey) {
  if (!latestRelease?.assets?.length) {
    return null
  }

  const preset = platformPresets[platformKey]
  if (!preset) {
    return null
  }

  for (const pattern of preset.patterns) {
    const match = latestRelease.assets.find((asset) => pattern.test(asset.name))
    if (match) {
      return match
    }
  }

  return null
}

function setPrimaryButton(platformKey) {
  const hostedAsset = hostedDownloads[platformKey]
  const asset = findAssetForPlatform(platformKey)
  const label = platformPresets[platformKey]?.label || 'your system'
  const primaryButtons = [primaryDownloadButton, downloadsPrimaryButton].filter(Boolean)

  if (!primaryButtons.length) {
    return
  }

  activePlatform = platformKey
  markActivePlatform(platformKey)

  if (hostedAsset) {
    primaryButtons.forEach((button) => {
      button.textContent = `Download RoachNet ${hostedAsset.version} for ${label}`
      button.onclick = () => {
        window.location.href = hostedAsset.url
      }
    })
    if (downloadMeta) {
      downloadMeta.textContent = `Starts with RoachNet Setup v${hostedAsset.version} · ${hostedAsset.name}`
    }
    return
  }

  if (asset) {
    const assetVersion =
      latestRelease?.tag_name?.replace(/^v/i, '') ||
      hostedAsset?.version ||
      releaseVersion
    primaryButtons.forEach((button) => {
      button.textContent = `Download RoachNet ${assetVersion} for ${label}`
      button.onclick = () => {
        window.location.href = asset.browser_download_url
      }
    })
    if (downloadMeta) {
      downloadMeta.textContent = `Starts with RoachNet Setup v${assetVersion} · ${asset.name}`
    }
    return
  }

  primaryButtons.forEach((button) => {
    button.textContent = `View ${label} release`
    button.onclick = () => {
      window.open(latestReleasePage, '_blank', 'noopener,noreferrer')
    }
  })
  if (downloadMeta) {
    downloadMeta.textContent = `No direct ${label} installer is posted yet. Opening the latest release instead.`
  }
}

function formatCompactBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 GB'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function updateHeroTime() {
  if (!heroTime) {
    return
  }

  heroTime.textContent = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date())
}

function updateConnectivity() {
  if (!heroConnectivity) {
    return
  }

  const isOnline = navigator.onLine
  heroConnectivity.dataset.state = isOnline ? 'online' : 'offline'
  heroConnectivity.textContent = isOnline ? 'Online Now' : 'Offline Ready'
}

async function updateStorageEstimate() {
  if (!heroStorage) {
    return
  }

  if (!navigator.storage?.estimate) {
    heroStorage.textContent = 'Disk check in app'
    return
  }

  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    const available = Math.max(0, quota - usage)

    if (!available) {
      heroStorage.textContent = 'Storage estimate unavailable'
      return
    }

    heroStorage.textContent = `${formatCompactBytes(available)} storage est.`
  } catch (error) {
    heroStorage.textContent = 'Storage estimate unavailable'
    console.error(error)
  }
}

function startHeroTelemetry() {
  updateHeroTime()
  updateConnectivity()
  updateStorageEstimate()

  if (timeTicker) {
    window.clearInterval(timeTicker)
  }

  timeTicker = window.setInterval(updateHeroTime, 30_000)
  window.addEventListener('online', updateConnectivity)
  window.addEventListener('offline', updateConnectivity)
}

function normalizeCatalogValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function buildInstallUrl(item) {
  if (!item?.installIntent) {
    return ''
  }

  const params = new URLSearchParams()
  Object.entries(item.installIntent).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, value)
    }
  })

  const query = params.toString()
  return query ? `roachnet://install-content?${query}` : 'roachnet://install-content'
}

function getCatalogItems(catalog = appStoreCatalog) {
  return Array.isArray(catalog?.items) ? catalog.items : []
}

function getVisibleCatalogItems(catalog = appStoreCatalog) {
  const normalizedQuery = normalizeCatalogValue(appStoreSearchQuery)

  return getCatalogItems(catalog).filter((item) => {
    const matchesSection =
      appStoreActiveSection === 'All' || (item.section || 'Catalog') === appStoreActiveSection

    if (!matchesSection) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    const haystack = normalizeCatalogValue([
      item.title,
      item.subtitle,
      item.category,
      item.section,
      item.status,
      item.source,
      item.summary,
      item.machineFit,
      ...(item.includes || []),
    ].join(' '))

    return haystack.includes(normalizedQuery)
  })
}

function renderAppStoreFilters(items) {
  if (!appStoreFilterBar) {
    return
  }

  const sections = ['All', ...new Set(items.map((item) => item.section || 'Catalog'))]

  appStoreFilterBar.innerHTML = sections
    .map(
      (section) => `
        <button
          class="app-store-filter${section === appStoreActiveSection ? ' app-store-filter--active' : ''}"
          type="button"
          data-section-filter="${section}"
          aria-pressed="${section === appStoreActiveSection ? 'true' : 'false'}"
        >
          ${section}
        </button>
      `
    )
    .join('')
}

function renderStoreActionButtons(item, { compact = false, featured = false } = {}) {
  const installUrl = buildInstallUrl(item)
  const installLabel = item.installLabel || 'Get'
  const detailUrl = item.detailUrl || item.primaryUrl
  const detailLabel = item.detailLabel || 'View manifest'

  if (featured) {
    return `
      <div class="store-featured-card__actions">
        ${
          installUrl
            ? `<a class="store-featured-card__primary" href="${installUrl}">${installLabel}</a>`
            : ''
        }
        <button class="store-featured-card__preview" type="button" data-preview-id="${item.id}">Preview</button>
        ${
          detailUrl
            ? `<a class="store-featured-card__secondary" href="${detailUrl}">${detailLabel}</a>`
            : ''
        }
      </div>
    `
  }

  return `
    <div class="store-app-card__actions">
      ${
        installUrl
          ? `<a class="store-app-card__get" href="${installUrl}">${installLabel}</a>`
          : ''
      }
      <button class="store-app-card__preview${compact ? ' store-app-card__preview--compact' : ''}" type="button" data-preview-id="${item.id}">
        Preview
      </button>
    </div>
  `
}

function renderStoreCard(item, compact = false) {
  const highlights = (item.includes || []).slice(0, compact ? 1 : 2)
  const metaItems = [item.size, item.source, item.machineFit].filter(Boolean).slice(0, 3)

  return `
    <article class="store-app-card${compact ? ' store-app-card--compact' : ''}" data-accent="${item.accent || 'blue'}" data-reveal>
      <div class="store-app-card__top">
        <div class="store-app-card__icon">
          <img src="${item.icon}" alt="${item.title} icon" loading="lazy" />
        </div>
        <div class="store-app-card__copy">
          <div class="store-app-card__eyebrow-row">
            <span class="store-app-card__category">${item.category}</span>
            <span class="store-app-card__status">${item.status}</span>
          </div>
          <h3>${item.title}</h3>
          <p class="store-app-card__subtitle">${item.subtitle || item.source}</p>
        </div>
      </div>
      <p class="store-app-card__summary">${item.summary}</p>
      ${
        highlights.length
          ? `<ul class="store-app-card__bullets">${highlights.map((line) => `<li>${line}</li>`).join('')}</ul>`
          : ''
      }
      <div class="store-app-card__meta">
        ${metaItems.map((value) => `<span>${value}</span>`).join('')}
      </div>
      ${renderStoreActionButtons(item, { compact })}
      <p class="store-app-card__caption">Install opens RoachNet and queues this pack inside the native app.</p>
    </article>
  `
}

function renderFeaturedPagination(items) {
  if (items.length < 2) {
    return ''
  }

  return `
    <div class="store-featured-card__pagination" aria-label="Featured apps carousel">
      ${items
        .map(
          (candidate, index) => `
            <button
              class="store-featured-card__dot${index === featuredRotationIndex ? ' store-featured-card__dot--active' : ''}"
              type="button"
              data-featured-index="${index}"
              aria-label="Show ${candidate.title}"
            >
              <span>${candidate.title}</span>
            </button>
          `
        )
        .join('')}
    </div>
  `
}

function renderFeaturedStoreCard(item, items = []) {
  if (!appStoreFeatured || !item) {
    return
  }

  appStoreFeatured.innerHTML = `
    <article class="store-featured-card" data-accent="${item.accent || 'blue'}" data-reveal>
      <div class="store-featured-card__icon">
        <img src="${item.icon}" alt="${item.title} icon" loading="lazy" />
      </div>
      <div class="store-featured-card__copy">
        <span class="store-featured-card__eyebrow">Today in RoachNet Apps</span>
        <h3>${item.title}</h3>
        <p class="store-featured-card__subtitle">${item.subtitle || item.source}</p>
        <p class="store-featured-card__summary">${item.summary}</p>
        <div class="store-featured-card__meta">
          <span>${item.category}</span>
          <span>${item.size}</span>
          <span>${item.machineFit || item.source}</span>
        </div>
        ${renderStoreActionButtons(item, { featured: true })}
        ${renderFeaturedPagination(items)}
      </div>
    </article>
  `
}

function stopFeaturedRotation() {
  if (featuredRotationTimer) {
    window.clearInterval(featuredRotationTimer)
    featuredRotationTimer = null
  }
}

function startFeaturedRotation() {
  stopFeaturedRotation()

  if (!appStoreFeatured || featuredRotationItems.length < 2) {
    return
  }

  featuredRotationTimer = window.setInterval(() => {
    featuredRotationIndex = (featuredRotationIndex + 1) % featuredRotationItems.length
    renderFeaturedStoreCard(featuredRotationItems[featuredRotationIndex], featuredRotationItems)
    observeStoreReveals()
  }, 7000)
}

function observeStoreReveals() {
  const revealTargets = document.querySelectorAll('[data-reveal]')
  if (!revealTargets.length) {
    return
  }

  if (!('IntersectionObserver' in window)) {
    revealTargets.forEach((target) => target.classList.add('is-revealed'))
    return
  }

  if (!storeRevealObserver) {
    storeRevealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            storeRevealObserver.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.18,
        rootMargin: '0px 0px -24px 0px',
      }
    )
  }

  revealTargets.forEach((target) => {
    if (!target.dataset.revealBound) {
      target.dataset.revealBound = 'true'
      storeRevealObserver.observe(target)
    }
  })
}

function updateAppStoreResults(visibleItems, totalItems) {
  if (!appStoreResults) {
    return
  }

  const sectionLabel =
    appStoreActiveSection === 'All' ? 'all shelves' : `${appStoreActiveSection.toLowerCase()}`
  const queryLabel = appStoreSearchQuery.trim() ? ` matching “${appStoreSearchQuery.trim()}”` : ''
  appStoreResults.textContent = `Showing ${visibleItems.length} of ${totalItems} apps across ${sectionLabel}${queryLabel}.`
}

function renderEmptyCatalogState() {
  if (!appStoreGrid) {
    return
  }

  appStoreGrid.innerHTML = `
    <section class="app-store-empty" data-reveal>
      <strong>No apps matched this filter.</strong>
      <p>Try a broader section or clear the search term to see the full RoachNet catalog again.</p>
    </section>
  `
  if (appStoreFeatured) {
    appStoreFeatured.innerHTML = ''
  }
  stopFeaturedRotation()
  observeStoreReveals()
}

function renderAppStoreCatalog(catalog) {
  if (!appStoreGrid) {
    return
  }

  appStoreCatalog = catalog
  const items = getCatalogItems(catalog)
  const storeMode = appStoreGrid.dataset.storeMode || 'full'

  renderAppStoreFilters(items)

  const visibleItems = getVisibleCatalogItems(catalog)
  updateAppStoreResults(visibleItems, items.length)

  if (!visibleItems.length) {
    renderEmptyCatalogState()
    return
  }

  const primaryFeatured =
    visibleItems.find((item) => item.id === catalog?.featuredId) ||
    visibleItems.find((item) => item.featured) ||
    visibleItems[0]
  featuredRotationItems = [primaryFeatured, ...visibleItems.filter((item) => item.id !== primaryFeatured.id)]
  featuredRotationIndex = Math.min(featuredRotationIndex, Math.max(0, featuredRotationItems.length - 1))

  if (appStoreFeatured) {
    renderFeaturedStoreCard(featuredRotationItems[featuredRotationIndex], featuredRotationItems)
  }

  if (storeMode === 'compact') {
    appStoreGrid.innerHTML = visibleItems
      .slice(0, 4)
      .map((item) => renderStoreCard(item, true))
      .join('')
  } else {
    const shelfItems = visibleItems.filter((item) => item.id !== featuredRotationItems[featuredRotationIndex]?.id)
    const sections = [...new Set((shelfItems.length ? shelfItems : visibleItems).map((item) => item.section || 'Catalog'))]

    appStoreGrid.innerHTML = sections
      .map((section) => {
        const sectionItems = (shelfItems.length ? shelfItems : visibleItems).filter(
          (item) => (item.section || 'Catalog') === section
        )

        return `
          <section class="app-store-shelf" data-reveal>
            <div class="app-store-shelf__head">
              <div>
                <p class="app-store-shelf__eyebrow">${section}</p>
                <h3>${sectionItems.length} install-ready apps</h3>
              </div>
              <span class="app-store-shelf__count">${sectionItems.length} picks</span>
            </div>
            <div class="app-store-shelf__grid">
              ${sectionItems.map((item) => renderStoreCard(item)).join('')}
            </div>
          </section>
        `
      })
      .join('')
  }

  if (appStoreUpdated) {
    const updated = catalog?.updatedAt ? new Date(catalog.updatedAt) : null
    appStoreUpdated.textContent =
      updated && !Number.isNaN(updated.valueOf())
        ? `Catalog updated ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(updated)}`
        : 'Catalog preview'
  }

  observeStoreReveals()
  startFeaturedRotation()
}

function renderAppDetailSheet(item) {
  const installUrl = buildInstallUrl(item)
  const detailUrl = item.detailUrl || item.primaryUrl
  const includes = (item.includes || []).map((line) => `<li>${line}</li>`).join('')

  return `
    <article class="app-detail-sheet__content" data-accent="${item.accent || 'blue'}">
      <div class="app-detail-sheet__hero">
        <div class="app-detail-sheet__icon">
          <img src="${item.icon}" alt="${item.title} icon" loading="lazy" />
        </div>
        <div class="app-detail-sheet__copy">
          <p class="app-detail-sheet__eyebrow">${item.section} · ${item.category}</p>
          <h3 id="app-detail-title">${item.title}</h3>
          <p class="app-detail-sheet__subtitle">${item.subtitle || item.source}</p>
          <p class="app-detail-sheet__summary">${item.summary}</p>
          <div class="app-detail-sheet__meta">
            <span>${item.size}</span>
            <span>${item.status}</span>
            <span>${item.machineFit || item.source}</span>
          </div>
          <div class="app-detail-sheet__actions">
            ${
              installUrl
                ? `<a class="app-detail-sheet__primary" href="${installUrl}">${item.installLabel || 'Get'}</a>`
                : ''
            }
            ${
              detailUrl
                ? `<a class="app-detail-sheet__secondary" href="${detailUrl}">${item.detailLabel || 'View manifest'}</a>`
                : ''
            }
          </div>
        </div>
      </div>
      <div class="app-detail-sheet__body">
        <section>
          <h4>What installs</h4>
          <ul>${includes || '<li>RoachNet queues the selected content directly into the native install path.</li>'}</ul>
        </section>
        <section>
          <h4>Machine fit</h4>
          <p>${item.machineFit || 'Designed for the contained RoachNet install path on supported Macs.'}</p>
        </section>
        <section>
          <h4>Install behavior</h4>
          <p>Pressing Get opens the native app with a <code>roachnet://</code> handoff so the selected pack lands in the right module instead of downloading into a random folder.</p>
        </section>
      </div>
    </article>
  `
}

function openAppDetail(id) {
  const item = getCatalogItems().find((candidate) => candidate.id === id)
  if (!item || !appDetailOverlay || !appDetailContent) {
    return
  }

  appDetailContent.innerHTML = renderAppDetailSheet(item)
  appDetailOverlay.hidden = false
  requestAnimationFrame(() => {
    appDetailOverlay.dataset.state = 'open'
  })
  document.body.classList.add('app-detail-open')
}

function closeAppDetail() {
  if (!appDetailOverlay) {
    return
  }

  appDetailOverlay.dataset.state = 'closed'
  appDetailOverlay.hidden = true
  document.body.classList.remove('app-detail-open')
}

async function loadAppStoreCatalog() {
  if (!appStoreGrid) {
    return
  }

  renderAppStoreCatalog(fallbackCatalog)

  try {
    const response = await fetch('./app-store-catalog.json', {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    const catalog = await response.json()
    renderAppStoreCatalog(catalog)
  } catch (error) {
    console.error(error)
  }
}

async function loadLatestRelease() {
  const detectedPlatform = activePlatform
  if (hostedDownloads[detectedPlatform]) {
    setPrimaryButton(detectedPlatform)
  }

  try {
    const response = await fetch(latestReleaseApi, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    })

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    latestRelease = await response.json()
    setPrimaryButton(detectedPlatform)
  } catch (error) {
    if (!hostedDownloads[detectedPlatform]) {
      ;[primaryDownloadButton, downloadsPrimaryButton].filter(Boolean).forEach((button) => {
        button.textContent = 'Open latest release'
        button.onclick = () => {
          window.open(latestReleasePage, '_blank', 'noopener,noreferrer')
        }
      })
      if (downloadMeta) {
        downloadMeta.textContent = 'The live release feed is unavailable. Opening the latest release instead.'
      }
    }
    console.error(error)
  }
}

platformButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const platformKey = button.dataset.platform
    activePlatform = platformKey
    markActivePlatform(platformKey)
    const hostedAsset = hostedDownloads[platformKey]
    const asset = findAssetForPlatform(platformKey)

    if (hostedAsset) {
      window.location.href = hostedAsset.url
      return
    }

    if (asset) {
      window.location.href = asset.browser_download_url
      return
    }

    window.open(latestReleasePage, '_blank', 'noopener,noreferrer')
  })
})

function openCommandPalette() {
  if (!commandPalette) {
    return
  }

  commandPalette.hidden = false
  commandPalette.dataset.state = 'open'
  commandInput?.focus()
  commandInput?.select()
  filterCommandItems('')
}

function closeCommandPalette() {
  if (!commandPalette) {
    return
  }

  commandPalette.dataset.state = 'closed'
  commandPalette.hidden = true
  if (commandInput) {
    commandInput.value = ''
  }
  filterCommandItems('')
}

function visibleCommandItems() {
  return commandItems.filter((item) => !item.hidden)
}

function setSelectedCommandIndex(nextIndex) {
  const visibleItems = visibleCommandItems()
  selectedCommandIndex = visibleItems.length ? Math.max(0, Math.min(nextIndex, visibleItems.length - 1)) : -1

  commandItems.forEach((item) => {
    item.dataset.active = 'false'
    item.setAttribute('aria-selected', 'false')
  })

  if (selectedCommandIndex >= 0) {
    const activeItem = visibleItems[selectedCommandIndex]
    activeItem.dataset.active = 'true'
    activeItem.setAttribute('aria-selected', 'true')
    activeItem.scrollIntoView({ block: 'nearest' })
  }
}

function filterCommandItems(query) {
  const normalized = query.trim().toLowerCase()

  commandItems.forEach((item) => {
    const haystack = (item.dataset.command || '').toLowerCase()
    const matches = !normalized || haystack.includes(normalized)
    item.hidden = !matches
  })

  setSelectedCommandIndex(0)
}

function runCommandItem(item) {
  const action = item.dataset.action
  const scrollTarget = item.dataset.scroll

  if (action === 'download') {
    const hostedAsset = hostedDownloads[activePlatform] || hostedDownloads.mac
    window.location.href = hostedAsset.url
    closeCommandPalette()
    return
  }

  if (action === 'github') {
    window.open(`https://github.com/${owner}/${repo}`, '_blank', 'noopener,noreferrer')
    closeCommandPalette()
    return
  }

  if (scrollTarget) {
    closeCommandPalette()
    document.querySelector(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

commandLaunchButton?.addEventListener('click', openCommandPalette)
commandScrim?.addEventListener('click', closeCommandPalette)

commandInput?.addEventListener('input', (event) => {
  filterCommandItems(event.currentTarget.value)
})

commandInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeCommandPalette()
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const visibleItems = visibleCommandItems()
    const activeItem = visibleItems[selectedCommandIndex] || visibleItems[0]
    if (activeItem) {
      runCommandItem(activeItem)
    }
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setSelectedCommandIndex(selectedCommandIndex + 1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    setSelectedCommandIndex(selectedCommandIndex - 1)
  }
})

commandItems.forEach((item) => {
  item.addEventListener('click', () => {
    runCommandItem(item)
  })

  item.addEventListener('mousemove', () => {
    const visibleItems = visibleCommandItems()
    const nextIndex = visibleItems.indexOf(item)
    if (nextIndex >= 0 && nextIndex !== selectedCommandIndex) {
      setSelectedCommandIndex(nextIndex)
    }
  })
})

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (commandPalette?.hidden === false) {
      closeCommandPalette()
    } else {
      openCommandPalette()
    }
    return
  }

  if (event.key === 'Escape' && commandPalette?.hidden === false) {
    event.preventDefault()
    closeCommandPalette()
  }
})

appStoreFilterBar?.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-section-filter]')
  if (!filterButton) {
    return
  }

  appStoreActiveSection = filterButton.dataset.sectionFilter || 'All'
  featuredRotationIndex = 0
  renderAppStoreCatalog(appStoreCatalog || fallbackCatalog)
})

appStoreSearchInput?.addEventListener('input', (event) => {
  appStoreSearchQuery = event.currentTarget.value || ''
  featuredRotationIndex = 0
  renderAppStoreCatalog(appStoreCatalog || fallbackCatalog)
})

function handleAppStoreInteraction(event) {
  const previewButton = event.target.closest('[data-preview-id]')
  if (previewButton) {
    event.preventDefault()
    openAppDetail(previewButton.dataset.previewId)
    return
  }

  const featuredButton = event.target.closest('[data-featured-index]')
  if (featuredButton) {
    event.preventDefault()
    featuredRotationIndex = Number(featuredButton.dataset.featuredIndex || 0)
    renderFeaturedStoreCard(featuredRotationItems[featuredRotationIndex], featuredRotationItems)
    observeStoreReveals()
    startFeaturedRotation()
  }
}

appStoreGrid?.addEventListener('click', handleAppStoreInteraction)
appStoreFeatured?.addEventListener('click', handleAppStoreInteraction)
appStoreFeatured?.addEventListener('mouseenter', stopFeaturedRotation)
appStoreFeatured?.addEventListener('mouseleave', startFeaturedRotation)

appDetailClose?.addEventListener('click', closeAppDetail)
appDetailOverlay?.addEventListener('click', (event) => {
  if (event.target === appDetailOverlay) {
    closeAppDetail()
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && appDetailOverlay && !appDetailOverlay.hidden) {
    event.preventDefault()
    closeAppDetail()
  }
})

loadLatestRelease()
startHeroTelemetry()
loadAppStoreCatalog()
