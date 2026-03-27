import { lazy, Suspense } from 'react'
import MapsLayout from '~/layouts/MapsLayout'
import { Head, Link } from '@inertiajs/react'
import StyledButton from '~/components/StyledButton'
import { IconArrowLeft } from '@tabler/icons-react'
import { FileEntry } from '../../types/files'
import Alert from '~/components/Alert'

const LazyMapComponent = lazy(() => import('~/components/maps/MapComponent'))

export default function Maps(props: {
  maps: { baseAssetsExist: boolean; regionFiles: FileEntry[] }
}) {
  const canRenderMap = props.maps.baseAssetsExist && props.maps.regionFiles.length > 0
  const alertMessage = !props.maps.baseAssetsExist
    ? 'The base map assets have not been installed. Please download them first to enable map functionality.'
    : props.maps.regionFiles.length === 0
      ? 'No map regions have been downloaded yet. Please download some regions to enable map functionality.'
      : null

  return (
    <MapsLayout>
      <Head title="Maps" />
      <div className="relative w-full h-screen overflow-hidden">
        {/* Nav and alerts are overlayed */}
        <div className="absolute top-0 left-0 right-0 z-50 flex justify-between p-4 bg-surface-secondary backdrop-blur-sm shadow-sm">
          <Link href="/home" className="flex items-center">
            <IconArrowLeft className="mr-2" size={24} />
            <p className="text-lg text-text-secondary">Back to Home</p>
          </Link>
          <Link href="/settings/maps" className='mr-4'>
            <StyledButton variant="primary" icon="IconSettings">
              Manage Map Regions
            </StyledButton>
          </Link>
        </div>
        {alertMessage && (
          <div className="absolute top-20 left-4 right-4 z-50">
            <Alert
              title={alertMessage}
              type="warning"
              variant="solid"
              className="w-full"
              buttonProps={{
                variant: 'secondary',
                children: 'Go to Map Settings',
                icon: 'IconSettings',
                onClick: () => {
                  window.location.href = '/settings/maps'
                },
              }}
            />
          </div>
        )}
        <div className="absolute inset-0">
          {canRenderMap ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-surface-primary">
                  <div className="roachnet-card rounded-[1.5rem] border border-border-default px-6 py-5 text-sm uppercase tracking-[0.2em] text-text-secondary">
                    Loading Map Engine
                  </div>
                </div>
              }
            >
              <LazyMapComponent />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_18%_22%,rgba(0,255,0,0.15),transparent_22%),radial-gradient(circle_at_84%_18%,rgba(255,0,255,0.14),transparent_20%),linear-gradient(145deg,rgba(7,11,14,0.98),rgba(13,18,24,0.96))] px-6">
              <div className="roachnet-card w-full max-w-4xl rounded-[2rem] border border-border-default p-8 md:p-10">
                <p className="roachnet-kicker text-xs text-desert-green-light">Offline Maps</p>
                <h1 className="mt-4 text-3xl font-semibold tracking-[0.06em] text-text-primary md:text-4xl">
                  RoachNet map engine is standing by.
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-text-secondary md:text-base">
                  The PMTiles renderer only spins up when the local atlas is complete. Install the base package and at least one regional archive to activate offline navigation without wasting CPU, memory, or battery.
                </p>
                <div className="mt-8 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-border-default bg-surface-secondary/80 p-5">
                    <p className="roachnet-kicker text-[11px] text-desert-orange-light">Base Package</p>
                    <p className="mt-3 text-xl font-semibold text-text-primary">
                      {props.maps.baseAssetsExist ? 'Installed' : 'Missing'}
                    </p>
                    <p className="mt-2 text-sm text-text-secondary">
                      Core style, sprite, and glyph assets required to render the local atlas.
                    </p>
                  </div>
                  <div className="rounded-[1.35rem] border border-border-default bg-surface-secondary/80 p-5">
                    <p className="roachnet-kicker text-[11px] text-desert-green-light">Regional Archives</p>
                    <p className="mt-3 text-xl font-semibold text-text-primary">{props.maps.regionFiles.length} Ready</p>
                    <p className="mt-2 text-sm text-text-secondary">
                      Downloaded PMTiles region bundles currently available for offline map playback.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </MapsLayout>
  )
}
