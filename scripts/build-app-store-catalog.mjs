import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const paths = {
  maps: path.join(repoRoot, 'website/collections/maps.json'),
  kiwix: path.join(repoRoot, 'website/collections/kiwix-categories.json'),
  wikipedia: path.join(repoRoot, 'website/collections/wikipedia.json'),
  output: path.join(repoRoot, 'website/app-store-catalog.json'),
}

const mapAccentCycle = ['blue', 'cyan', 'green', 'violet', 'gold', 'bronze']
const categoryAccents = {
  medicine: 'green',
  survival: 'gold',
  education: 'blue',
  diy: 'bronze',
  agriculture: 'green',
  computing: 'violet',
  'machine-learning': 'cyan',
  'music-audio': 'magenta',
  'it-infrastructure': 'bronze',
}

const categoryBands = {
  medicine: 'MED',
  survival: 'FIELD',
  education: 'EDU',
  diy: 'FIX',
  agriculture: 'GROW',
  computing: 'DEV',
  'machine-learning': 'ML',
  'music-audio': 'AUDIO',
  'it-infrastructure': 'OPS',
}

const courseStatusMap = {
  essential: 'Great first install',
  standard: 'Recommended next install',
  comprehensive: 'Deep archive',
}

const wikipediaStatusMap = {
  'top-mini': 'Best first install',
  'top-nopic': 'Popular',
  'all-mini': 'Compact full library',
  'all-nopic': 'Deep archive',
  'all-maxi': 'Largest install',
}

const aiPacks = [
  {
    id: 'roachclaw-quickstart',
    title: 'RoachClaw Quickstart',
    subtitle: 'Contained qwen2.5-coder:1.5b model',
    category: 'Local AI',
    section: 'Model Packs',
    size: '1.5 GB',
    status: 'Best first boot',
    source: 'Contained Ollama lane',
    summary:
      'Get RoachClaw talking quickly on a clean machine with the small contained coding model RoachNet already recommends for first boot.',
    accent: 'violet',
    machineFit: 'Best on all Apple Silicon Macs, especially 16 GB machines',
    includes: [
      'Contained Ollama-backed model download',
      'Fastest local coding lane for first launch',
      'Cloud lane can stay available while the model warms up',
    ],
    installIntent: {
      action: 'roachclaw-model',
      model: 'qwen2.5-coder:1.5b',
    },
    iconBand: 'RoachClaw',
    iconMonogram: 'Q15',
  },
  {
    id: 'roachclaw-studio',
    title: 'RoachClaw Studio',
    subtitle: 'Contained qwen2.5-coder:7b upgrade',
    category: 'Local AI',
    section: 'Model Packs',
    size: '4.8 GB',
    status: 'For larger Apple Silicon Macs',
    source: 'Contained Ollama lane',
    summary:
      'Move up to the larger local coding lane for longer refactors, stronger reasoning, and more comfortable day-to-day coding assist.',
    accent: 'violet',
    machineFit: 'Best on M2 Pro, Max, and higher-memory Apple Silicon',
    includes: [
      'Contained 7B coding model queue',
      'RoachClaw workbench handoff in the native shell',
      'Better room for heavier coding and agent tasks',
    ],
    installIntent: {
      action: 'roachclaw-model',
      model: 'qwen2.5-coder:7b',
    },
    iconBand: 'RoachClaw',
    iconMonogram: 'Q7B',
  },
  {
    id: 'roachclaw-generalist',
    title: 'RoachClaw Generalist',
    subtitle: 'Contained qwen2.5:7b everyday model',
    category: 'Local AI',
    section: 'Model Packs',
    size: '4.7 GB',
    status: 'Balanced local lane',
    source: 'Contained Ollama lane',
    summary:
      'A broader local model for notes, drafting, planning, and general assistant work when you want something less coding-specific than the default lane.',
    accent: 'cyan',
    machineFit: 'Best on Macs with enough memory for a comfortable always-on local lane',
    includes: [
      'Contained general-purpose local model',
      'Works well for notes, drafts, summaries, and planning',
      'RoachNet still keeps the cloud lane optional',
    ],
    installIntent: {
      action: 'roachclaw-model',
      model: 'qwen2.5:7b',
    },
    iconBand: 'RoachClaw',
    iconMonogram: 'Q7',
  },
  {
    id: 'roachclaw-coder-large',
    title: 'RoachClaw Coder Large',
    subtitle: 'Contained qwen2.5-coder:14b lane',
    category: 'Local AI',
    section: 'Model Packs',
    size: '9.0 GB',
    status: 'Heavy local install',
    source: 'Contained Ollama lane',
    summary:
      'A bigger local coding model for machines with real headroom and users who want the strongest local-first Dev Studio pairing RoachNet can comfortably stage.',
    accent: 'magenta',
    machineFit: 'Best on higher-memory Apple Silicon and Exo-assisted setups',
    includes: [
      'Contained 14B coding model queue',
      'Pairs well with Exo-enabled multi-machine routing',
      'Intended for serious local coding sessions',
    ],
    installIntent: {
      action: 'roachclaw-model',
      model: 'qwen2.5-coder:14b',
    },
    iconBand: 'RoachClaw',
    iconMonogram: 'Q14',
  },
]

function formatSizeFromMB(sizeMB) {
  if (!Number.isFinite(sizeMB) || sizeMB <= 0) {
    return 'Unknown size'
  }

  if (sizeMB >= 1024) {
    const sizeGB = sizeMB / 1024
    return `${sizeGB >= 10 ? sizeGB.toFixed(0) : sizeGB.toFixed(1)} GB`
  }

  return `${Math.round(sizeMB)} MB`
}

function titleCaseWords(value) {
  return String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function shortMonogram(value, maxLength = 3) {
  const segments = String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)

  if (segments.length >= 2) {
    return segments
      .slice(0, 3)
      .map((segment) => segment.charAt(0).toUpperCase())
      .join('')
      .slice(0, maxLength)
  }

  const compact = segments.join('').replace(/[^a-z0-9]/gi, '').toUpperCase()
  return compact.slice(0, maxLength) || 'RN'
}

function resourceHighlights(resources, limit = 3) {
  return resources.slice(0, limit).map((resource) => resource.title)
}

function tierLevel(slug) {
  if (slug.includes('essential')) return 'essential'
  if (slug.includes('standard')) return 'standard'
  return 'comprehensive'
}

function iconAccentForTier(categorySlug, tierSlug) {
  const base = categoryAccents[categorySlug] || 'blue'
  const level = tierLevel(tierSlug)

  if (level === 'standard' && base === 'green') return 'cyan'
  if (level === 'comprehensive' && base === 'blue') return 'violet'
  if (level === 'comprehensive' && base === 'green') return 'gold'
  return base
}

function machineFitForSize(sizeMB) {
  if (!Number.isFinite(sizeMB) || sizeMB <= 0) {
    return 'Good for any healthy RoachNet install'
  }

  if (sizeMB <= 128) {
    return 'Fast add-on for any supported machine'
  }

  if (sizeMB <= 1024) {
    return 'Easy install once the core workspace is already healthy'
  }

  if (sizeMB <= 4096) {
    return 'Best on installs with real storage headroom'
  }

  return 'Large offline shelf best staged after the main runtime is settled'
}

function sourceLabelForResource(resource) {
  const url = resource.url || ''

  if (url.includes('/freecodecamp/')) return 'freeCodeCamp via Kiwix'
  if (url.includes('/videos/coreyms_')) return 'Corey Schafer via Kiwix'
  if (url.includes('/zimit/docs.python.org')) return 'Python Docs via Kiwix'
  if (url.includes('/devdocs/')) return 'DevDocs via Kiwix'
  if (url.includes('/ted/')) return 'TED via Kiwix'
  if (url.includes('/zimit/openmusictheory.com')) return 'Open Music Theory via Kiwix'
  if (url.includes('/zimit/music.dalitio.de')) return 'Dalitio via Kiwix'
  if (url.includes('/zimit/cloudflare.com')) return 'Cloudflare Learning Center via Kiwix'
  if (url.includes('/other/archlinux')) return 'Arch Linux docs via Kiwix'
  if (url.includes('/other/alpinelinux')) return 'Alpine Linux docs via Kiwix'

  return 'RoachNet knowledge mirror'
}

function modelPackInstallLabel() {
  return 'Install to RoachNet'
}

function toCatalog() {
  return Promise.all([
    readFile(paths.maps, 'utf8').then(JSON.parse),
    readFile(paths.kiwix, 'utf8').then(JSON.parse),
    readFile(paths.wikipedia, 'utf8').then(JSON.parse),
  ]).then(([mapsData, kiwixData, wikipediaData]) => {
    const baseAtlas = {
      id: 'base-atlas',
      title: 'Base Atlas',
      subtitle: 'Core renderer and shared basemap',
      category: 'Maps',
      section: 'Map Regions',
      size: '320 MB',
      status: 'Required first install',
      source: 'RoachNet mirror',
      summary:
        'Install the shared vector atlas and base map assets first so every regional collection opens cleanly inside the native Maps lane.',
      featured: true,
      accent: 'blue',
      machineFit: 'Best first install on every supported machine',
      includes: [
        'Shared vector atlas and renderer assets',
        'Required before regional map collections',
        'Installs directly into the native Maps lane',
      ],
      installLabel: modelPackInstallLabel(),
      detailLabel: 'View manifest',
      detailUrl: './collections/maps.json',
      installIntent: {
        action: 'base-map-assets',
      },
      iconBand: 'RoachNet',
      iconMonogram: 'MAP',
    }

    const mapItems = mapsData.collections.map((collection, index) => {
      const totalSizeMB = collection.resources.reduce((sum, resource) => sum + (resource.size_mb || 0), 0)
      const regionNames = collection.resources
        .slice(0, 5)
        .map((resource) => titleCaseWords(resource.title))
        .join(', ')

      return {
        id: `map-${collection.slug}`,
        title: collection.name,
        subtitle: regionNames,
        category: 'Maps',
        section: 'Map Regions',
        size: formatSizeFromMB(totalSizeMB),
        status: index === 0 ? 'Recommended first region' : 'Ready',
        source: 'RoachNet map mirror',
        summary: collection.description,
        accent: mapAccentCycle[index % mapAccentCycle.length],
        machineFit:
          totalSizeMB <= 4096
            ? 'Good first regional lane once Base Atlas is installed'
            : 'Best staged after the runtime and map lane are already healthy',
        includes: [
          `${collection.resources.length} regional map resources`,
          ...resourceHighlights(collection.resources, 2),
        ],
        installLabel: modelPackInstallLabel(),
        detailLabel: 'Open collection manifest',
        detailUrl: './collections/maps.json',
        installIntent: {
          action: 'map-collection',
          slug: collection.slug,
        },
        iconBand: 'Maps',
        iconMonogram: shortMonogram(collection.name),
      }
    })

    const educationItems = kiwixData.categories.flatMap((category) =>
      category.tiers.flatMap((tier) => {
        const level = tierLevel(tier.slug)
        const tierLabel = titleCaseWords(tier.name)

        return tier.resources.map((resource) => ({
          id: `course-${resource.id}`,
          title: resource.title,
          subtitle: resource.description,
          category: tierLabel,
          section: category.name,
          size: formatSizeFromMB(resource.size_mb),
          status: courseStatusMap[level] || 'Ready',
          source: sourceLabelForResource(resource),
          summary: `${resource.title} installs as its own RoachNet course app, so you can pull exactly this shelf into the native Education lane without dragging in a whole provider bundle.`,
          accent: iconAccentForTier(category.slug, tier.slug),
          machineFit: machineFitForSize(resource.size_mb),
          includes: [
            resource.description,
            `Part of the ${tierLabel.toLowerCase()} ${category.name.toLowerCase()} shelf`,
            `Version ${resource.version}`,
          ],
          installLabel: modelPackInstallLabel(),
          detailLabel: 'Open manifest',
          detailUrl: './collections/kiwix-categories.json',
          installIntent: {
            action: 'education-resource',
            category: category.slug,
            resource: resource.id,
          },
          iconBand: categoryBands[category.slug] || shortMonogram(category.name, 4),
          iconMonogram: shortMonogram(resource.title, 4),
        }))
      })
    )

    const wikipediaItems = wikipediaData.options
      .filter((option) => option.id !== 'none')
      .map((option) => ({
        id: `wiki-${option.id}`,
        title: option.name,
        subtitle: option.description,
        category: 'Wikipedia',
        section: 'Wikipedia',
        size: formatSizeFromMB(option.size_mb),
        status: wikipediaStatusMap[option.id] || 'Ready',
        source: 'Kiwix mirror',
        summary:
          'Pick the Wikipedia footprint that makes sense for this machine, then let RoachNet queue the selection directly into the Education lane.',
        accent: option.id.includes('maxi') ? 'magenta' : option.id.includes('all') ? 'violet' : 'blue',
        machineFit:
          option.id === 'top-mini'
            ? 'Fastest encyclopedia option for first boot'
            : option.id.includes('all')
              ? 'Best for long-lived offline installs with real storage headroom'
              : 'Good balance of size and reach for daily offline lookup work',
        includes: [
          option.description,
          `Version ${option.version || 'current mirror'}`,
          'Queued directly into RoachNet’s Wikipedia lane',
        ],
        installLabel: modelPackInstallLabel(),
        detailLabel: 'View options',
        detailUrl: './collections/wikipedia.json',
        installIntent: {
          action: 'wikipedia-option',
          option: option.id,
        },
        iconBand: 'WIKI',
        iconMonogram: shortMonogram(option.name),
      }))

    const items = [
      baseAtlas,
      ...mapItems,
      ...educationItems,
      ...wikipediaItems,
      ...aiPacks.map((item) => ({
        ...item,
        installLabel: modelPackInstallLabel(),
        detailLabel: 'Open RoachClaw',
        detailUrl: 'https://roachnet.org/#screens',
      })),
    ]

    return {
      updatedAt: new Date().toISOString(),
      featuredId: 'base-atlas',
      items,
    }
  })
}

const catalog = await toCatalog()
await writeFile(paths.output, JSON.stringify(catalog, null, 2) + '\n', 'utf8')
console.log(`Wrote ${catalog.items.length} App Store items to ${path.relative(repoRoot, paths.output)}`)
