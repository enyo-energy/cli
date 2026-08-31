import fs from 'fs';
import https from 'https';
import path from 'path';
import {validatePackageFiles} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageDefinition,
    EnergyAppPackagePublicFile
} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {getContentTypeFromFile} from './mime.js';
import {hashFile} from './checksum.js';
import {formatBytes} from './firmware.js';
import type {PreparedPublicFile, PublicFileUploadTarget, PublishedPublicFile} from '../types';

/**
 * Upload, validation and publishing of a package's public files
 * (`EnergyAppPackageDefinition.files`).
 *
 * Mirrors the firmware registry pipeline (`./firmware.ts`) — declare by local
 * path, upload content-addressed on release, publish without the path — with
 * one difference that matters: these blobs are served publicly and are
 * referenced *by name* from elsewhere in the package (today an onboarding v2
 * image block's `file`). A missing or half-uploaded asset therefore surfaces as
 * a hole in an installer's guide, which is why every failure here aborts the
 * release instead of degrading like the logo upload does.
 */

/**
 * Run the SDK's public file validator and abort the release on blocking errors.
 *
 * The checks live in the SDK on purpose — duplicate names, non-slug names,
 * paths escaping the package, malformed MIME types — so that the CLI and the
 * app authoring experience cannot drift apart.
 *
 * @param config - The package definition being released.
 * @throws {CLIError} If the declaration has blocking errors.
 */
export const validatePublicFilesDeclaration = (config: EnergyAppPackageDefinition): void => {
    const result = validatePackageFiles(config.files);

    for (const warning of result.warnings) {
        console.log(`⚠️ Package files: ${warning}`);
    }

    if (!result.ok) {
        console.error(`❌ Package files validation failed with ${result.errors.length} error(s):`);
        for (const error of result.errors) {
            console.error(`   • ${error}`);
        }
        throw new CLIError('Package files declaration is invalid. Aborting release.');
    }
};

/**
 * Resolve a declared `path` against the package root, refusing anything that
 * escapes it.
 *
 * @throws {CLIError} If the path resolves outside `packageRoot`.
 */
const resolvePublicFilePath = (packageRoot: string, name: string, declaredPath: string): string => {
    const root = path.resolve(packageRoot);
    const resolved = path.resolve(root, declaredPath);
    const relative = path.relative(root, resolved);

    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new CLIError(
            `Package file '${name}' (${declaredPath}) resolves outside the package root ${root}. ` +
            'File paths must stay within the package.'
        );
    }

    return resolved;
};

/**
 * Resolve, read and fingerprint every declared public file.
 *
 * @param config - The package definition being released.
 * @param packageRoot - Directory the declared `path` values are relative to.
 * @returns The prepared files in declaration order; empty when none are declared.
 * @throws {CLIError} If a file is missing, unreadable, or escapes the package root.
 */
export const preparePublicFiles = async (
    config: EnergyAppPackageDefinition,
    packageRoot: string
): Promise<PreparedPublicFile[]> => {
    const declared = config.files;
    if (!declared || declared.length === 0) {
        return [];
    }

    const prepared: PreparedPublicFile[] = [];

    // Sequential on purpose: errors should be reported against the first
    // offending entry rather than as a race between rejected promises.
    for (const entry of declared) {
        if (!entry.path) {
            throw new CLIError(`Package file '${entry.name}' declares no path.`);
        }

        const absolutePath = resolvePublicFilePath(packageRoot, entry.name, entry.path);

        let stats: fs.Stats;
        try {
            stats = fs.statSync(absolutePath);
        } catch {
            throw new CLIError(
                `Package file '${entry.name}' not found at ${absolutePath} (declared as '${entry.path}').`
            );
        }

        if (!stats.isFile()) {
            throw new CLIError(
                `Package file '${entry.name}' at ${absolutePath} (declared as '${entry.path}') is not a file.`
            );
        }

        let sha256: string;
        try {
            fs.accessSync(absolutePath, fs.constants.R_OK);
            sha256 = await hashFile(absolutePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new CLIError(
                `Package file '${entry.name}' at ${absolutePath} (declared as '${entry.path}') ` +
                `could not be read: ${message}`
            );
        }

        const content = {
            sha256,
            sizeBytes: stats.size,
            fileName: path.basename(entry.path),
            // A declared mimeType wins: it is how an author corrects a missing
            // or misleading extension, and the SDK's image check reads it the
            // same way round.
            mimeType: entry.mimeType ?? getContentTypeFromFile(absolutePath)
        };

        prepared.push({
            name: entry.name,
            declaredPath: entry.path,
            absolutePath,
            ...content,
            published: buildPublishedPublicFile(entry, content)
        });
    }

    return prepared;
};

/**
 * Turn one declared entry into its published form: the local `path` dropped,
 * the content metadata added, every other declared field — `name` above all —
 * carried through untouched.
 */
const buildPublishedPublicFile = (
    entry: EnergyAppPackagePublicFile,
    content: {sha256: string; sizeBytes: number; fileName: string; mimeType: string}
): PublishedPublicFile => {
    // Destructured out rather than deleted so the local path can never leak
    // into the published definition.
    const {path: _localPath, ...rest} = entry;
    return {...rest, ...content};
};

/**
 * The `files` array as it is published with the release: same order, no local
 * paths, content metadata attached.
 */
export const toPublishedFiles = (prepared: PreparedPublicFile[]): PublishedPublicFile[] =>
    prepared.map((file) => file.published);

/**
 * Upload one public file to its signed URL.
 *
 * @throws {CLIError} If the upload fails for any reason.
 */
const uploadPublicFile = (file: PreparedPublicFile, uploadUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const options = new URL(uploadUrl);
        const fileStream = fs.createReadStream(file.absolutePath);

        const req = https.request({
            hostname: options.hostname,
            path: options.pathname + options.search,
            method: 'PUT',
            headers: {
                'Content-Type': file.mimeType,
                'Content-Length': file.sizeBytes
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log(`   ✅ ${file.name} uploaded (${formatBytes(file.sizeBytes)})`);
                    resolve();
                } else {
                    console.error(`   ❌ Error uploading package file '${file.name}': ${res.statusCode}`);
                    console.error(data);
                    reject(new CLIError(
                        `Failed to upload package file '${file.name}' (${file.declaredPath}): ${res.statusCode}`
                    ));
                }
            });
        });

        req.on('error', (error) => {
            reject(new CLIError(
                `Problem uploading package file '${file.name}' (${file.declaredPath}): ${error.message}`
            ));
        });

        fileStream.on('error', (error) => {
            req.destroy();
            reject(new CLIError(
                `Could not read package file '${file.name}' at ${file.absolutePath}: ${error.message}`
            ));
        });

        fileStream.pipe(req);
    });
};

/**
 * Upload every declared public file the backend does not already hold.
 *
 * Content-addressed: `fileUploads` entries without an `uploadUrl` are blobs the
 * registry already stores under that sha256 for this package and are simply
 * referenced. Uploads run in declaration order and the first failure aborts —
 * the caller must not publish the package version afterwards, because a guide
 * referencing a name whose bytes never arrived renders as a broken image on an
 * installer's screen.
 *
 * If the backend returns no targets at all, the upload step is skipped with a
 * warning — older registries simply do not answer with `fileUploads`.
 *
 * @param prepared - The prepared files, in declaration order.
 * @param targets - The backend's per-file answer from `create-release`.
 * @throws {CLIError} If the backend answers with targets that do not cover every
 *   declared file, or if any upload fails.
 */
export const uploadPublicFiles = async (
    prepared: PreparedPublicFile[],
    targets: PublicFileUploadTarget[] | undefined
): Promise<void> => {
    if (prepared.length === 0) {
        return;
    }

    if (!targets || targets.length === 0) {
        console.warn(
            `   ⚠️ The registry returned no file upload targets for ${prepared.length} declared package file(s) ` +
            '— skipping package file upload. The registry may already hold these assets, ' +
            'or it may not support package files yet.'
        );
        return;
    }

    const targetByName = new Map(targets.map((target) => [target.name, target]));

    const uploaded: PreparedPublicFile[] = [];
    const skipped: PreparedPublicFile[] = [];
    let bytesTransferred = 0;

    for (const file of prepared) {
        const target = targetByName.get(file.name);
        if (!target) {
            throw new CLIError(
                `The registry returned no upload target for package file '${file.name}' ` +
                `(${file.declaredPath}). Aborting release.`
            );
        }

        if (!target.uploadUrl) {
            skipped.push(file);
            console.log(
                `   ⏭️ ${file.name} (${file.fileName}) already in the registry ` +
                `— sha256 ${file.sha256.substring(0, 12)}…, skipping upload`
            );
            continue;
        }

        await uploadPublicFile(file, target.uploadUrl);
        uploaded.push(file);
        bytesTransferred += file.sizeBytes;
    }

    console.log(`\n📊 Package files summary (${prepared.length} file(s) declared):`);
    console.log(`   ✅ Uploaded: ${uploaded.length}${uploaded.length ? ` — ${uploaded.map((f) => f.name).join(', ')}` : ''}`);
    console.log(`   ⏭️ Skipped (already present by hash): ${skipped.length}${skipped.length ? ` — ${skipped.map((f) => f.name).join(', ')}` : ''}`);
    console.log(`   📶 Total transferred: ${formatBytes(bytesTransferred)}`);
};
