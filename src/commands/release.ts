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
import {
    preparePublicFiles,
    toPublishedFiles,
    uploadPublicFiles,
    validatePublicFilesDeclaration
} from '../utils/public-files.js';
import {hashDirectoryContents, hashReleaseDefinition} from '../utils/fingerprint.js';
import {DEFAULT_REGISTRY_URL, FILE_NAMES} from '../constants/defaults.js';
import type {
    CommandOptions,
    LatestReleaseFingerprint,
    PreparedFirmwareFile,
    PreparedPublicFile,
    PreparedRelease,
    ReleaseNote,
    ReleaseResponse
} from '../types';
import {EnergyAppPackageDefinition} from "@enyo-energy/energy-app-sdk";

export const releaseCommand = async (options: CommandOptions): Promise<void> => {
    try {
        if (!options.apiKey) {
            throw new CLIError('API key is required. Use --api-key <apiKey> to provide it.');
        }

        const registryUrl = options.registry || DEFAULT_REGISTRY_URL;
        const channel = options.channel || 'production';

        const configs = await collectConfigs(options.file);

        // Everything that can be decided from local files happens before the
        // registry is touched: a broken declaration, a missing build and the
        // content fingerprints all come out of the package directory.
        const prepared: PreparedRelease[] = [];
        for (const {file, config} of configs) {
            prepared.push(await prepareRelease(config, channel, file));
        }

        const {duplicates, releasable} = await splitOffDuplicates(
            prepared,
            options.apiKey,
            registryUrl,
            channel,
            options.force === true
        );

        for (const duplicate of duplicates) {
            reportDuplicate(duplicate);
        }

        if (releasable.length === 0) {
            // Nothing left to publish, so nothing to ask about — the release
            // note prompt below would be asking a human to describe a release
            // that is not going to happen.
            throw new CLIError(
                `Nothing to release: ${duplicates.length === 1 ? 'the package is' : 'all packages are'} unchanged. ` +
                'Use --force to publish anyway.'
            );
        }

        // Collected once the set of releases is known, and shared across them.
        const releaseNote = await collectReleaseNotes(options.releaseNotes);

        for (let i = 0; i < releasable.length; i++) {
            const release = releasable[i];
            if (releasable.length > 1) {
                console.log(`\n🚀 Processing release ${i + 1}/${releasable.length}: ${release.configFile}`);
            }
            await publishRelease(release, options.apiKey, registryUrl, channel, releaseNote, options.force === true);
        }

        if (releasable.length > 1) {
            console.log(`\n🎉 Successfully processed ${releasable.length} release(s)!`);
        }

        if (duplicates.length > 0) {
            // The releases that had something to say went out above; this is
            // the non-zero exit a pipeline needs to notice the rest did not.
            throw new CLIError(
                `${duplicates.length} package(s) skipped as unchanged: ` +
                `${duplicates.map((duplicate) => duplicate.packageName).join(', ')}. Use --force to publish anyway.`
            );
        }

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'creating release');
    }
};

/** The package configs this run releases, read and validated. */
const collectConfigs = async (
    specifiedFile?: string
): Promise<Array<{file?: string; config: EnergyAppPackageDefinition}>> => {
    if (specifiedFile) {
        console.log(`📖 Reading package configuration from ${specifiedFile}...`);
        return [{file: specifiedFile, config: await readEnyoPackageConfig(specifiedFile)}];
    }

    console.log('🔍 Searching for *.package.ts files...');
    const configFiles = findPackageConfigs();

    if (configFiles.length === 0) {
        throw new CLIError('No *.package.ts files found in the current directory.');
    }

    console.log(`📦 Found ${configFiles.length} config file(s): ${configFiles.join(', ')}`);

    const validConfigs: Array<{file: string; config: EnergyAppPackageDefinition}> = [];
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

    console.log(`✅ Found ${validConfigs.length} valid config(s).`);
    return validConfigs;
};

/**
 * Resolve one package config into everything the release needs, without
 * touching the registry: declarations validated, firmware and public files
 * fingerprinted, and the two release fingerprints computed.
 *
 * The fingerprints are built here rather than at upload time because they are
 * what decides whether the upload happens at all.
 */
const prepareRelease = async (
    config: EnergyAppPackageDefinition,
    channel: 'production' | 'staging',
    configFile?: string
): Promise<PreparedRelease> => {
    // Everything that can fail locally runs before the release is created, so a
    // broken firmware or file declaration never reaches the registry.
    validateFirmwareDeclaration(config);
    validatePublicFilesDeclaration(config);

    const packageRoot = configFile ? path.dirname(path.resolve(configFile)) : process.cwd();
    const firmware = await prepareFirmwareFiles(config, packageRoot);
    const files = await preparePublicFiles(config, packageRoot);

    if (firmware.length > 0) {
        console.log(
            `🔧 ${firmware.length} firmware file(s) declared (mode: ${config.firmwareMode ?? DEFAULT_FIRMWARE_MODE})`
        );
        for (const file of firmware) {
            console.log(`   • ${file.fileId} → ${file.fileName} (sha256 ${file.sha256.substring(0, 12)}…)`);
        }
    }

    if (files.length > 0) {
        console.log(`🖼️ ${files.length} public file(s) declared`);
        for (const file of files) {
            console.log(`   • ${file.name} → ${file.fileName} (sha256 ${file.sha256.substring(0, 12)}…)`);
        }
    }

    const uploadLogo = getLogoChecksum(config);
    // The same directory and the same exclusions the tarball is built from, so
    // the fingerprint describes exactly what would be shipped.
    const bundleSha256 = await hashDirectoryContents(
        path.join(process.cwd(), BUNDLE_SOURCE_DIR),
        firmware.map((file) => file.absolutePath)
    );
    // Hashed without release notes: those are added after this point and are
    // deliberately not part of what identifies a release.
    const definitionSha256 = hashReleaseDefinition(
        buildCreateReleasePayload(config, uploadLogo, channel, firmware, files)
    );

    return {
        config,
        configFile,
        packageName: config.packageName,
        firmware,
        files,
        uploadLogo,
        bundleSha256,
        definitionSha256
    };
};

/**
 * Ask the registry what it already holds and set aside the releases that would
 * change nothing.
 *
 * Only an optimisation of the error path: `create-release` refuses a duplicate
 * on its own. Asking first is what lets the command skip the interactive
 * release-note prompt for a release that is about to be refused. Anything that
 * makes the answer unavailable — an older registry without the endpoint, a
 * network hiccup — therefore lets the release proceed and leaves the decision
 * where it is authoritative.
 */
const splitOffDuplicates = async (
    prepared: PreparedRelease[],
    apiKey: string,
    registryUrl: string,
    channel: 'production' | 'staging',
    force: boolean
): Promise<{duplicates: PreparedRelease[]; releasable: PreparedRelease[]}> => {
    if (force) {
        console.log('⚠️ --force: publishing without checking whether anything changed.');
        return {duplicates: [], releasable: prepared};
    }

    const duplicates: PreparedRelease[] = [];
    const releasable: PreparedRelease[] = [];

    for (const release of prepared) {
        const latest = await fetchLatestReleaseFingerprint(release.packageName, apiKey, registryUrl, channel);
        const unchanged =
            latest?.hasRelease === true &&
            !!latest.bundleSha256 &&
            latest.bundleSha256 === release.bundleSha256 &&
            latest.definitionSha256 === release.definitionSha256;

        if (unchanged) {
            duplicates.push({...release, duplicateOfVersion: latest?.versionNumber});
        } else {
            releasable.push(release);
        }
    }

    return {duplicates, releasable};
};

const fetchLatestReleaseFingerprint = async (
    packageName: string,
    apiKey: string,
    registryUrl: string,
    channel: 'production' | 'staging'
): Promise<LatestReleaseFingerprint | undefined> => {
    const url =
        `${registryUrl}/api/package-registry/packages/${encodeURIComponent(packageName)}` +
        `/latest-release?channel=${channel}`;

    try {
        const response = await fetch(url, {headers: {'Authorization': `Bearer ${apiKey}`}});
        if (!response.ok) {
            return undefined;
        }
        return await response.json() as LatestReleaseFingerprint;
    } catch {
        return undefined;
    }
};

const reportDuplicate = (duplicate: PreparedRelease): void => {
    const version = duplicate.duplicateOfVersion !== undefined ? `v${duplicate.duplicateOfVersion}` : 'the latest release';
    console.log(`⏭️ ${duplicate.packageName}: identical to ${version} — skipped.`);
    console.log('   Nothing in the bundle or the package definition changed, so every device would');
    console.log('   download and reinstall the same content. Release notes alone do not count as a');
    console.log('   change; publish anyway with --force.');
};

/** Build the bundle for a prepared release and push it to the registry. */
const publishRelease = async (
    release: PreparedRelease,
    apiKey: string,
    registryUrl: string,
    channel: 'production' | 'staging',
    releaseNote: ReleaseNote[] | undefined,
    force: boolean
): Promise<void> => {
    console.log('📦 Building bundle...');
    // Firmware blobs are distributed through the registry, never inside the
    // package tarball.
    execFileSync('tar', buildBundleTarArgs(FILE_NAMES.BUNDLE, BUNDLE_SOURCE_DIR, release.firmware), {stdio: 'inherit'});

    const bundlePath = path.join(process.cwd(), FILE_NAMES.BUNDLE);
    if (!fs.existsSync(bundlePath)) {
        throw new CLIError(`Bundle not found at ${bundlePath}`);
    }

    console.log(`🚀 Creating release on ${registryUrl} using SDK Version ${release.config.sdkVersion}`);
    await createRelease(bundlePath, release, apiKey, registryUrl, channel, releaseNote, force);
};

/** Build output the tarball is made of, and the fingerprint taken over. */
const BUNDLE_SOURCE_DIR = 'dist';

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
 * The declared `firmware` and `files` arrays are replaced with their published
 * form — local paths dropped, `sha256`/`sizeBytes`/`fileName`/`mimeType` added —
 * **in the declared order**. Under `firmwareMode: 'latest'` the runtime offers
 * the last declared entry that applies to a device's model, so the order is
 * semantic and is never sorted or reshuffled. `firmwareMode` is carried through unchanged,
 * defaulting to `'latest'`.
 *
 * `fingerprints` is applied last and is deliberately not part of what
 * {@link hashReleaseDefinition} sees: the definition hash describes the release,
 * and a hash cannot cover itself.
 *
 * Exported for testing.
 */
export const buildCreateReleasePayload = (
    config: EnergyAppPackageDefinition,
    uploadLogo: string | undefined,
    channel: 'production' | 'staging',
    firmware: PreparedFirmwareFile[],
    files: PreparedPublicFile[] = [],
    releaseNote?: ReleaseNote[],
    fingerprints?: {bundleSha256: string; definitionSha256: string; allowDuplicate: boolean}
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
            : {}),
        ...(files.length > 0 ? {files: toPublishedFiles(files)} : {}),
        ...(fingerprints ?? {})
    };
};

const createRelease = async (
    bundlePath: string,
    release: PreparedRelease,
    apiKey: string,
    registry: string,
    channel: 'production' | 'staging',
    releaseNote: ReleaseNote[] | undefined,
    force: boolean
): Promise<void> => {
    const {config, firmware, files, uploadLogo} = release;

    const response = await fetch(`${registry}/api/package-registry/create-release`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
            buildCreateReleasePayload(config, uploadLogo, channel, firmware, files, releaseNote, {
                bundleSha256: release.bundleSha256,
                definitionSha256: release.definitionSha256,
                allowDuplicate: force
            })
        )
    });

    // The registry has the last word on duplicates, and reaches it even when
    // the pre-flight check could not: an older registry without the lookup
    // endpoint, or a release published from elsewhere in between.
    if (response.status === 409) {
        const body = await response.json().catch(() => undefined) as {code?: string; message?: string} | undefined;
        if (body?.code === 'duplicate-release') {
            throw new CLIError(`${body.message} Use --force to publish anyway.`);
        }
        throw new CLIError(`Failed to create release: 409 ${body?.message ?? ''}`.trim());
    }

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

    // Public files are load-bearing, not decorative: an onboarding guide refers
    // to them by name, so a version published without its assets shows an
    // installer a broken image mid-job. Fails the release like firmware does,
    // unlike the logo below.
    await uploadPublicFiles(files, data.fileUploads);

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
            // The signed URL decides the port. Dropping it sent every upload to
            // 443, which is right for the registry and wrong for anything else
            // — a local one, or a proxy in front of it.
            port: options.port || undefined,
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
            port: options.port || undefined,
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