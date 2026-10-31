import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {createJiti} from 'jiti';
import {CLIError} from './error-handler.js';

/** What the simulation runtime knows: a Modbus TCP unit, a REST API over HTTP, an OCPP charge point or an EEBUS peer. */
export const DEVICE_SIMULATOR_PROTOCOLS = ['modbus-tcp', 'http', 'ocpp', 'eebus'] as const;
export type DeviceSimulatorProtocol = typeof DEVICE_SIMULATOR_PROTOCOLS[number];

/** Same ceiling the simulation runtime enforces. */
export const SCRIPT_MAX_BYTES = 256 * 1024;

const NAME_MAX_LENGTH = 128;
const DESCRIPTION_MAX_LENGTH = 1024;
const UNIT_ID_MIN = 1;
const UNIT_ID_MAX = 247;
const SCRIPT_FILE_NAME = /^[^/\\]+\.(js|mjs)$/;

/**
 * A `*.simulator.ts` (default export) or `*.simulator.json` file: one device
 * simulator of the developer org, pushed by `enyo simulator push`.
 */
export interface DeviceSimulatorManifest {
    /** What the simulator is picked by. Unique per developer org — a push replaces the one of this name. */
    name: string;
    vendor?: string;
    model?: string;
    description?: string;
    protocol: DeviceSimulatorProtocol;
    /** Modbus unit (slave) id, 1–247. Omit for the default, 1. */
    unitId?: number;
    /** Path of the script (`.js` / `.mjs`), relative to the manifest. */
    script: string;
}

/** The body of `PUT /api/registry/device-simulators/:name`. */
export interface DeviceSimulatorBody {
    name: string;
    vendor?: string;
    model?: string;
    description?: string;
    protocol: DeviceSimulatorProtocol;
    unitId?: number;
    script?: {fileName: string; source: string};
}

/** A manifest read, checked and resolved into what gets pushed. */
export interface ResolvedDeviceSimulator {
    manifestPath: string;
    body: DeviceSimulatorBody & {script: {fileName: string; source: string}};
    /** Hex SHA-256 of the script source, as the runtime reports it. */
    sha256: string;
}

/** The manifest at the root of a bundle — what the simulation runtime reads first. */
export const BUNDLE_MANIFEST = 'simulator.json';

/**
 * The bundle the simulation runtime stores in S3: `simulator.json` (the
 * manifest, `script` naming the file) and the script beside it, as a tar.gz —
 * packed with the system `tar`, the way `enyo release` packs an app.
 */
export const packDeviceSimulatorBundle = (simulator: ResolvedDeviceSimulator): Buffer => {
    const {script, ...masterData} = simulator.body;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-simulator-'));
    try {
        fs.writeFileSync(
            path.join(workDir, BUNDLE_MANIFEST),
            `${JSON.stringify({...masterData, script: script.fileName}, null, 2)}\n`,
        );
        fs.writeFileSync(path.join(workDir, script.fileName), script.source);
        const bundlePath = path.join(workDir, 'bundle.tar.gz');
        execFileSync('tar', ['-czf', bundlePath, '-C', workDir, BUNDLE_MANIFEST, script.fileName], {
            // macOS tar would add `._*` resource-fork entries otherwise.
            env: {...process.env, COPYFILE_DISABLE: '1'},
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        return fs.readFileSync(bundlePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CLIError(`Could not pack ${path.basename(simulator.manifestPath)}: ${message}`);
    } finally {
        fs.rmSync(workDir, {recursive: true, force: true});
    }
};

export const findDeviceSimulatorManifests = (directory: string = process.cwd()): string[] =>
    fs.readdirSync(directory)
        .filter(file => file.endsWith('.simulator.ts') || file.endsWith('.simulator.json'))
        .sort()
        .map(file => path.join(directory, file));

export const sha256Of = (source: string): string =>
    createHash('sha256').update(source, 'utf8').digest('hex');

export const readDeviceSimulatorManifest = async (manifestPath: string): Promise<ResolvedDeviceSimulator> => {
    const absolute = path.resolve(manifestPath);
    if (!fs.existsSync(absolute)) {
        throw new CLIError(`Simulator manifest not found at ${manifestPath}`);
    }
    let manifest: unknown;
    try {
        if (absolute.endsWith('.json')) {
            manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
        } else {
            const jiti = createJiti(absolute, {interopDefault: true});
            manifest = await jiti.import(absolute, {default: true});
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new CLIError(`Error reading ${manifestPath}: ${message}`);
    }
    return resolveDeviceSimulatorManifest(manifest, absolute);
};

/**
 * Checks a manifest the way the runtime will, so a broken one fails before
 * anything is sent, and reads its script.
 */
export const resolveDeviceSimulatorManifest = (manifest: unknown, manifestPath: string): ResolvedDeviceSimulator => {
    const where = path.basename(manifestPath);
    const fail = (message: string): never => {
        throw new CLIError(`${where}: ${message}`);
    };
    if (!manifest || typeof manifest !== 'object') {
        return fail('expected an object (the default export of a .simulator.ts file, or a .simulator.json object)');
    }
    const m = manifest as Record<string, unknown>;

    const text = (key: string, maxLength: number, required: boolean): string | undefined => {
        const value = m[key];
        if (value === undefined || value === null || value === '') {
            return required ? fail(`\`${key}\` is required`) : undefined;
        }
        if (typeof value !== 'string') {
            return fail(`\`${key}\` must be a string`);
        }
        const trimmed = value.trim();
        if (required && trimmed.length === 0) {
            return fail(`\`${key}\` is required`);
        }
        if (trimmed.length > maxLength) {
            return fail(`\`${key}\` is longer than ${maxLength} characters`);
        }
        return trimmed.length > 0 ? trimmed : undefined;
    };

    const name = text('name', NAME_MAX_LENGTH, true) as string;
    const vendor = text('vendor', NAME_MAX_LENGTH, false);
    const model = text('model', NAME_MAX_LENGTH, false);
    const description = text('description', DESCRIPTION_MAX_LENGTH, false);

    const protocol = m.protocol;
    if (!DEVICE_SIMULATOR_PROTOCOLS.includes(protocol as DeviceSimulatorProtocol)) {
        fail(`\`protocol\` must be one of ${DEVICE_SIMULATOR_PROTOCOLS.join(', ')}`);
    }

    const unitId = m.unitId;
    if (unitId !== undefined && (!Number.isInteger(unitId) || (unitId as number) < UNIT_ID_MIN || (unitId as number) > UNIT_ID_MAX)) {
        fail(`\`unitId\` must be an integer from ${UNIT_ID_MIN} to ${UNIT_ID_MAX}`);
    }

    const scriptPath = text('script', 4096, true) as string;
    const scriptAbsolute = path.resolve(path.dirname(manifestPath), scriptPath);
    const fileName = path.basename(scriptAbsolute);
    if (!SCRIPT_FILE_NAME.test(fileName)) {
        fail(`\`script\` must be a .js or .mjs file, got ${scriptPath}`);
    }
    if (!fs.existsSync(scriptAbsolute)) {
        fail(`script not found at ${scriptPath}`);
    }
    const source = fs.readFileSync(scriptAbsolute, 'utf8');
    if (source.trim().length === 0) {
        fail(`script ${scriptPath} is empty`);
    }
    const sizeBytes = Buffer.byteLength(source, 'utf8');
    if (sizeBytes > SCRIPT_MAX_BYTES) {
        fail(`script ${scriptPath} is ${sizeBytes} bytes, more than the ${SCRIPT_MAX_BYTES} allowed`);
    }

    return {
        manifestPath,
        body: {
            name,
            ...(vendor ? {vendor} : {}),
            ...(model ? {model} : {}),
            ...(description ? {description} : {}),
            protocol: protocol as DeviceSimulatorProtocol,
            ...(unitId !== undefined ? {unitId: unitId as number} : {}),
            script: {fileName, source},
        },
        sha256: sha256Of(source),
    };
};
