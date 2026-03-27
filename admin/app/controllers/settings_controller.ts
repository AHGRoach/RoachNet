import KVStore from '#models/kv_store';
import { AIRuntimeService } from '#services/ai_runtime_service';
import { BenchmarkService } from '#services/benchmark_service';
import { MapService } from '#services/map_service';
import { OllamaService } from '#services/ollama_service';
import { SystemService } from '#services/system_service';
import { UpstreamSyncService } from '#services/upstream_sync_service';
import { updateSettingSchema } from '#validators/settings';
import { inject } from '@adonisjs/core';
import logger from '@adonisjs/core/services/logger';
import type { HttpContext } from '@adonisjs/core/http'
import type { KVStoreKey } from '../../types/kv_store.js';

@inject()
export default class SettingsController {
    constructor(
        private systemService: SystemService,
        private mapService: MapService,
        private benchmarkService: BenchmarkService,
        private ollamaService: OllamaService,
        private aiRuntimeService: AIRuntimeService,
        private upstreamSyncService: UpstreamSyncService
    ) { }

    async system({ inertia }: HttpContext) {
        const systemInfo = await this.systemService.getSystemInfo();
        return inertia.render('settings/system', {
            system: {
                info: systemInfo
            }
        });
    }

    async apps({ inertia }: HttpContext) {
        const services = await this.systemService.getServices({ installedOnly: false });
        return inertia.render('settings/apps', {
            system: {
                services
            }
        });
    }

    async ai({ inertia }: HttpContext) {
        const systemInfo = await this.systemService.getSystemInfo();
        return inertia.render('settings/ai', {
            system: {
                info: systemInfo
            }
        });
    }
    
    async legal({ inertia }: HttpContext) {
        return inertia.render('settings/legal');
    }

    async support({ inertia }: HttpContext) {
        return inertia.render('settings/support');
    }

    async maps({ inertia }: HttpContext) {
        const baseAssetsCheck = await this.mapService.ensureBaseAssets();
        const regionFiles = await this.mapService.listRegions();
        return inertia.render('settings/maps', {
            maps: {
                baseAssetsExist: baseAssetsCheck,
                regionFiles: regionFiles.files
            }
        });
    }

    async models({ inertia }: HttpContext) {
        const [availableModels, runtimeStatus, chatSuggestionsEnabled, aiAssistantCustomName] = await Promise.all([
            this.ollamaService.getAvailableModels({ sort: 'pulls', recommendedOnly: false, query: null, limit: 15 }),
            this.aiRuntimeService.getProvider('ollama'),
            KVStore.getValue('chat.suggestionsEnabled'),
            KVStore.getValue('ai.assistantCustomName'),
        ])

        let installedModels: Awaited<ReturnType<OllamaService['getModels']>> = []
        if (runtimeStatus.available) {
            try {
                installedModels = await this.ollamaService.getModels()
            } catch (error) {
                logger.warn(
                    `[SettingsController] Failed to fetch installed Ollama models: ${error instanceof Error ? error.message : error}`
                )
            }
        }

        return inertia.render('settings/models', {
            models: {
                availableModels: availableModels?.models || [],
                installedModels: installedModels || [],
                runtimeStatus,
                settings: {
                    chatSuggestionsEnabled: chatSuggestionsEnabled ?? false,
                    aiAssistantCustomName: aiAssistantCustomName ?? '',
                }
            }
        });
    }

    async update({ inertia }: HttpContext) {
        const [updateInfo, upstreamSyncStatus, earlyAccess] = await Promise.all([
            this.systemService.checkLatestVersion(),
            this.upstreamSyncService.getStatus(false),
            KVStore.getValue('system.earlyAccess'),
        ])
        return inertia.render('settings/update', {
            system: {
                updateAvailable: updateInfo.updateAvailable,
                latestVersion: updateInfo.latestVersion,
                currentVersion: updateInfo.currentVersion,
                earlyAccess: earlyAccess ?? false,
                upstreamSync: upstreamSyncStatus,
            }
        });
    }

    async zim({ inertia }: HttpContext) {
        return inertia.render('settings/zim/index')
    }

    async zimRemote({ inertia }: HttpContext) {
        return inertia.render('settings/zim/remote-explorer');
    }

    async benchmark({ inertia }: HttpContext) {
        const latestResult = await this.benchmarkService.getLatestResult();
        const status = this.benchmarkService.getStatus();
        return inertia.render('settings/benchmark', {
            benchmark: {
                latestResult,
                status: status.status,
                currentBenchmarkId: status.benchmarkId
            }
        });
    }

    async getSetting({ request, response }: HttpContext) {
        const key = request.qs().key;
        const value = await KVStore.getValue(key as KVStoreKey);
        return response.status(200).send({ key, value });
    }

    async updateSetting({ request, response }: HttpContext) {
        const reqData = await request.validateUsing(updateSettingSchema);
        await this.systemService.updateSetting(reqData.key, reqData.value);
        return response.status(200).send({ success: true, message: 'Setting updated successfully' });
    }
}
