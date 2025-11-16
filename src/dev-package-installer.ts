import fs from 'fs';
import path from 'path';
import {execSync} from 'child_process';
import type {DevPackageInstallRequest, DevPackageInstallResponse} from './types/index.js';
import {FILE_NAMES} from './constants/defaults.js';
import {CLIError} from './utils/error-handler.js';
import {Agent} from 'undici'
import {EnergyAppPackageDefinition} from "@hems-one/energy-app-sdk";

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
        options: config.options
    };

    console.log(`🚀 Installing package to device at ${deviceHost}:${devicePort}...`);

    const httpsAgent = new Agent({
        connect: {
            rejectUnauthorized: false
        }
    })

    try {

        const response = await fetch(`https://${deviceHost}:${devicePort}/dev-package/install`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            dispatcher: httpsAgent
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to install package: ${response.status} ${response.statusText}\n${errorText}`)
            throw new CLIError(`Failed to install package: ${response.status} ${response.statusText}\n${errorText}`);
        }

        const result = await response.json() as DevPackageInstallResponse;

        console.log('✅ Package installation successful!');
        console.log(`📦 Package: ${result.packageName} (${result.packageId})`);
        console.log(`🔢 Version: ${result.packageVersion}`);
        console.log(`💬 Message: ${result.message}`);

        // Clean up bundle file
        fs.unlinkSync(bundlePath);
        console.log('🧹 Cleaned up temporary bundle file');
    } catch (error) {
        console.error(`Failed to install package: ${error}`, error)
        if (error instanceof CLIError) {
            throw error;
        }
    }


};