import fs from 'fs';
import https from 'https';
import path from 'path';
import { execSync } from 'child_process';
import { readEnyoPackageConfig } from '../utils/file-utils.js';
import { CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_REGISTRY_URL, FILE_NAMES } from '../constants/defaults.js';
import type { CommandOptions, ReleaseResponse } from '../types';
import {EnergyAppPackageDefinition} from "@hems-one/energy-app-sdk";

export const releaseCommand = async (options: CommandOptions): Promise<void> => {
    try {
        if (!options.apiKey) {
            throw new CLIError('API key is required. Use --api-key <apiKey> to provide it.');
        }

        console.log('📖 Reading package configuration...');
        const config = await readEnyoPackageConfig();

        console.log('📦 Building bundle...');
        execSync(`tar -czf ${FILE_NAMES.BUNDLE} dist`, { stdio: 'inherit' });

        const bundlePath = path.join(process.cwd(), FILE_NAMES.BUNDLE);
        if (!fs.existsSync(bundlePath)) {
            throw new CLIError(`Bundle not found at ${bundlePath}`);
        }

        const registryUrl = options.registry || DEFAULT_REGISTRY_URL;
        console.log(`🚀 Creating release on ${registryUrl}...`);

        await createRelease(bundlePath, config, options.apiKey, registryUrl);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'creating release');
    }
};

const createRelease = async (
    bundlePath: string,
    config: EnergyAppPackageDefinition,
    apiKey: string,
    registry: string
): Promise<void> => {
    // Read SDK version from package.json
    const response = await fetch(`${registry}/api/package-registry/create-release`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...config })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Error creating release: ${response.status}`);
        console.error(errorText);
        throw new CLIError(`Failed to create release: ${response.status}`);
    }

    const data = await response.json() as ReleaseResponse;

    if (!data || !data.uploadUrl) {
        throw new CLIError('No upload URL in response');
    }

    await uploadBundle(bundlePath, apiKey, registry, data.uploadUrl, data.releaseId);
};

const uploadBundle = (
    bundlePath: string,
    apiKey: string,
    registry: string,
    uploadUrl: string,
    releaseId: string
): Promise<void> => {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(bundlePath);
        const stats = fs.statSync(bundlePath);
        const options = new URL(uploadUrl);

        console.log(`📤 Uploading to https://${options.hostname}${options.pathname}${options.search}`);

        const req = https.request({
            hostname: options.hostname,
            path: options.pathname + options.search,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/gzip',
                'Content-Length': stats.size,
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log('✅ Bundle uploaded successfully.');
                    finishRelease(releaseId, apiKey, registry)
                        .then(() => resolve())
                        .catch((error: Error) => reject(error));
                } else {
                    console.error(`❌ Error uploading bundle: ${res.statusCode}`);
                    console.error(data);
                    reject(new CLIError(`Failed to upload bundle: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Problem with upload request: ${e.message}`);
            reject(new CLIError(`Problem with upload request: ${e.message}`));
        });

        fileStream.pipe(req);
    });
};

const finishRelease = async (releaseId: string, apiKey: string, registry: string): Promise<void> => {
    const response = await fetch(`${registry}/api/package-registry/finish-release`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ releaseId })
    });

    if (response.status === 201) {
        console.log('✅ Release finished successfully.');
    } else {
        const errorText = await response.text();
        console.error(`❌ Error finishing release: ${response.status}`);
        console.error(errorText);
        throw new CLIError(`Failed to finish release: ${response.status}`);
    }
};