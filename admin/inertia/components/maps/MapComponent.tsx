import { useEffect, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { Protocol as PMTilesProtocol } from 'pmtiles'

type MapLibreNamespace = typeof maplibregl
type PMTilesProtocolConstructor = typeof import('pmtiles').Protocol

const DEFAULT_MAP_STYLE_PATH = '/api/maps/styles'

let sharedPMTilesProtocol: PMTilesProtocol | null = null
let sharedPMTilesProtocolUsers = 0

function registerPMTilesProtocol(maplibre: MapLibreNamespace, Protocol: PMTilesProtocolConstructor) {
  if (!sharedPMTilesProtocol) {
    sharedPMTilesProtocol = new Protocol()
    maplibre.addProtocol('pmtiles', sharedPMTilesProtocol.tile)
  }

  sharedPMTilesProtocolUsers += 1

  return () => {
    sharedPMTilesProtocolUsers = Math.max(0, sharedPMTilesProtocolUsers - 1)

    if (sharedPMTilesProtocolUsers === 0 && sharedPMTilesProtocol) {
      maplibre.removeProtocol('pmtiles')
      sharedPMTilesProtocol = null
    }
  }
}

export default function MapComponent({
  mapStylePath = DEFAULT_MAP_STYLE_PATH,
}: {
  mapStylePath?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapFailed, setMapFailed] = useState(false)

  useEffect(() => {
    let map: maplibregl.Map | null = null
    let cancelled = false
    let cleanupProtocol = () => {}
    let mapLoadTimeout = 0
    let rafId = 0

    const mountMap = async () => {
      if (!containerRef.current) {
        return
      }

      try {
        const [{ default: maplibre }, { Protocol }] = await Promise.all([
          import('maplibre-gl'),
          import('pmtiles'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ])

        if (cancelled || !containerRef.current) {
          return
        }

        cleanupProtocol = registerPMTilesProtocol(maplibre, Protocol)

        map = new maplibre.Map({
          attributionControl: false,
          container: containerRef.current,
          center: [-101, 40],
          cooperativeGestures: true,
          fadeDuration: 0,
          pitchWithRotate: false,
          refreshExpiredTiles: false,
          style: new URL(mapStylePath, window.location.origin).toString(),
          zoom: 3.5,
        })

        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right')
        map.addControl(new maplibre.FullscreenControl(), 'top-right')

        map.once('load', () => {
          if (!cancelled) {
            window.clearTimeout(mapLoadTimeout)
            setMapReady(true)
          }
        })

        mapLoadTimeout = window.setTimeout(() => {
          if (!cancelled) {
            setMapFailed(true)
          }
        }, 12000)

        map.on('error', (event) => {
          const error = event.error
          if (!cancelled && error instanceof Error && /style|source|sprite|glyph/i.test(error.message)) {
            setMapFailed(true)
          }
        })
      } catch (error) {
        console.error('Failed to initialize map engine', error)
        if (!cancelled) {
          setMapFailed(true)
        }
      }
    }

    rafId = window.requestAnimationFrame(() => {
      void mountMap()
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(mapLoadTimeout)
      map?.remove()
      cleanupProtocol()
    }
  }, [mapStylePath])

  return (
    <div className="roachnet-map-shell">
      <div ref={containerRef} className="roachnet-map-canvas" />
      {!mapReady && !mapFailed && (
        <div className="roachnet-map-status">
          <div className="roachnet-card rounded-[1.5rem] border border-border-default px-6 py-5 text-sm uppercase tracking-[0.2em] text-text-secondary">
            Loading Map Engine
          </div>
        </div>
      )}
      {mapFailed && (
        <div className="roachnet-map-status p-6">
          <div className="roachnet-card max-w-xl rounded-[1.75rem] border border-desert-orange/40 px-6 py-6 text-center">
            <p className="roachnet-kicker text-xs text-desert-orange-light">Map Engine Fault</p>
            <h2 className="mt-3 text-xl font-semibold text-text-primary">RoachNet could not initialize the offline map stack.</h2>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Confirm the base map package is installed and the generated style endpoint is reachable, then reload the page.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
