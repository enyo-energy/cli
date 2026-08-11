import fs from 'fs';
import https from 'https';
import path from 'path';
import crypto from 'crypto';
import {execFileSync} from 'child_process';
import {readEnyoPackageConfig, findPackageConfigs, readAndValidatePackageConfig} from '../utils/file-utils.js';
import {CLIError, handleError} from '../utils/error-handler.js';
import {collectReleaseNotes} from '../utils/release-notes.js';
import {getContentTypeFromFile} from '../utils/mime.js';
import {
    DEFAULT_FIRMWARE_MODE,
    buildBundleTarArgs,
    prepareFirmwareFiles,
    toPublishedFirmware,
    uploadFirmwareFiles,
    validateFirmwareDeclaration
} from '../utils/firmware.js';
import {DEFAULT_REGISTRY_URL, FILE_NAMES} from '../constants/defaults.js';
import type {CommandOptions, PreparedFirmwareFile, ReleaseNote, ReleaseResponse} from '../types';
import {EnergyAppPackageDefinition} from "@enyo-energy/energy-app-sdk";

export const releaseCommand = async (options: CommandOptions): Promise<void> => {
    try {
        if (!options.apiKey) {
            throw new CLIError('API key is required. Use --api-key <apiKey> to provide it.');
        }

        const registryUrl = options.registry || DEFAULT_REGISTRY_URL;
        const channel = options.channel || 'production';

        // Collect release notes once and share them across all package configs.
        const releaseNote = await collectReleaseNotes(options.releaseNotes);

        if (options.file) {
            console.log(`📖 Reading package configuration from ${options.file}...`);
            const config = await readEnyoPackageConfig(options.file);
            await processReleaseForConfig(config, options.apiKey, registryUrl, channel, releaseNote, options.file);
        } else {
            console.log('🔍 Searching for *.package.ts files...');
            const configFiles = findPackageConfigs();

            if (configFiles.length === 0) {
                throw new CLIError('No *.package.ts files found in the current directory.');
            }

            console.log(`📦 Found ${configFiles.length} config file(s): ${configFiles.join(', ')}`);

            const validConfigs: Array<{file: string, config: EnergyAppPackageDefinition}> = [];

            for (const file of configFiles) {
                console.log(`📖 Reading package configuration from ${file}...`);
                const config = await readAndValidatePackageConfig(file);
                if (config) {
                    validConfigs.push({file, config});
                }
            }

            if (validConfigs.length === 0) {
                throw new CLIError('No valid package configurations found.');
            }

            console.log(`✅ Found ${validConfigs.length} valid config(s). Processing releases...`);

            for (let i = 0; i < validConfigs.length; i++) {
                const {file, config} = validConfigs[i];
                console.log(`\n🚀 Processing release ${i + 1}/${validConfigs.length}: ${file}`);
                await processReleaseForConfig(config, options.apiKey, registryUrl, channel, releaseNote, file);
            }

            console.log(`\n🎉 Successfully processed ${validConfigs.length} release(s)!`);
        }

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'creating release');
    }
};

const processReleaseForConfig = async (
    config: EnergyAppPackageDefinition,
    apiKey: string,
    registryUrl: string,
    channel: 'production' | 'staging',
    releaseNote?: ReleaseNote[],
    configFile?: string
): Promise<void> => {
    // Everything that can fail locally runs before the release is created, so a
    // broken firmware declaration never reaches the registry.
    validateFirmwareDeclaration(config);

    const packageRoot = configFile ? path.dirname(path.resolve(configFile)) : process.cwd();
    const firmware = await prepareFirmwareFiles(config, packageRoot);

    if (firmware.length > 0) {
        console.log(
            `🔧 ${firmware.length} firmware file(s) declared (mode: ${config.firmwareMode ?? DEFAULT_FIRMWARE_MODE})`
        );
        for (const file of firmware) {
            console.log(`   • ${file.fileId} → ${file.fileName} (sha256 ${file.sha256.substring(0, 12)}…)`);
        }
    }

    console.log('📦 Building bundle...');
    // Firmware blobs are distributed through the registry, never inside the
    // package tarball.
    execFileSync('tar', buildBundleTarArgs(FILE_NAMES.BUNDLE, 'dist', firmware), {stdio: 'inherit'});

    const bundlePath = path.join(process.cwd(), FILE_NAMES.BUNDLE);
    if (!fs.existsSync(bundlePath)) {
        throw new CLIError(`Bundle not found at ${bundlePath}`);
    }

    console.log(`🚀 Creating release on ${registryUrl} using SDK Version ${config.sdkVersion}`);
    await createRelease(bundlePath, config, apiKey, registryUrl, channel, firmware, releaseNote);
};

const calculateFileChecksum = (filePath: string): string => {
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
};

const getLogoChecksum = (config: EnergyAppPackageDefinition): string | undefined => {
    if (!config.logo) {
        return undefined;
    }

    const logoPath = path.resolve(config.logo);
    if (!fs.existsSync(logoPath)) {
        console.log(`⚠️ Logo file not found at: ${logoPath}`);
        return undefined;
    }

    try {
        const checksum = calculateFileChecksum(logoPath);
        console.log(`🖼️ Logo found: ${config.logo} (checksum: ${checksum.substring(0, 8)}...)`);
        return checksum;
    } catch (error: any) {
        console.error(`❌ Error reading logo file: ${error}`);
        return undefined;
    }
};

/**
 * Build the `create-release` request body.
 *
 * The declared `firmware` array is replaced with its published form — local
 * paths dropped, `sha256`/`sizeBytes`/`fileName`/`mimeType` added — **in the
 * declared order**. Under `firmwareMode: 'latest'` the runtime offers the last
 * declared entry that applies to a device's model, so the order is semantic and
 * is never sorted or reshuffled. `firmwareMode` is carried through unchanged,
 * defaulting to `'latest'`.
 *
 * Exported for testing.
 */
export const buildCreateReleasePayload = (
    config: EnergyAppPackageDefinition,
    uploadLogo: string | undefined,
    channel: 'production' | 'staging',
    firmware: PreparedFirmwareFile[],
    releaseNote?: ReleaseNote[]
): Record<string, unknown> => {
    return {
        ...config,
        uploadLogo,
        channel,
        ...(releaseNote ? {releaseNote} : {}),
        ...(firmware.length > 0
            ? {
                firmware: toPublishedFirmware(firmware),
                firmwareMode: config.firmwareMode ?? DEFAULT_FIRMWARE_MODE
            }
            : {})
    };
};

const createRelease = async (
    bundlePath: string,
    config: EnergyAppPackageDefinition,
    apiKey: string,
    registry: string,
    channel: 'production' | 'staging',
    firmware: PreparedFirmwareFile[],
    releaseNote?: ReleaseNote[]
): Promise<void> => {
    // Read SDK version from package.json

    // Get logo checksum if logo is present
    const uploadLogo = getLogoChecksum(config);

    const response = await fetch(`${registry}/api/package-registry/create-release`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildCreateReleasePayload(config, uploadLogo, channel, firmware, releaseNote))
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Error creating release: ${response.status}`);
        console.error(errorText);
        throw new CLIError(`Failed to create release: ${response.status}`);
    }

    const data = await response.json() as ReleaseResponse;
    const releasedVersion = data.versionNumber;

    // Firmware first: a failure here must abort before the version is
    // published. A package version pointing at a half-uploaded registry is
    // worse than a failed release, and nothing below finishes the release.
    await uploadFirmwareFiles(firmware, data.firmwareUploads);

    // Upload logo if logoUrl is provided
    if (data.logoUploadUrl && config.logo) {
        const logoPath = path.resolve(config.logo);
        if (fs.existsSync(logoPath)) {
            try {
                await uploadLogoFile(logoPath, data.logoUploadUrl);
            } catch (error: any) {
                console.error(`❌ Logo upload failed, but continuing with release: ${error}`);
                console.log('⚠️ The release will continue without the logo.');
            }
        } else {
            console.log(`⚠️ Logo file not found at: ${logoPath}. Continuing release without logo.`);
        }
    }

    await uploadBundle(bundlePath, apiKey, registry, data.uploadUrl, data.releaseId, releasedVersion);
};

const uploadBundle = (
    bundlePath: string,
    apiKey: string,
    registry: string,
    uploadUrl: string,
    releaseId: string,
    releasedVersion: number
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
                    finishRelease(releaseId, apiKey, registry, releasedVersion)
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

const uploadLogoFile = (logoPath: string, logoUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(logoPath);
        const stats = fs.statSync(logoPath);
        const options = new URL(logoUrl);
        const contentType = getContentTypeFromFile(logoPath);

        console.log(`🖼️ Uploading logo to https://${options.hostname}${options.pathname}${options.search}`);

        const req = https.request({
            hostname: options.hostname,
            path: options.pathname + options.search,
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                'Content-Length': stats.size,
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log('✅ Logo uploaded successfully.');
                    resolve();
                } else {
                    console.error(`❌ Error uploading logo: ${res.statusCode}`);
                    console.error(data);
                    reject(new CLIError(`Failed to upload logo: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Problem with logo upload request: ${e.message}`);
            reject(new CLIError(`Problem with logo upload request: ${e.message}`));
        });

        fileStream.pipe(req);
    });
};

const finishRelease = async (
    releaseId: string,
    apiKey: string,
    registry: string,
    releasedVersion: number
): Promise<void> => {
    const response = await fetch(`${registry}/api/package-registry/finish-release`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({releaseId})
    });

    if (response.status === 201) {
        console.log('✅ Release finished successfully.');
        console.log(`🏷️ Released version: ${releasedVersion}`);
    } else {
        const errorText = await response.text();
        console.error(`❌ Error finishing release: ${response.status}`);
        console.error(errorText);
        throw new CLIError(`Failed to finish release: ${response.status}`);
    }
};