import fs from 'fs';
import path from 'path';
import {execSync} from 'child_process';
import type {ConnectPackageDefinition} from "../../connect-ems-api";

interface DevPackageInstallRequest {
    packageId: string;
    packageName: string;
    packageVersion: number;
    packageBundle: string;
    debugToken: string;
}

interface DevPackageInstallResponse {
    message: string;
    packageId: string;
    packageName: string;
    packageVersion: number;
}

export const installDevPackage = async (
    deviceHost: string,
    devicePort: number = 6021,
    debugToken: string,
    config: ConnectPackageDefinition
): Promise<void> => {
    try {
        const currentDir = process.cwd();
        const distPath = path.join(currentDir, 'dist');
        const bundlePath = path.join(currentDir, 'bundle.tar.gz');

        console.log(`Creating package bundle from dist folder in '${currentDir}'...`);

        // Check if dist directory exists
        if (!fs.existsSync(distPath)) {
            throw new Error('dist directory not found. Please build the package first using "npx rsbuild build"');
        }

        // Check if dist/index.js exists
        if (!fs.existsSync(path.join(distPath, 'main.js')) && fs.existsSync(path.join(distPath, 'index.js'))) {
            execSync(`mv ${path.join(distPath, 'index.js')} ${path.join(distPath, 'main.js')}`, {stdio: 'inherit'});
        }

        // Rename index.js to main.js and create bundle
        execSync(`tar -czf bundle.tar.gz -C ${currentDir} dist`, {stdio: 'inherit'});

        if (!fs.existsSync(bundlePath)) {
            throw new Error(`Bundle not found at ${bundlePath}`);
        }

        console.log('Reading bundle file...');
        const bundleBuffer = fs.readFileSync(bundlePath);
        const bundleBase64 = bundleBuffer.toString('base64');

        // Prepare request payload
        const payload: DevPackageInstallRequest = {
            packageId: `${config.packageName}`,
            packageName: config.packageName,
            packageVersion: parseInt(config.version, 10),
            packageBundle: bundleBase64,
            debugToken: debugToken
        };

        console.log(`Installing package to device at ${deviceHost}:${devicePort}...`);

        // Send request to device
        const response = await fetch(`http://${deviceHost}:${devicePort}/dev-package/install`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to install package: ${response.status} ${response.statusText}\n${errorText}`);
        }

        // @ts-expect-error this is fine
        const result: DevPackageInstallResponse = await response.json();

        console.log('✅ Package installation successful!');
        console.log(`📦 Package: ${result.packageName} (${result.packageId})`);
        console.log(`🔢 Version: ${result.packageVersion}`);
        console.log(`💬 Message: ${result.message}`);

        // Clean up bundle file
        fs.unlinkSync(bundlePath);
        console.log('Cleaned up temporary bundle file');

    } catch (error) {
        if (error instanceof Error) {
            console.error('❌ Error installing dev package:', error.message);
        } else {
            console.error('❌ Unknown error installing dev package:', error);
        }
        throw error;
    }
};