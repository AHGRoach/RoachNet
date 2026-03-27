import { useQuery } from '@tanstack/react-query'
import api from '~/lib/api'
import type {
  AIRuntimeProviderName,
  AIRuntimeProvidersResponse,
  AIRuntimeStatus,
} from '../../types/ai'

const buildUnavailableRuntimeStatus = (provider: AIRuntimeProviderName): AIRuntimeStatus => ({
  provider,
  available: false,
  source: 'none',
  baseUrl: null,
  error: null,
})

const useAIRuntimeStatus = (provider: AIRuntimeProviderName) => {
  const { data, isFetching } = useQuery<AIRuntimeProvidersResponse | undefined>({
    queryKey: ['ai-runtime-providers'],
    queryFn: () => api.getAIRuntimeProviders(),
    staleTime: 15000,
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const runtimeStatus = data?.providers[provider] || buildUnavailableRuntimeStatus(provider)

  return {
    ...runtimeStatus,
    loading: isFetching,
  }
}

export default useAIRuntimeStatus
