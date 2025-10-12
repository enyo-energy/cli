import { installDevPackage } from '../dev-package-installer.js';
import { readConnectEmsPackageConfig, ensureFileExists } from '../utils/file-utils.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { FILE_NAMES, DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { CommandOptions } from '../types/index.js';

export const installCommand = async (options: CommandOptions): Promise<void> => {
    try {
        ensureFileExists(FILE_NAMES.PACKAGE_CONFIG, 'Package configuration');

        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        console.log('📖 Reading package configuration...');
        const config = await readConnectEmsPackageConfig(FILE_NAMES.PACKAGE_CONFIG);
        console.log(`📦 Loaded package: ${config.packageName} v${config.version}`);

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`🔧 Installing to device at ${deviceHost}:${devicePort}...`);
        await installDevPackage(deviceHost, devicePort, options.token, config);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'installing package');
    }
};