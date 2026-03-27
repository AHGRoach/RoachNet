/// <reference path="../../adonisrc.ts" />
/// <reference path="../../config/inertia.ts" />

import '../css/app.css'
import { createRoot } from 'react-dom/client'
import { useEffect, useState, type ComponentType } from 'react'
import { createInertiaApp } from '@inertiajs/react'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import ModalsProvider from '~/providers/ModalProvider'
import { TransmitProvider } from 'react-adonis-transmit'
import { generateUUID } from '~/lib/util'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationsProvider from '~/providers/NotificationProvider'
import { ThemeProvider } from '~/providers/ThemeProvider'
import { UsePageProps } from '../../types/system'

const appName = import.meta.env.VITE_APP_NAME || 'RoachNet'
const queryClient = new QueryClient()

type DevtoolsComponent = ComponentType<{
  initialIsOpen?: boolean
  buttonPosition?:
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | undefined
}>

function DeferredReactQueryDevtools({ enabled }: { enabled: boolean }) {
  const [Devtools, setDevtools] = useState<DevtoolsComponent | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let isCancelled = false

    import('@tanstack/react-query-devtools').then((module) => {
      if (!isCancelled) {
        setDevtools(() => module.ReactQueryDevtools)
      }
    })

    return () => {
      isCancelled = true
    }
  }, [enabled])

  if (!enabled || !Devtools) {
    return null
  }

  return <Devtools initialIsOpen={false} buttonPosition="bottom-left" />
}

// Patch the global crypto object for non-HTTPS/localhost contexts
if (!window.crypto?.randomUUID) {
  // @ts-ignore
  if (!window.crypto) window.crypto = {}
  // @ts-ignore
  window.crypto.randomUUID = generateUUID
}

createInertiaApp({
  progress: { color: '#00ff66' },

  title: (title) => `${title} - ${appName}`,

  resolve: (name) => {
    return resolvePageComponent(`../pages/${name}.tsx`, import.meta.glob('../pages/**/*.tsx'))
  },

  setup({ el, App, props }) {
    const environment = (props.initialPage.props as unknown as UsePageProps).environment
    const showDevtools = ['development', 'staging'].includes(environment)
    createRoot(el).render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TransmitProvider baseUrl={window.location.origin} enableLogging={environment === 'development'}>
            <NotificationsProvider>
              <ModalsProvider>
                <App {...props} />
                <DeferredReactQueryDevtools enabled={showDevtools} />
              </ModalsProvider>
            </NotificationsProvider>
          </TransmitProvider>
        </ThemeProvider>
      </QueryClientProvider>
    )
  },
})
