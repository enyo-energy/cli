import {test, describe, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {CLIError} from './error-handler.js';
import {hashDirectoryContents, hashReleaseDefinition} from './fingerprint.js';

let distDir: string;

beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-fingerprint-test-'));
});

afterEach(() => {
    fs.rmSync(distDir, {recursive: true, force: true});
});

const write = (relativePath: string, contents: string): string => {
    const absolute = path.join(distDir, relativePath);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, contents);
    return absolute;
};

describe('hashDirectoryContents', () => {
    test('is stable across rebuilds that only change timestamps', async () => {
        write('index.js', 'console.log(1)');
        const before = await hashDirectoryContents(distDir);

        // A rebuild of unchanged sources: same bytes, new mtime. This is the
        // case a tarball hash gets wrong, which is why this function exists.
        const future = new Date(Date.now() + 60_000);
        fs.utimesSync(path.join(distDir, 'index.js'), future, future);

        assert.equal(await hashDirectoryContents(distDir), before);
    });

    test('changes when a file\'s content changes', async () => {
        write('index.js', 'console.log(1)');
        const before = await hashDirectoryContents(distDir);

        write('index.js', 'console.log(2)');

        assert.notEqual(await hashDirectoryContents(distDir), before);
    });

    test('changes when a file is added, even an empty one', async () => {
        write('index.js', 'console.log(1)');
        const before = await hashDirectoryContents(distDir);

        write('chunk.js', '');

        assert.notEqual(await hashDirectoryContents(distDir), before);
    });

    test('covers paths, not just contents', async () => {
        write('a.js', 'same');
        const before = await hashDirectoryContents(distDir);

        fs.rmSync(path.join(distDir, 'a.js'));
        write('b.js', 'same');

        assert.notEqual(await hashDirectoryContents(distDir), before);
    });

    test('descends into subdirectories', async () => {
        write('assets/nested/thing.json', '{}');
        const before = await hashDirectoryContents(distDir);

        write('assets/nested/thing.json', '{"a":1}');

        assert.notEqual(await hashDirectoryContents(distDir), before);
    });

    test('ignores the firmware blobs the tarball excludes', async () => {
        write('index.js', 'console.log(1)');
        const firmware = write('firmware/image.bin', 'v1');
        const before = await hashDirectoryContents(distDir, [firmware]);

        // Shipping a new firmware image is a real change, but it travels
        // through the registry rather than inside the bundle — the bundle
        // fingerprint must not notice it, or every firmware bump would look
        // like a changed bundle.
        write('firmware/image.bin', 'v2');

        assert.equal(await hashDirectoryContents(distDir, [firmware]), before);
    });

    test('refuses a directory that was never built', async () => {
        await assert.rejects(
            () => hashDirectoryContents(path.join(distDir, 'missing')),
            (error: unknown) => error instanceof CLIError
        );
    });
});

describe('hashReleaseDefinition', () => {
    const payload = {
        packageName: 'app',
        sdkVersion: '1.0.0',
        channel: 'production',
        storeEntry: [{language: 'en', title: 'App'}]
    };

    test('ignores key order', () => {
        assert.equal(
            hashReleaseDefinition({...payload}),
            hashReleaseDefinition({
                storeEntry: [{title: 'App', language: 'en'}],
                channel: 'production',
                sdkVersion: '1.0.0',
                packageName: 'app'
            })
        );
    });

    test('ignores release notes and the internal description', () => {
        assert.equal(
            hashReleaseDefinition(payload),
            hashReleaseDefinition({
                ...payload,
                releaseNote: [{language: 'de', note: 'Tippfehler behoben'}],
                internalDescription: 'for the reviewer'
            })
        );
    });

    test('notices a changed store entry', () => {
        assert.notEqual(
            hashReleaseDefinition(payload),
            hashReleaseDefinition({...payload, storeEntry: [{language: 'en', title: 'App 2'}]})
        );
    });

    test('notices a changed channel', () => {
        assert.notEqual(
            hashReleaseDefinition(payload),
            hashReleaseDefinition({...payload, channel: 'staging'})
        );
    });

    test('notices reordered firmware, which decides what a device is offered', () => {
        const withFirmware = (order: string[]) => ({
            ...payload,
            firmware: order.map((fileId) => ({fileId}))
        });

        assert.notEqual(
            hashReleaseDefinition(withFirmware(['a', 'b'])),
            hashReleaseDefinition(withFirmware(['b', 'a']))
        );
    });

    test('treats an absent key and an undefined one alike', () => {
        // `JSON.stringify` drops both, so the registry cannot tell them apart
        // either — the fingerprint must describe what goes over the wire.
        assert.equal(
            hashReleaseDefinition(payload),
            hashReleaseDefinition({...payload, logo: undefined})
        );
    });
});
