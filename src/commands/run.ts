import fs from 'fs';
import path from 'path';
import { runPackageInVM } from '../run.js';
import { readConnectEmsPackageConfig, ensureFileExists } from '../utils/file-utils.js';
import { FILE_NAMES } from '../constants/defaults.js';
import { CLIError, handleError } from '../utils/error-handler.js';

export const runCommand = async (): Promise<void> => {
    try {
        ensureFileExists(FILE_NAMES.PACKAGE_CONFIG, 'Package configuration');

        console.log('📖 Reading package configuration...');
        const config = await readConnectEmsPackageConfig(FILE_NAMES.PACKAGE_CONFIG);
        console.log(`📦 Loaded package: ${config.packageName} v${config.version}`);

        const distPath = path.join(process.cwd(), FILE_NAMES.DIST_INDEX);
        ensureFileExists(distPath, 'Built package (dist/index.js)');

        console.log('🚀 Starting package in VM...');
        runPackageInVM(config, distPath);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'running package');
    }
};