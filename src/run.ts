#!/usr/bin/env node
import * as fs from 'node:fs';
import vm from 'vm';
import path from 'path';
import { createVMContext } from './sandbox/vm-context.js';
import type { NetworkPermissionConfig } from './sandbox/restricted-fetch.js';
import type { ConnectPackageDefinition } from '../../connect-ems-api/dist/connect-package-definition.js';

export const runPackageInVM = (config: ConnectPackageDefinition, distPath: string) => {
    try {
        if (!distPath) {
            distPath = path.join(process.cwd(), 'dist', 'index.js');
        }

        if (!fs.existsSync(distPath)) {
            throw new Error(`Built package not found at ${distPath}`);
        }

        const context = {
            packageName: config.packageName,
            version: parseInt(config.version) || 1
        };

        // Extract network configuration if RestrictedInternetAccess permission is granted
        const networkConfig = config.permissions?.includes('RestrictedInternetAccess')
            ? config.options?.restrictedInternetAccess
            : undefined;
        const untrustedCode = fs.readFileSync(distPath, 'utf8');

        // Get the package directory (where the built code is located)
        const packageDir = path.dirname(distPath);
        const packageRoot = path.dirname(packageDir); // Go up from dist/ to package root

        // Create the VM sandbox context
        const sandbox = createVMContext({
            packageDir,
            packageRoot,
            distPath,
            context,
            networkConfig,
            permissions: config.permissions
        });

        vm.runInContext(untrustedCode, sandbox);
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error running package in VM:', error.message);
        } else {
            console.error('Unknown error running package in VM', error);
        }
        throw error;
    }
};