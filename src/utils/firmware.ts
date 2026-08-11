import fs from 'fs';
import https from 'https';
import path from 'path';
import crypto from 'crypto';
import {validateFirmwareRegistry} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageDefinition,
    EnergyAppPackageFirmwareFile,
    EnergyAppPackageFirmwareMode
} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {getContentTypeFromFile} from './mime.js';
import type {FirmwareUploadTarget, PreparedFirmwareFile, PublishedFirmwareFile} from '../types';

/**
 * The mode assumed when a package declares firmware but no `firmwareMode`.
 * Mirrors the SDK default.
 */
export const DEFAULT_FIRMWARE_MODE: EnergyAppPackageFirmwareMode = 'latest';

/**
 * Run the SDK's firmware registry validator and abort the release on blocking
 * errors.
 *
 * The checks live in the SDK on purpose — duplicate fileIds, duplicate versions
 * per model, the missing `FirmwareRegistry` permission, and (under
 * `'dependent'`) ambiguous edges, cycles, self-references and multiple
 * fallbacks. Re-implementing them here would let the CLI and the app authoring
 * experience drift apart.
 *
 * @throws {CLIError} If the declaration has blocking errors.
 */
export const validateFirmwareDeclaration = (config: EnergyAppPackageDefinition): void => {
    const result = validateFirmwareRegistry(config);

    for (const warning of result.warnings) {
        console.log(`⚠️ Firmware registry: ${warning}`);
    }

    if (!result.ok) {
        console.error(`❌ Firmware registry validation failed with ${result.errors.length} error(s):`);
        for (const error of result.errors) {
            console.error(`   • ${error}`);
        }
        throw new CLIError('Firmware registry declaration is invalid. Aborting release.');
    }
};

/**
 * Resolve a declared firmware `path` against the package root, refusing
 * anything that escapes it.
 *
 * @throws {CLIError} If the path resolves outside `packageRoot`.
 */
const resolveFirmwarePath = (packageRoot: string, fileId: string, declaredPath: string): string => {
    const root = path.resolve(packageRoot);
    const resolved = path.resolve(root, declaredPath);
    const relative = path.relative(root, resolved);

    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new CLIError(
            `Firmware file '${fileId}' (${declaredPath}) resolves outside the package root ${root}. ` +
            'Firmware paths must stay within the package.'
        );
    }

    return resolved;
};

/** Stream the file through SHA-256 so tens-of-MB images never sit in memory whole. */
const hashFile = (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
};

/**
 * Resolve, read and fingerprint every declared firmware file.
 *
 * **Array order is preserved verbatim.** Under `firmwareMode: 'latest'` the
 * runtime offers the *last* declared entry that applies to a device's model, so
 * declaration order is semantic and must survive the whole pipeline. Nothing
 * here sorts, dedupes or reshuffles — and `firmwareVersion` is never parsed or
 * compared, it is an opaque vendor string.
 *
 * @param config - The package definition being released.
 * @param packageRoot - Directory the declared `path` values are relative to.
 * @returns The prepared files in declaration order; empty when none are declared.
 * @throws {CLIError} If a file is missing, unreadable, or escapes the package root.
 */
export const prepareFirmwareFiles = async (
    config: EnergyAppPackageDefinition,
    packageRoot: string
): Promise<PreparedFirmwareFile[]> => {
    const declared = config.firmware;
    if (!declared || declared.length === 0) {
        return [];
    }

    const prepared: PreparedFirmwareFile[] = [];

    // Sequential on purpose: order is semantic and errors should be reported
    // against the first offending entry.
    for (const entry of declared) {
        if (!entry.path) {
            throw new CLIError(`Firmware file '${entry.fileId}' declares no path.`);
        }

        const absolutePath = resolveFirmwarePath(packageRoot, entry.fileId, entry.path);

        let stats: fs.Stats;
        try {
            stats = fs.statSync(absolutePath);
        } catch {
            throw new CLIError(
                `Firmware file '${entry.fileId}' not found at ${absolutePath} (declared as '${entry.path}').`
            );
        }

        if (!stats.isFile()) {
            throw new CLIError(
                `Firmware file '${entry.fileId}' at ${absolutePath} (declared as '${entry.path}') is not a file.`
            );
        }

        let sha256: string;
        try {
            fs.accessSync(absolutePath, fs.constants.R_OK);
            sha256 = await hashFile(absolutePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new CLIError(
                `Firmware file '${entry.fileId}' at ${absolutePath} (declared as '${entry.path}') ` +
                `could not be read: ${message}`
            );
        }

        const content = {
            sha256,
            sizeBytes: stats.size,
            fileName: path.basename(entry.path),
            mimeType: getContentTypeFromFile(absolutePath)
        };

        prepared.push({
            fileId: entry.fileId,
            declaredPath: entry.path,
            absolutePath,
            ...content,
            published: buildPublishedFirmwareFile(entry, content)
        });
    }

    return prepared;
};

/**
 * Turn one declared entry into its published form: the local `path` dropped,
 * the content metadata added, every other declared field carried through
 * untouched.
 */
const buildPublishedFirmwareFile = (
    entry: EnergyAppPackageFirmwareFile,
    content: {sha256: string; sizeBytes: number; fileName: string; mimeType: string}
): PublishedFirmwareFile => {
    // Destructured out rather than deleted so the local path can never leak
    // into the published definition.
    const {path: _localPath, ...rest} = entry;
    return {...rest, ...content};
};

/**
 * The `firmware` array as it is published with the release: same order, no
 * local paths, content metadata attached.
 */
export const toPublishedFirmware = (prepared: PreparedFirmwareFile[]): PublishedFirmwareFile[] =>
    prepared.map((file) => file.published);

/**
 * `tar` arguments for the release bundle, excluding every declared firmware
 * blob.
 *
 * Firmware is distributed through the registry, never inside the package
 * tarball — an image that lands in both doubles the download for every device.
 * Exported for testing.
 *
 * @param bundleName - Output archive name.
 * @param sourceDir - Directory to archive.
 * @param firmware - Prepared firmware files whose blobs must be left out.
 * @param cwd - Directory `tar` runs in; exclusions are expressed relative to it.
 */
export const buildBundleTarArgs = (
    bundleName: string,
    sourceDir: string,
    firmware: PreparedFirmwareFile[],
    cwd: string = process.cwd()
): string[] => {
    const excludes = firmware.map((file) => `--exclude=${path.relative(path.resolve(cwd), file.absolutePath)}`);
    return ['-czf', bundleName, ...excludes, sourceDir];
};

/**
 * Upload one firmware blob to its signed URL, reporting progress as it streams.
 *
 * @throws {CLIError} If the upload fails for any reason.
 */
const uploadFirmwareFile = (file: PreparedFirmwareFile, uploadUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const options = new URL(uploadUrl);
        const fileStream = fs.createReadStream(file.absolutePath);
        const total = file.sizeBytes;
        const isTty = process.stdout.isTTY === true;
        let transferred = 0;
        let lastReportedPercent = -1;

        const reportProgress = (): void => {
            const percent = total > 0 ? Math.floor((transferred / total) * 100) : 100;
            // Without a TTY the carriage return does nothing, so only emit at
            // 10% steps to keep CI logs readable.
            const step = isTty ? 1 : 10;
            if (percent < lastReportedPercent + step && percent < 100) {
                return;
            }
            lastReportedPercent = percent;
            const line = `   ⬆️ ${file.fileId} (${file.fileName}) ${percent}% of ${formatBytes(total)}`;
            if (isTty) {
                process.stdout.write(`\r${line.padEnd(80)}`);
            } else {
                console.log(line);
            }
        };

        const finishProgressLine = (): void => {
            if (isTty) {
                process.stdout.write('\n');
            }
        };

        console.log(`📦 Uploading firmware '${file.fileId}' (${file.fileName}, ${formatBytes(total)})`);

        const req = https.request({
            hostname: options.hostname,
            path: options.pathname + options.search,
            method: 'PUT',
            headers: {
                'Content-Type': file.mimeType,
                'Content-Length': total
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                finishProgressLine();
                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log(`   ✅ ${file.fileId} uploaded (${formatBytes(total)})`);
                    resolve();
                } else {
                    console.error(`   ❌ Error uploading firmware '${file.fileId}': ${res.statusCode}`);
                    console.error(data);
                    reject(new CLIError(
                        `Failed to upload firmware '${file.fileId}' (${file.declaredPath}): ${res.statusCode}`
                    ));
                }
            });
        });

        req.on('error', (error) => {
            finishProgressLine();
            reject(new CLIError(
                `Problem uploading firmware '${file.fileId}' (${file.declaredPath}): ${error.message}`
            ));
        });

        fileStream.on('error', (error) => {
            finishProgressLine();
            req.destroy();
            reject(new CLIError(
                `Could not read firmware '${file.fileId}' at ${file.absolutePath}: ${error.message}`
            ));
        });

        fileStream.on('data', (chunk) => {
            transferred += chunk.length;
            reportProgress();
        });

        fileStream.pipe(req);
    });
};

/**
 * Upload every declared firmware blob the backend does not already hold.
 *
 * Content-addressed: `firmwareUploads` entries without an `uploadUrl` are
 * blobs the registry already stores under that sha256 for this package, and are
 * simply referenced. Uploads run in declaration order and the first failure
 * aborts — the caller must not publish the package version afterwards.
 *
 * @throws {CLIError} If the backend's response does not cover every declared
 *   file, or if any upload fails.
 */
export const uploadFirmwareFiles = async (
    prepared: PreparedFirmwareFile[],
    targets: FirmwareUploadTarget[] | undefined
): Promise<void> => {
    if (prepared.length === 0) {
        return;
    }

    if (!targets) {
        throw new CLIError(
            `The registry returned no firmware upload targets for ${prepared.length} declared firmware file(s). ` +
            'Aborting release rather than publishing a version with an incomplete firmware registry.'
        );
    }

    const targetByFileId = new Map(targets.map((target) => [target.fileId, target]));

    const uploaded: PreparedFirmwareFile[] = [];
    const skipped: PreparedFirmwareFile[] = [];
    let bytesTransferred = 0;

    for (const file of prepared) {
        const target = targetByFileId.get(file.fileId);
        if (!target) {
            throw new CLIError(
                `The registry returned no upload target for firmware '${file.fileId}' (${file.declaredPath}). ` +
                'Aborting release.'
            );
        }

        if (!target.uploadUrl) {
            skipped.push(file);
            console.log(
                `   ⏭️ ${file.fileId} (${file.fileName}) already in the registry ` +
                `— sha256 ${file.sha256.substring(0, 12)}…, skipping upload`
            );
            continue;
        }

        await uploadFirmwareFile(file, target.uploadUrl);
        uploaded.push(file);
        bytesTransferred += file.sizeBytes;
    }

    console.log(`\n📊 Firmware registry summary (${prepared.length} file(s) declared):`);
    console.log(`   ✅ Uploaded: ${uploaded.length}${uploaded.length ? ` — ${uploaded.map((f) => f.fileId).join(', ')}` : ''}`);
    console.log(`   ⏭️ Skipped (already present by hash): ${skipped.length}${skipped.length ? ` — ${skipped.map((f) => f.fileId).join(', ')}` : ''}`);
    console.log(`   📶 Total transferred: ${formatBytes(bytesTransferred)}`);
};

/** Human-readable byte count for progress and summary output. */
export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
