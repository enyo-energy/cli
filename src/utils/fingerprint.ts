import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {hashFile} from './checksum.js';
import {CLIError} from './error-handler.js';

/**
 * The two content fingerprints a release is identified by, so the registry can
 * refuse a republish of something it already carries.
 *
 * Why this is worth computing at all: a release that changes nothing still gets
 * a new version number, and the version number is the only thing the fleet's
 * update check compares. Every device then downloads and reinstalls identical
 * bytes and restarts the app for it, and an external org's release also costs a
 * human review.
 */

/**
 * SHA-256 over the *contents* of a directory: every file's relative path paired
 * with its own digest, in sorted order, hashed as one manifest.
 *
 * Deliberately not a hash of the tarball. `tar` records mtimes, so two builds
 * of byte-identical sources produce different archives — a `touch` is enough.
 * Hashing what goes *into* the archive is what makes "the same app" detectable
 * at all. The manifest covers paths and contents; file modes are left out
 * because nothing in a Node bundle depends on them.
 *
 * @param directory - Absolute path of the directory to fingerprint.
 * @param excludedPaths - Absolute paths left out, mirroring the tar excludes —
 *   firmware blobs travel through the registry, not inside the bundle.
 * @returns Lowercase hex digest of the manifest.
 * @throws {CLIError} If the directory does not exist.
 */
export const hashDirectoryContents = async (
    directory: string,
    excludedPaths: string[] = []
): Promise<string> => {
    if (!fs.existsSync(directory)) {
        throw new CLIError(`Build output not found at ${directory}. Build your app before releasing it.`);
    }

    const excluded = new Set(excludedPaths.map((file) => path.resolve(file)));
    const collect = (dir: string): string[] => {
        return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                return collect(absolute);
            }
            // Only regular files: a symlink's target is already covered when it
            // points inside the bundle, and is not ours to follow when it does not.
            if (!entry.isFile() || excluded.has(absolute)) {
                return [];
            }
            return [absolute];
        });
    };

    // Sorted on the POSIX-shaped relative path so the manifest is identical on
    // a developer's machine and in CI, whatever the platform separator is.
    const entries = collect(directory)
        .map((absolute) => ({
            absolute,
            relative: path.relative(directory, absolute).split(path.sep).join('/')
        }))
        .sort((a, b) => (a.relative < b.relative ? -1 : 1));

    const manifest: string[] = [];
    for (const entry of entries) {
        manifest.push(`${entry.relative} ${await hashFile(entry.absolute)}\n`);
    }

    return crypto.createHash('sha256').update(manifest.join('')).digest('hex');
};

/**
 * Recursively order an object's keys so that two payloads differing only in key
 * order hash the same.
 *
 * Arrays keep their order: under `firmwareMode: 'latest'` the declaration order
 * of `firmware` decides which image a device is offered, so a reordered array
 * is a different release.
 */
const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((sorted, key) => {
                sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
                return sorted;
            }, {});
    }
    return value;
};

/**
 * Fields a developer may legitimately change on their own without the release
 * being anything new: prose about the release, not the release.
 *
 * The consequence is intended but worth saying out loud — republishing purely
 * to fix a typo in a release note counts as a duplicate, and the CLI says so
 * rather than silently shipping a fleet-wide update for a corrected sentence.
 */
const NON_CONTENT_KEYS = ['releaseNote', 'internalDescription'];

/**
 * SHA-256 over the create-release payload, minus the prose.
 *
 * Hashes the payload the way it goes over the wire — serialised first, so that
 * anything JSON drops (functions, `undefined`, a `Date`'s class) is dropped
 * here too and the fingerprint describes what the registry actually receives.
 *
 * @param payload - The create-release body, without the fingerprints themselves.
 * @returns Lowercase hex digest.
 */
export const hashReleaseDefinition = (payload: Record<string, unknown>): string => {
    const onTheWire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    for (const key of NON_CONTENT_KEYS) {
        delete onTheWire[key];
    }
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(onTheWire))).digest('hex');
};
