import {test, describe, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {
    preparePublicFiles,
    toPublishedFiles,
    uploadPublicFiles,
    validatePublicFilesDeclaration
} from './public-files.js';
import {buildCreateReleasePayload} from '../commands/release.js';
import type {PreparedPublicFile, PublicFileUploadTarget} from '../types';

let packageRoot: string;

beforeEach(() => {
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-files-test-'));
});

afterEach(() => {
    fs.rmSync(packageRoot, {recursive: true, force: true});
});

/** Write an asset under the package root and return its declared path. */
const writeAsset = (relativePath: string, contents: string): string => {
    const absolute = path.join(packageRoot, relativePath);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, contents);
    return `./${relativePath}`;
};

const sha256Of = (contents: string): string =>
    crypto.createHash('sha256').update(contents).digest('hex');

/** A minimal definition that satisfies the SDK validator, plus the given files. */
const definitionWith = (
    files: EnergyAppPackageDefinition['files'],
    overrides: Partial<EnergyAppPackageDefinition> = {}
): EnergyAppPackageDefinition => ({
    version: '1',
    packageName: 'test-package',
    sdkVersion: '0.0.195',
    permissions: [],
    categories: [],
    storeEntry: [],
    compatibility: [],
    files,
    ...overrides
} as unknown as EnergyAppPackageDefinition);

describe('validatePublicFilesDeclaration', () => {
    test('passes a package declaring no files', () => {
        assert.doesNotThrow(() => validatePublicFilesDeclaration(definitionWith(undefined)));
    });

    test('rejects a duplicate name before anything reaches the registry', () => {
        const definition = definitionWith([
            {name: 'dip', path: './assets/a.png'},
            {name: 'dip', path: './assets/b.png'}
        ]);
        assert.throws(() => validatePublicFilesDeclaration(definition), CLIError);
    });

    test('rejects a path escaping the package', () => {
        const definition = definitionWith([{name: 'dip', path: '../outside.png'}]);
        assert.throws(() => validatePublicFilesDeclaration(definition), CLIError);
    });
});

describe('preparePublicFiles', () => {
    test('returns an empty list when nothing is declared', async () => {
        assert.deepEqual(await preparePublicFiles(definitionWith(undefined), packageRoot), []);
    });

    test('fails with name and path when the declared file is missing', async () => {
        const definition = definitionWith([{name: 'dip', path: './assets/absent.png'}]);
        await assert.rejects(
            () => preparePublicFiles(definition, packageRoot),
            (error: unknown) => {
                assert.ok(error instanceof CLIError);
                assert.match(error.message, /Package file 'dip'/);
                assert.match(error.message, /absent\.png/);
                return true;
            }
        );
    });

    test('fails when the declared path is a directory', async () => {
        fs.mkdirSync(path.join(packageRoot, 'assets/dir.png'), {recursive: true});
        const definition = definitionWith([{name: 'dip', path: './assets/dir.png'}]);
        await assert.rejects(() => preparePublicFiles(definition, packageRoot), CLIError);
    });

    test('fails when the path escapes the package root', async () => {
        const outside = path.join(os.tmpdir(), 'enyo-files-outside.png');
        fs.writeFileSync(outside, 'x');
        const definition = definitionWith([{name: 'dip', path: '../enyo-files-outside.png'}]);
        await assert.rejects(
            () => preparePublicFiles(definition, packageRoot),
            (error: unknown) => {
                assert.ok(error instanceof CLIError);
                assert.match(error.message, /outside the package root/);
                return true;
            }
        );
        fs.rmSync(outside, {force: true});
    });

    test('fingerprints the content and keeps declaration order', async () => {
        const definition = definitionWith([
            {name: 'dip-switches', path: writeAsset('assets/dip-switches.png', 'first')},
            {name: 'wiring', path: writeAsset('assets/wiring.jpg', 'second')}
        ]);

        const prepared = await preparePublicFiles(definition, packageRoot);

        assert.deepEqual(prepared.map((file) => file.name), ['dip-switches', 'wiring']);
        assert.equal(prepared[0].sha256, sha256Of('first'));
        assert.equal(prepared[0].sizeBytes, 5);
        assert.equal(prepared[0].fileName, 'dip-switches.png');
        assert.equal(prepared[0].mimeType, 'image/png');
        assert.equal(prepared[1].mimeType, 'image/jpeg');
    });

    test('a declared mimeType wins over the extension', async () => {
        const definition = definitionWith([
            {name: 'diagram', path: writeAsset('assets/diagram.bin', 'x'), mimeType: 'image/png'}
        ]);

        const prepared = await preparePublicFiles(definition, packageRoot);

        assert.equal(prepared[0].mimeType, 'image/png');
    });
});

describe('toPublishedFiles', () => {
    test('drops the local path and carries the name and metadata through', async () => {
        const definition = definitionWith([
            {
                name: 'dip-switches',
                path: writeAsset('assets/dip-switches.png', 'first'),
                internalComment: 'behind the front cover'
            }
        ]);

        const published = toPublishedFiles(await preparePublicFiles(definition, packageRoot));

        assert.deepEqual(published, [{
            name: 'dip-switches',
            internalComment: 'behind the front cover',
            sha256: sha256Of('first'),
            sizeBytes: 5,
            fileName: 'dip-switches.png',
            mimeType: 'image/png'
        }]);
        assert.ok(!('path' in published[0]));
    });
});

describe('buildCreateReleasePayload', () => {
    test('sends no files when the package declares none', () => {
        const payload = buildCreateReleasePayload(definitionWith(undefined), undefined, 'production', [], []);
        // `...config` carries the declared key through, so the check is on the
        // value: undefined is dropped by JSON.stringify and never reaches the
        // registry.
        assert.equal(payload.files, undefined);
    });

    test('sends the published form when files are declared', async () => {
        const definition = definitionWith([
            {name: 'dip-switches', path: writeAsset('assets/dip-switches.png', 'first')}
        ]);
        const prepared = await preparePublicFiles(definition, packageRoot);

        const payload = buildCreateReleasePayload(definition, undefined, 'production', [], prepared);

        assert.deepEqual(payload.files, toPublishedFiles(prepared));
    });
});

describe('uploadPublicFiles', () => {
    const prepared = (name: string, sha256: string): PreparedPublicFile => ({
        name,
        declaredPath: `./assets/${name}.png`,
        absolutePath: `/tmp/${name}.png`,
        sha256,
        sizeBytes: 10,
        fileName: `${name}.png`,
        mimeType: 'image/png',
        published: {
            name,
            sha256,
            sizeBytes: 10,
            fileName: `${name}.png`,
            mimeType: 'image/png'
        }
    });

    test('does nothing when nothing is declared', async () => {
        await assert.doesNotReject(() => uploadPublicFiles([], undefined));
    });

    test('skips files the registry already holds by hash, without reading them', async () => {
        // absolutePath points at a file that does not exist: if the
        // implementation tried to upload rather than skip, this would throw.
        const files = [prepared('a', 'a'.repeat(64)), prepared('b', 'b'.repeat(64))];
        const targets: PublicFileUploadTarget[] = [
            {name: 'a', sha256: 'a'.repeat(64)},
            {name: 'b', sha256: 'b'.repeat(64)}
        ];

        await assert.doesNotReject(() => uploadPublicFiles(files, targets));
    });

    test('aborts when the registry returns no targets at all', async () => {
        await assert.rejects(
            () => uploadPublicFiles([prepared('a', 'a'.repeat(64))], undefined),
            CLIError
        );
    });

    test('aborts when a declared file has no matching target', async () => {
        await assert.rejects(
            () => uploadPublicFiles(
                [prepared('a', 'a'.repeat(64)), prepared('b', 'b'.repeat(64))],
                [{name: 'a', sha256: 'a'.repeat(64)}]
            ),
            (error: unknown) => {
                assert.ok(error instanceof CLIError);
                assert.match(error.message, /no upload target for package file 'b'/);
                return true;
            }
        );
    });
});
