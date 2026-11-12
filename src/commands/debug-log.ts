import {readEnyoPackageConfig, selectSinglePackageConfig} from '../utils/file-utils.js';
import {CLIError, handleError} from '../utils/error-handler.js';
import {registryRequest} from '../utils/registry-api.js';
import {DEFAULT_DEBUG_LOG_MINUTES, parseMinutes} from '../utils/draft-release.js';
import {DEFAULT_REGISTRY_URL} from '../constants/defaults.js';
import type {DebugLogCommandOptions, PackageLogLevelResponse} from '../types';

/**
 * Switch one package's debug logs on an enyo Box on for a while, or off. The
 * box's own log level stays as it is, and the box ends the window by itself.
 */
export const debugLogCommand = async (options: DebugLogCommandOptions): Promise<void> => {
    try {
        if (!options.apiKey) {
            throw new CLIError('API key is required. Use --api-key <apiKey> to provide it.');
        }
        if (!options.device) {
            throw new CLIError('The enyo Box is required. Use --device <serial> to provide its serial number.');
        }
        if (options.off && options.minutes !== undefined) {
            throw new CLIError('Use either --minutes or --off, not both.');
        }

        const debugLogMinutes = options.off
            ? 0
            : options.minutes !== undefined ? parseMinutes(options.minutes) : DEFAULT_DEBUG_LOG_MINUTES;
        const config = await readEnyoPackageConfig(selectSinglePackageConfig(options.file));
        const registry = options.registry || DEFAULT_REGISTRY_URL;

        const result = await registryRequest<PackageLogLevelResponse>(
            `${registry}/api/package-registry/devices/${encodeURIComponent(options.device)}` +
            `/packages/${encodeURIComponent(config.packageName)}/log-level`,
            options.apiKey,
            {method: 'PUT', body: {debugLogMinutes}},
            'Setting the debug log level'
        );

        if (result.debugLogsUntilIso) {
            console.log(
                `🐛 Debug logs of ${config.packageName} on ${options.device} until ` +
                `${new Date(result.debugLogsUntilIso).toLocaleString()}`
            );
        } else {
            console.log(`🔕 Debug logs of ${config.packageName} on ${options.device} are off`);
        }
    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'setting the debug log level');
    }
};
