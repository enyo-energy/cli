import {test, describe, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'fs';
import http from 'http';
import type {AddressInfo} from 'net';
import os from 'os';
import path from 'path';
import {sha256Of} from '../utils/device-simulator-manifest.js';
import {simulatorPushCommand} from './simulator.js';

const SOURCE = 'enyoSimulation.modbusTcp();';

interface Recorded {
    method: string;
    url: string;
    authorization?: string;
    developerOrgId?: string;
    /** What the uploaded bundle unpacks to, by file name. */
    bundle?: Record<string, string>;
}

/** Unpacks a tar.gz with the system tar — the same thing the runtime has to be able to read. */
const unpack = (bytes: Buffer): Record<string, string> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-bundle-unpack-'));
    try {
        fs.writeFileSync(path.join(dir, 'bundle.tar.gz'), bytes);
        fs.mkdirSync(path.join(dir, 'out'));
        execFileSync('tar', ['-xzf', path.join(dir, 'bundle.tar.gz'), '-C', path.join(dir, 'out')]);
        return Object.fromEntries(
            fs.readdirSync(path.join(dir, 'out')).map(file => [file, fs.readFileSync(path.join(dir, 'out', file), 'utf8')]),
        );
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
};

/** A stand-in for the runtime's registry: one org, simulators by name, bundles as multipart. */
const startRegistry = async (stored: Record<string, Record<string, unknown>>) => {
    const requests: Recorded[] = [];
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', async () => {
            const raw = Buffer.concat(chunks);
            let bundle: Record<string, string> | undefined;
            if (request.method === 'PUT') {
                const form = await new Request('http://registry', {
                    method: 'PUT',
                    headers: {'content-type': request.headers['content-type']!},
                    body: raw,
                }).formData();
                const file = form.get('bundle') as Blob;
                bundle = unpack(Buffer.from(await file.arrayBuffer()));
            }
            requests.push({
                method: request.method!,
                url: request.url!,
                authorization: request.headers.authorization,
                developerOrgId: request.headers['x-developer-org-id'] as string | undefined,
                bundle,
            });
            const name = decodeURIComponent(request.url!.split('/').pop()!);
            const existing = stored[name];
            response.setHeader('Content-Type', 'application/json');
            if (request.method === 'GET') {
                response.statusCode = existing ? 200 : 404;
                response.end(JSON.stringify(existing ?? {message: 'simulator_not_found'}));
                return;
            }
            response.statusCode = existing ? 200 : 201;
            response.end(JSON.stringify({
                id: 'sim-1',
                name,
                protocol: JSON.parse(bundle!['simulator.json']!).protocol,
                script: {fileName: 'fronius.js', sha256: sha256Of(SOURCE), sizeBytes: SOURCE.length},
                createdAtIso: '2026-10-01T10:00:00.000Z',
                updatedAtIso: (existing?.updatedAtIso as string | undefined) ?? '2026-10-30T10:00:00.000Z',
            }));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {url, requests, close: () => new Promise(resolve => server.close(resolve))};
};

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-simulator-push-test-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'fronius.js'), SOURCE);
    fs.writeFileSync(path.join(dir, 'fronius.simulator.json'), JSON.stringify({
        name: 'Fronius Symo', vendor: 'Fronius', protocol: 'modbus-tcp', script: './scripts/fronius.js',
    }));
});

afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('simulatorPushCommand', () => {
    test('uploads a bundle of manifest and script, with the org key and org id', async () => {
        const registry = await startRegistry({});
        try {
            await simulatorPushCommand({
                apiKey: 'org-key',
                simulationRuntime: registry.url,
                developerOrgId: 'org-1',
                file: path.join(dir, 'fronius.simulator.json'),
            });
        } finally {
            await registry.close();
        }

        const put = registry.requests.find(request => request.method === 'PUT')!;
        assert.equal(put.url, '/api/registry/device-simulators/Fronius%20Symo');
        assert.equal(put.authorization, 'Bearer org-key');
        assert.equal(put.developerOrgId, 'org-1');
        assert.deepEqual(Object.keys(put.bundle!).sort(), ['fronius.js', 'simulator.json']);
        assert.equal(put.bundle!['fronius.js'], SOURCE);
        // The script sits beside the manifest in the bundle, whatever its path in the repository.
        assert.deepEqual(JSON.parse(put.bundle!['simulator.json']!), {
            name: 'Fronius Symo', vendor: 'Fronius', protocol: 'modbus-tcp', script: 'fronius.js',
        });
    });

    test('pushes an existing simulator again — the runtime decides whether anything changed', async () => {
        const registry = await startRegistry({
            'Fronius Symo': {
                id: 'sim-1',
                name: 'Fronius Symo',
                script: {fileName: 'fronius.js', sha256: sha256Of(SOURCE), sizeBytes: SOURCE.length},
                updatedAtIso: '2026-10-01T10:00:00.000Z',
            },
        });
        try {
            await simulatorPushCommand({
                apiKey: 'org-key',
                simulationRuntime: registry.url,
                file: path.join(dir, 'fronius.simulator.json'),
            });
        } finally {
            await registry.close();
        }

        assert.deepEqual(registry.requests.map(request => request.method), ['GET', 'PUT']);
    });
});
