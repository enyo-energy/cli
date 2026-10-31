import {test, describe, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {CLIError} from './error-handler.js';
import {
    findDeviceSimulatorManifests,
    readDeviceSimulatorManifest,
    resolveDeviceSimulatorManifest,
    SCRIPT_MAX_BYTES,
    sha256Of,
} from './device-simulator-manifest.js';

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-simulator-manifest-test-'));
});

afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

const write = (relativePath: string, contents: string): string => {
    const absolute = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, contents);
    return absolute;
};

const SOURCE = 'enyoSimulation.modbusTcp();';

const resolve = (manifest: Record<string, unknown>) =>
    resolveDeviceSimulatorManifest(manifest, path.join(dir, 'fronius.simulator.json'));

describe('resolveDeviceSimulatorManifest', () => {
    test('reads the script relative to the manifest and hashes it', () => {
        write('simulators/fronius.js', SOURCE);

        const resolved = resolve({
            name: ' Fronius ',
            vendor: 'Fronius',
            protocol: 'modbus-tcp',
            unitId: 1,
            script: './simulators/fronius.js',
        });

        assert.deepEqual(resolved.body, {
            name: 'Fronius',
            vendor: 'Fronius',
            protocol: 'modbus-tcp',
            unitId: 1,
            script: {fileName: 'fronius.js', source: SOURCE},
        });
        assert.equal(resolved.sha256, sha256Of(SOURCE));
    });

    test('leaves out empty optional fields, so the push clears them', () => {
        write('fronius.js', SOURCE);

        const resolved = resolve({name: 'Fronius', vendor: '', protocol: 'http', script: 'fronius.js'});

        assert.equal('vendor' in resolved.body, false);
    });

    test('refuses what the runtime would refuse', () => {
        write('fronius.js', SOURCE);
        write('empty.js', '   ');
        write('fronius.ts', SOURCE);
        write('big.js', 'x'.repeat(SCRIPT_MAX_BYTES + 1));
        const base = {name: 'Fronius', protocol: 'modbus-tcp', script: 'fronius.js'};

        for (const manifest of [
            {...base, name: ''},
            {...base, name: 'x'.repeat(129)},
            {...base, protocol: 'zigbee'},
            {...base, unitId: 0},
            {...base, unitId: 248},
            {...base, unitId: 1.5},
            {...base, script: 'missing.js'},
            {...base, script: 'empty.js'},
            {...base, script: 'fronius.ts'},
            {...base, script: 'big.js'},
        ]) {
            assert.throws(() => resolve(manifest), CLIError, JSON.stringify(manifest).slice(0, 80));
        }
    });
});

describe('readDeviceSimulatorManifest', () => {
    test('reads the default export of a .simulator.ts file', async () => {
        write('fronius.js', SOURCE);
        const manifestPath = write('fronius.simulator.ts', `
            const manifest: {name: string; protocol: 'modbus-tcp'; script: string} = {
                name: 'Fronius', protocol: 'modbus-tcp', script: './fronius.js',
            };
            export default manifest;
        `);

        const resolved = await readDeviceSimulatorManifest(manifestPath);

        assert.equal(resolved.body.name, 'Fronius');
    });

    test('reads a .simulator.json file', async () => {
        write('fronius.js', SOURCE);
        const manifestPath = write('fronius.simulator.json', JSON.stringify({name: 'Fronius', protocol: 'http', script: 'fronius.js'}));

        const resolved = await readDeviceSimulatorManifest(manifestPath);

        assert.equal(resolved.body.protocol, 'http');
    });
});

describe('findDeviceSimulatorManifests', () => {
    test('finds .simulator.ts and .simulator.json, nothing else', () => {
        write('a.simulator.ts', '');
        write('b.simulator.json', '');
        write('energy-app.package.ts', '');
        write('fronius.js', '');

        assert.deepEqual(
            findDeviceSimulatorManifests(dir).map(file => path.basename(file)),
            ['a.simulator.ts', 'b.simulator.json'],
        );
    });
});
