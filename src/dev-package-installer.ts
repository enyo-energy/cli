import fs from 'fs';
import path from 'path';
import {execSync} from 'child_process';
import type {DevPackageInstallRequest, DevPackageInstallResponse} from './types/index.js';
import {FILE_NAMES} from './constants/defaults.js';
import {CLIError} from './utils/error-handler.js';
import {EnergyAppPackageDefinition} from "@hems-one/energy-app-sdk";
import { WebSocketCommand, type WebSocketCommandOptions } from './utils/websocket-command.js';

export const installDevPackage = async (
    deviceHost: string,
    devicePort: number,
    debugToken: string,
    config: EnergyAppPackageDefinition
): Promise<void> => {
    const currentDir = process.cwd();
    const distPath = path.join(currentDir, 'dist');
    const bundlePath = path.join(currentDir, FILE_NAMES.BUNDLE);

    console.log(`📦 Creating package bundle from dist folder in '${currentDir}'...`);

    if (!fs.existsSync(distPath)) {
        throw new CLIError('dist directory not found. Please build the package first using "npx rsbuild build"');
    }

    // Create bundle
    execSync(`tar -czf ${FILE_NAMES.BUNDLE} -C ${currentDir} dist`, {stdio: 'inherit'});

    if (!fs.existsSync(bundlePath)) {
        throw new CLIError(`Bundle not found at ${bundlePath}`);
    }

    console.log('📖 Reading bundle file...');
    const bundleBuffer = fs.readFileSync(bundlePath);
    const bundleBase64 = bundleBuffer.toString('base64');

    const payload: DevPackageInstallRequest = {
        packageId: config.packageName,
        packageName: config.packageName,
        packageVersion: parseInt(config.version, 10),
        packageBundle: bundleBase64,
        debugToken: debugToken,
        permissions: config.permissions,
        options: config.options,
        sdkVersion: config.sdkVersion
    };

    console.log(`🚀 Installing package to device at ${deviceHost}:${devicePort}...`);

    try {
        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: debugToken
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const response = await wsCommand.execute<DevPackageInstallResponse>({
            command: 'install-dev-package',
            payload: payload
        });

        if (response.status === 'error') {
            throw new CLIError(response.message || 'Package installation failed');
        }

        console.log('✅ Package installation successful!');
        console.log(`💬 Message: ${response.message}`);

        if (response.data) {
            console.log(`📦 Package: ${response.data.packageName} (${response.data.packageId})`);
            console.log(`🔢 Version: ${response.data.packageVersion}`);
        }

        // Clean up bundle file
        fs.unlinkSync(bundlePath);
        console.log('🧹 Cleaned up temporary bundle file');
    } catch (error) {
        // Clean up bundle file in case of error
        if (fs.existsSync(bundlePath)) {
            fs.unlinkSync(bundlePath);
        }

        console.error(`Failed to install package: ${error}`)
        if (error instanceof CLIError) {
            throw error;
        }
        throw new CLIError(`Package installation failed: ${error}`);
    }


};