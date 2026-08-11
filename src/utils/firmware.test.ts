import {test, describe, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {execFileSync} from 'child_process';
import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {
    buildBundleTarArgs,
    prepareFirmwareFiles,
    toPublishedFirmware,
    uploadFirmwareFiles,
    validateFirmwareDeclaration
} from './firmware.js';
import {buildCreateReleasePayload} from '../commands/release.js';
import type {FirmwareUploadTarget, PreparedFirmwareFile} from '../types';

let packageRoot: string;

beforeEach(() => {
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-firmware-test-'));
});

afterEach(() => {
    fs.rmSync(packageRoot, {recursive: true, force: true});
});

/** Write a firmware blob under the package root and return its declared path. */
const writeBlob = (relativePath: string, contents: string): string => {
    const absolute = path.join(packageRoot, relativePath);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, contents);
    return `./${relativePath}`;
};

const sha256Of = (contents: string): string =>
    crypto.createHash('sha256').update(contents).digest('hex');

/** A minimal definition that satisfies the SDK validator, plus the given firmware. */
const definitionWith = (
    firmware: EnergyAppPackageDefinition['firmware'],
    overrides: Partial<EnergyAppPackageDefinition> = {}
): EnergyAppPackageDefinition => ({
    version: '1',
    packageName: 'test-package',
    sdkVersion: '0.0.185',
    permissions: ['FirmwareRegistry'],
    categories: [],
    storeEntry: [],
    compatibility: [],
    firmware,
    ...overrides
} as unknown as EnergyAppPackageDefinition);

describe('prepareFirmwareFiles', () => {
    test('fails with fileId and path when the declared file is missing', async () => {
        const definition = definitionWith([
            {fileId: 'wallbox-a', path: './firmware/absent.bin', firmwareVersion: '2.4.1'}
        ]);

        await assert.rejects(
            () => prepareFirmwareFiles(definition, packageRoot),
            (error: unknown) => {
                assert.ok(error instanceof CLIError);
                assert.match(error.message, /wallbox-a/);
                assert.match(error.message, /absent\.bin/);
                return true;
            }
        );
    });

    test('rejects a path that escapes the package root', async () => {
        // A real file outside the root, so the failure can only come from the
        // traversal check and not from the file being missing.
        const outside = path.join(packageRoot, '..', `escaped-${path.basename(packageRoot)}.bin`);
        fs.writeFileSync(outside, 'secret');

        const definition = definitionWith([
            {
                fileId: 'escaping',
                path: `../${path.basename(outside)}`,
                firmwareVersion: 'A7F2'
            }
        ]);

        try {
            await assert.rejects(
                () => prepareFirmwareFiles(definition, packageRoot),
                (error: unknown) => {
                    assert.ok(error instanceof CLIError);
                    assert.match(error.message, /outside the package root/);
                    assert.match(error.message, /escaping/);
                    return true;
                }
            );
        } finally {
            fs.rmSync(outside, {force: true});
        }
    });

    test('rejects an absolute path outside the package root', async () => {
        const definition = definitionWith([
            {fileId: 'abs', path: '/etc/hosts', firmwareVersion: '1'}
        ]);

        await assert.rejects(
            () => prepareFirmwareFiles(definition, packageRoot),
            (error: unknown) => {
                assert.ok(error instanceof CLIError);
                assert.match(error.message, /outside the package root/);
                return true;
            }
        );
    });

    test('computes lowercase hex sha256, byte size and a default mime type', async () => {
        const contents = 'firmware-bytes';
        const declaredPath = writeBlob('firmware/wallbox-2.4.1.bin', contents);
        const definition = definitionWith([
            {fileId: 'wallbox-a', path: declaredPath, firmwareVersion: '2.4.1'}
        ]);

        const [prepared] = await prepareFirmwareFiles(definition, packageRoot);

        assert.equal(prepared.sha256, sha256Of(contents));
        assert.match(prepared.sha256, /^[0-9a-f]{64}$/);
        assert.equal(prepared.sizeBytes, Buffer.byteLength(contents));
        assert.equal(prepared.fileName, 'wallbox-2.4.1.bin');
        assert.equal(prepared.mimeType, 'application/octet-stream');
    });
});

describe('published definition', () => {
    test('drops path, adds content metadata and keeps every declared field', async () => {
        const declaredPath = writeBlob('firmware/a.bin', 'aaa');
        const definition = definitionWith([
            {
                fileId: 'wallbox-a',
                path: declaredPath,
                firmwareVersion: '2024-11-rc3',
                vendorName: 'Acme',
                modelNames: ['AC-22-Pro'],
                releaseNotes: [{language: 'en', value: 'first'}],
                internalComment: 'internal'
            }
        ]);

        const prepared = await prepareFirmwareFiles(definition, packageRoot);
        const [published] = toPublishedFirmware(prepared);

        assert.ok(!('path' in published), 'local path must not leak into the published definition');
        assert.equal(published.sha256, sha256Of('aaa'));
        assert.equal(published.sizeBytes, 3);
        assert.equal(published.fileName, 'a.bin');
        assert.equal(published.mimeType, 'application/octet-stream');
        assert.equal(published.firmwareVersion, '2024-11-rc3');
        assert.equal(published.vendorName, 'Acme');
        assert.deepEqual(published.modelNames, ['AC-22-Pro']);
        assert.deepEqual(published.releaseNotes, [{language: 'en', value: 'first'}]);
        assert.equal(published.internalComment, 'internal');
    });

    test('preserves firmware array order end to end', async () => {
        // Deliberately in an order no sort would produce: neither
        // lexicographic nor semver ascending on firmwareVersion or fileId.
        const declared = [
            {fileId: 'z-third', path: writeBlob('firmware/c.bin', 'c'), firmwareVersion: '10.0.0'},
            {fileId: 'a-first', path: writeBlob('firmware/a.bin', 'a'), firmwareVersion: '2.4.1'},
            {fileId: 'm-second', path: writeBlob('firmware/b.bin', 'b'), firmwareVersion: 'A7F2'}
        ];
        const definition = definitionWith(declared);

        const prepared = await prepareFirmwareFiles(definition, packageRoot);
        assert.deepEqual(prepared.map((f) => f.fileId), ['z-third', 'a-first', 'm-second']);

        const published = toPublishedFirmware(prepared);
        assert.deepEqual(published.map((f) => f.fileId), ['z-third', 'a-first', 'm-second']);
        assert.deepEqual(published.map((f) => f.firmwareVersion), ['10.0.0', '2.4.1', 'A7F2']);

        // ...and survives serialization into the create-release payload, which
        // is what the runtime's "last declared entry wins" depends on.
        const payload = buildCreateReleasePayload(definition, undefined, 'production', prepared);
        const roundTripped = JSON.parse(JSON.stringify(payload)) as {
            firmware: {fileId: string}[];
            firmwareMode: string;
        };
        assert.deepEqual(
            roundTripped.firmware.map((f) => f.fileId),
            ['z-third', 'a-first', 'm-second']
        );
    });

    test('defaults firmwareMode to latest and carries an explicit mode through', async () => {
        const declared = [
            {fileId: 'a', path: writeBlob('firmware/a.bin', 'a'), firmwareVersion: '1'}
        ];
        const prepared = await prepareFirmwareFiles(definitionWith(declared), packageRoot);

        const defaulted = buildCreateReleasePayload(
            definitionWith(declared), undefined, 'production', prepared
        );
        assert.equal(defaulted.firmwareMode, 'latest');

        const explicit = buildCreateReleasePayload(
            definitionWith(declared, {firmwareMode: 'dependent'}), undefined, 'production', prepared
        );
        assert.equal(explicit.firmwareMode, 'dependent');
    });
});

describe('validateFirmwareDeclaration', () => {
    test('aborts the release on duplicate fileIds', () => {
        const definition = definitionWith([
            {fileId: 'dupe', path: './firmware/a.bin', firmwareVersion: '1'},
            {fileId: 'dupe', path: './firmware/b.bin', firmwareVersion: '2'}
        ]);

        assert.throws(() => validateFirmwareDeclaration(definition), CLIError);
    });

    test('aborts when the FirmwareRegistry permission is missing', () => {
        const definition = definitionWith(
            [{fileId: 'a', path: './firmware/a.bin', firmwareVersion: '1'}],
            {permissions: []}
        );

        assert.throws(() => validateFirmwareDeclaration(definition), CLIError);
    });

    test('passes a valid declaration and a package with no firmware', () => {
        const valid = definitionWith([
            {fileId: 'a', path: './firmware/a.bin', firmwareVersion: '1'},
            {fileId: 'b', path: './firmware/b.bin', firmwareVersion: '2'}
        ]);

        assert.doesNotThrow(() => validateFirmwareDeclaration(valid));
        assert.doesNotThrow(() => validateFirmwareDeclaration(definitionWith(undefined)));
    });
});

describe('uploadFirmwareFiles', () => {
    const prepared = (fileId: string, sha256: string): PreparedFirmwareFile => ({
        fileId,
        declaredPath: `./firmware/${fileId}.bin`,
        absolutePath: `/tmp/${fileId}.bin`,
        sha256,
        sizeBytes: 10,
        fileName: `${fileId}.bin`,
        mimeType: 'application/octet-stream',
        published: {
            fileId,
            firmwareVersion: '1',
            sha256,
            sizeBytes: 10,
            fileName: `${fileId}.bin`,
            mimeType: 'application/octet-stream'
        }
    });

    test('skips files the registry already holds by hash, without reading them', async () => {
        // absolutePath points at a file that does not exist: if the
        // implementation tried to upload rather than skip, this would throw.
        const files = [prepared('a', 'a'.repeat(64)), prepared('b', 'b'.repeat(64))];
        const targets: FirmwareUploadTarget[] = [
            {fileId: 'a', sha256: 'a'.repeat(64)},
            {fileId: 'b', sha256: 'b'.repeat(64)}
        ];

        await assert.doesNotReject(() => uploadFirmwareFiles(files, targets));
    });

    test('aborts when the registry returns no targets at all', async () => {
        await assert.rejects(
            () => uploadFirmwareFiles([prepared('a', 'a'.repeat(64))], undefined),
            CLIError
        );
    });

    test('aborts when a declared file has no matching target', async () => {
        await assert.rejects(
            () => uploadFirmwareFiles(
                [prepared('a', 'a'.repeat(64)), prepared('b', 'b'.repeat(64))],
                [{fileId: 'a', sha256: 'a'.repeat(64)}]
            ),
            (error: unknown) => {
                assert.ok(error instanceof CLIError);
                assert.match(error.message, /no upload target for firmware 'b'/);
                return true;
            }
        );
    });

    test('does nothing when the package declares no firmware', async () => {
        await assert.doesNotReject(() => uploadFirmwareFiles([], undefined));
    });

    test('re-releasing unchanged bytes yields the same hash, changed bytes a new one', async () => {
        const declaredPath = writeBlob('firmware/wallbox.bin', 'v1-bytes');
        const definition = definitionWith([
            {fileId: 'wallbox', path: declaredPath, firmwareVersion: '2.4.1'}
        ]);

        const first = await prepareFirmwareFiles(definition, packageRoot);
        const second = await prepareFirmwareFiles(definition, packageRoot);

        // Content addressing: the same bytes must hash identically across
        // releases, which is what lets the backend answer "already present".
        assert.equal(second[0].sha256, first[0].sha256);

        const targetsForRerelease: FirmwareUploadTarget[] = [
            {fileId: 'wallbox', sha256: first[0].sha256}
        ];
        await assert.doesNotReject(() => uploadFirmwareFiles(second, targetsForRerelease));

        // Changed bytes are a different entry, never a mutation of the old one.
        fs.writeFileSync(path.join(packageRoot, 'firmware/wallbox.bin'), 'v2-bytes');
        const third = await prepareFirmwareFiles(definition, packageRoot);
        assert.notEqual(third[0].sha256, first[0].sha256);
    });
});

describe('bundle packaging', () => {
    test('excludes firmware blobs from the released tarball', async () => {
        // A firmware blob that lives inside dist/ — the only case where the
        // tarball could otherwise pick it up.
        fs.mkdirSync(path.join(packageRoot, 'dist'), {recursive: true});
        fs.writeFileSync(path.join(packageRoot, 'dist', 'index.js'), 'console.log(1)');
        const declaredPath = writeBlob('dist/firmware/wallbox.bin', 'x'.repeat(1024));

        const definition = definitionWith([
            {fileId: 'wallbox', path: declaredPath, firmwareVersion: '2.4.1'}
        ]);
        const prepared = await prepareFirmwareFiles(definition, packageRoot);

        const args = buildBundleTarArgs('bundle.tar.gz', 'dist', prepared, packageRoot);
        execFileSync('tar', args, {cwd: packageRoot});

        const listing = execFileSync('tar', ['-tzf', 'bundle.tar.gz'], {
            cwd: packageRoot,
            encoding: 'utf-8'
        });

        assert.ok(listing.includes('dist/index.js'), 'the bundle must still contain the build output');
        assert.ok(
            !listing.includes('wallbox.bin'),
            `firmware blob must not be packaged, got:\n${listing}`
        );
    });

    test('produces a plain tar invocation when no firmware is declared', () => {
        assert.deepEqual(buildBundleTarArgs('bundle.tar.gz', 'dist', []), ['-czf', 'bundle.tar.gz', 'dist']);
    });
});
