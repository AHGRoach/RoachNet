import { Head, Link, usePage } from '@inertiajs/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconExternalLink, IconSettings, IconShieldBolt, IconWand } from '@tabler/icons-react'
import Alert from '~/components/Alert'
import StyledButton from '~/components/StyledButton'
import Input from '~/components/inputs/Input'
import SettingsLayout from '~/layouts/SettingsLayout'
import useAIRuntimeStatus from '~/hooks/useAIRuntimeStatus'
import { useSystemSetting } from '~/hooks/useSystemSetting'
import { useSystemInfo } from '~/hooks/useSystemInfo'
import { useNotifications } from '~/context/NotificationContext'
import api from '~/lib/api'
import type { AIRuntimeProviderName, AIRuntimeStatus } from '../../../types/ai'
import type { KVStoreKey } from '../../../types/kv_store'
import type { SystemInformationResponse } from '../../../types/system'

type ProviderCardProps = {
  title: string
  providerLabel: string
  runtimeStatus: AIRuntimeStatus & { loading: boolean }
  configuredValue: string
  onConfiguredValueChange: (value: string) => void
  onSave: () => void
  savePending: boolean
  settingKey: KVStoreKey
  description: string
  helpText: string
  placeholder: string
  icon: ReactNode
  footer?: ReactNode
}

function ProviderCard({
  title,
  providerLabel,
  runtimeStatus,
  configuredValue,
  onConfiguredValueChange,
  onSave,
  savePending,
  settingKey,
  description,
  helpText,
  placeholder,
  icon,
  footer,
}: ProviderCardProps) {
  const statusLabel = runtimeStatus.available ? 'Linked' : runtimeStatus.loading ? 'Checking' : 'Offline'
  const statusClasses = runtimeStatus.available
    ? 'border-desert-green/40 bg-desert-green/15 text-desert-green-light'
    : runtimeStatus.loading
      ? 'border-desert-orange-light/40 bg-desert-orange/15 text-desert-orange-light'
      : 'border-desert-red-light/30 bg-desert-red/15 text-desert-red-light'

  return (
    <section className="roachnet-card rounded-[1.75rem] border border-border-default p-6 md:p-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="inline-flex rounded-2xl border border-border-default bg-surface-secondary/80 p-3 text-desert-green-light">
              {icon}
            </div>
            <div>
              <p className="roachnet-kicker text-[0.68rem] text-text-muted">AI Provider</p>
              <h2 className="text-2xl font-semibold uppercase tracking-[0.08em] text-text-primary">
                {title}
              </h2>
            </div>
          </div>

          <p className="max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.1rem] border border-border-default bg-surface-secondary/70 p-4">
              <p className="roachnet-kicker text-[0.64rem] text-text-muted">Status</p>
              <div className="mt-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusClasses}`}>
                  {statusLabel}
                </span>
              </div>
            </div>

            <div className="rounded-[1.1rem] border border-border-default bg-surface-secondary/70 p-4">
              <p className="roachnet-kicker text-[0.64rem] text-text-muted">Detected Via</p>
              <p className="mt-2 text-sm font-semibold uppercase tracking-[0.16em] text-text-primary">
                {runtimeStatus.source}
              </p>
            </div>

            <div className="rounded-[1.1rem] border border-border-default bg-surface-secondary/70 p-4">
              <p className="roachnet-kicker text-[0.64rem] text-text-muted">Effective URL</p>
              <p className="mt-2 break-all text-sm text-text-primary">
                {runtimeStatus.baseUrl || 'Not detected'}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full max-w-xl rounded-[1.4rem] border border-border-default bg-surface-secondary/70 p-5">
          <Input
            name={settingKey}
            label={`${providerLabel} Base URL`}
            value={configuredValue}
            onChange={(event) => onConfiguredValueChange(event.target.value)}
            placeholder={placeholder}
            helpText={helpText}
            autoComplete="off"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <StyledButton onClick={onSave} loading={savePending} icon="IconDeviceFloppy">
              Save Endpoint
            </StyledButton>
            <StyledButton
              variant="ghost"
              onClick={() => onConfiguredValueChange('')}
              disabled={savePending || configuredValue.length === 0}
              icon="IconEraser"
            >
              Clear Override
            </StyledButton>
          </div>

          {runtimeStatus.error && !runtimeStatus.loading && (
            <p className="mt-4 text-sm text-desert-red-light">{runtimeStatus.error}</p>
          )}
        </div>
      </div>

      {footer && <div className="mt-5 border-t border-border-subtle pt-5">{footer}</div>}
    </section>
  )
}

export default function AISettingsPage(props: {
  system: { info: SystemInformationResponse | undefined }
}) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { addNotification } = useNotifications()
  const queryClient = useQueryClient()

  const ollamaRuntime = useAIRuntimeStatus('ollama')
  const openClawRuntime = useAIRuntimeStatus('openclaw')
  const { data: systemInfo } = useSystemInfo({ initialData: props.system.info })

  const { data: ollamaBaseUrlSetting } = useSystemSetting({ key: 'ai.ollamaBaseUrl' })
  const { data: openClawBaseUrlSetting } = useSystemSetting({ key: 'ai.openclawBaseUrl' })

  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('')
  const [openClawBaseUrl, setOpenClawBaseUrl] = useState('')

  useEffect(() => {
    setOllamaBaseUrl(String(ollamaBaseUrlSetting?.value || ''))
  }, [ollamaBaseUrlSetting?.value])

  useEffect(() => {
    setOpenClawBaseUrl(String(openClawBaseUrlSetting?.value || ''))
  }, [openClawBaseUrlSetting?.value])

  const saveSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: KVStoreKey; value: string }) => {
      return await api.updateSetting(key, value.trim())
    },
    onSuccess: async (_, variables) => {
      addNotification({
        type: 'success',
        message: 'AI runtime endpoint saved. Re-checking provider status.',
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['system-setting', variables.key] }),
        queryClient.invalidateQueries({ queryKey: ['ai-runtime-providers'] }),
      ])
    },
    onError: (error) => {
      console.error('Failed to save AI runtime setting:', error)
      addNotification({
        type: 'error',
        message: 'Failed to save AI runtime setting.',
      })
    },
  })

  const handleSaveProvider = (provider: AIRuntimeProviderName) => {
    if (provider === 'ollama') {
      saveSettingMutation.mutate({
        key: 'ai.ollamaBaseUrl',
        value: ollamaBaseUrl,
      })
      return
    }

    saveSettingMutation.mutate({
      key: 'ai.openclawBaseUrl',
      value: openClawBaseUrl,
    })
  }

  return (
    <SettingsLayout>
      <Head title="AI Control | RoachNet" />
      <div className="xl:pl-72 w-full">
        <main className="px-6 py-6 lg:px-12 lg:py-8">
          <div className="mb-8 space-y-4">
            <p className="roachnet-kicker text-xs text-desert-green-light">Runtime Control</p>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-4xl space-y-3">
                <h1 className="text-4xl font-semibold uppercase tracking-[0.12em] text-text-primary">
                  AI Control
                </h1>
                <p className="text-base leading-7 text-text-secondary">
                  Link RoachNet to local AI runtimes, override provider endpoints, and verify which
                  services are reachable before deeper Ollama or OpenClaw workflows are enabled.
                </p>
              </div>

              <div className="roachnet-card rounded-full px-4 py-2 text-xs uppercase tracking-[0.24em] text-text-secondary">
                First OpenClaw Cut
              </div>
            </div>
          </div>

          <Alert
            type="info"
            variant="bordered"
            title="Scope of this pass"
            message="This page wires provider discovery and endpoint overrides into RoachNet. Ollama chat and models are live today. OpenClaw is currently a runtime-health integration layer that prepares the UI for later agent and connector work."
            className="!mb-8"
          />

          {systemInfo?.hardwareProfile?.isAppleSilicon && (
            <Alert
              type="success"
              variant="bordered"
              title="Apple Silicon Optimization Active"
              message="RoachNet detected Apple Silicon and will prefer native local runtimes. Keep Ollama or OpenClaw on arm64-native loopback endpoints when possible to avoid Docker and Rosetta overhead."
              className="!mb-8"
            />
          )}

          <div className="space-y-6">
            <ProviderCard
              title={aiAssistantName}
              providerLabel="Ollama"
              runtimeStatus={ollamaRuntime}
              configuredValue={ollamaBaseUrl}
              onConfiguredValueChange={setOllamaBaseUrl}
              onSave={() => handleSaveProvider('ollama')}
              savePending={saveSettingMutation.isPending}
              settingKey="ai.ollamaBaseUrl"
              description="RoachNet uses Ollama for local chat, model downloads, and benchmarking. You can point it at a loopback daemon, another local port, or a remote host on your network."
              helpText="Leave this blank to fall back to OLLAMA_BASE_URL, then local discovery on 127.0.0.1:11434, then the managed Docker runtime."
              placeholder="http://127.0.0.1:11434"
              icon={<IconWand className="size-7" />}
              footer={
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/settings/models"
                    className="inline-flex items-center text-sm font-semibold text-desert-green-light hover:underline"
                  >
                    Open {aiAssistantName} Model Controls
                    <IconExternalLink className="ml-1 size-4" />
                  </Link>
                </div>
              }
            />

            <ProviderCard
              title="OpenClaw"
              providerLabel="OpenClaw"
              runtimeStatus={openClawRuntime}
              configuredValue={openClawBaseUrl}
              onConfiguredValueChange={setOpenClawBaseUrl}
              onSave={() => handleSaveProvider('openclaw')}
              savePending={saveSettingMutation.isPending}
              settingKey="ai.openclawBaseUrl"
              description="This first OpenClaw integration pass adds endpoint discovery and reachability checks so RoachNet can expose OpenClaw as a first-class runtime next to Ollama instead of treating it as an external afterthought."
              helpText="Set the OpenClaw base URL here or provide OPENCLAW_BASE_URL in the environment. RoachNet will probe /health, /api/health, and / to confirm reachability."
              placeholder="http://127.0.0.1:3001"
              icon={<IconShieldBolt className="size-7" />}
              footer={
                <div className="rounded-[1.1rem] border border-border-default bg-surface-secondary/70 p-4">
                  <div className="flex items-start gap-3">
                    <IconSettings className="mt-0.5 size-5 text-desert-orange-light" />
                    <p className="text-sm leading-6 text-text-secondary">
                      OpenClaw agent, connector, and onboarding controls are not wired yet. This
                      page establishes the runtime contract so those surfaces can be added cleanly
                      in the next pass.
                    </p>
                  </div>
                </div>
              }
            />
          </div>
        </main>
      </div>
    </SettingsLayout>
  )
}
