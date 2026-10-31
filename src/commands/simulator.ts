import fs from 'fs';
import path from 'path';
import type {SimulatorCommandOptions} from '../types';
import {DEFAULT_SIMULATION_RUNTIME_URL} from '../constants/defaults.js';
import {CLIError} from '../utils/error-handler.js';
import {
    findDeviceSimulatorManifests,
    packDeviceSimulatorBundle,
    readDeviceSimulatorManifest,
    ResolvedDeviceSimulator,
} from '../utils/device-simulator-manifest.js';

/** What the runtime answers for one simulator (the source is never part of it). */
interface DeviceSimulatorResponse {
    id: string;
    name: string;
    vendor?: string;
    model?: string;
    protocol: string;
    unitId?: number;
    script: {fileName: string; sizeBytes: number; sha256: string; updatedAtIso: string};
    updatedVia?: string;
    createdAtIso: string;
    updatedAtIso: string;
}

/**
 * The org's device simulators in the simulation runtime, authenticated with
 * the developer org API key — the org is the key's.
 */
class SimulatorRegistry {
    private readonly baseUrl: string;

    constructor(private readonly apiKey: string, runtimeUrl: string, private readonly developerOrgId?: string) {
        this.baseUrl = `${runtimeUrl.replace(/\/+$/, '')}/api/registry/device-simulators`;
    }

    async list(): Promise<DeviceSimulatorResponse[]> {
        return this.json<DeviceSimulatorResponse[]>(await this.request('GET', ''));
    }

    /** `undefined` when the org has no simulator of this name. */
    async find(name: string): Promise<DeviceSimulatorResponse | undefined> {
        const response = await this.request('GET', `/${encodeURIComponent(name)}`);
        if (response.status === 404) {
            return undefined;
        }
        return this.json<DeviceSimulatorResponse>(response);
    }

    /** Uploads the bundle; the runtime creates the simulator of this name or replaces it in place. */
    async put(name: string, bundle: Buffer): Promise<{created: boolean; simulator: DeviceSimulatorResponse}> {
        const form = new FormData();
        form.append('bundle', new Blob([new Uint8Array(bundle)], {type: 'application/gzip'}), 'bundle.tar.gz');
        const response = await this.request('PUT', `/${encodeURIComponent(name)}`, form);
        return {created: response.status === 201, simulator: await this.json<DeviceSimulatorResponse>(response)};
    }

    async script(name: string): Promise<string> {
        const response = await this.request('GET', `/${encodeURIComponent(name)}/script`);
        await this.ensureOk(response);
        return response.text();
    }

    async remove(name: string): Promise<void> {
        await this.ensureOk(await this.request('DELETE', `/${encodeURIComponent(name)}`));
    }

    /** A multipart body sets its own content type, boundary included. */
    private async request(method: string, suffix: string, body?: FormData): Promise<Response> {
        try {
            return await fetch(`${this.baseUrl}${suffix}`, {
                method,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...(this.developerOrgId ? {'X-Developer-Org-Id': this.developerOrgId} : {}),
                },
                ...(body !== undefined ? {body} : {}),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new CLIError(`Simulation runtime at ${this.baseUrl} is unreachable: ${message}`);
        }
    }

    private async json<T>(response: Response): Promise<T> {
        await this.ensureOk(response);
        return (await response.json()) as T;
    }

    private async ensureOk(response: Response): Promise<void> {
        if (response.ok) {
            return;
        }
        const text = await response.text().catch(() => '');
        let reason = text;
        try {
            const parsed = JSON.parse(text) as {message?: string | string[]};
            if (parsed.message) {
                reason = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
            }
        } catch {
            // Not JSON — the body as it came.
        }
        if (response.status === 403 && reason === 'developer_org_mismatch') {
            throw new CLIError(`The API key does not belong to developer org ${this.developerOrgId}.`);
        }
        if (response.status === 401) {
            throw new CLIError(`The simulation runtime refused the API key (${reason || 'unauthorized'}). Use your Developer Org API key.`);
        }
        throw new CLIError(`Simulation runtime answered ${response.status}${reason ? `: ${reason}` : ''}`);
    }
}

const registryOf = (options: SimulatorCommandOptions): SimulatorRegistry => {
    if (!options.apiKey) {
        throw new CLIError('Developer Org API Key is required. Use --api-key <apiKey>');
    }
    return new SimulatorRegistry(
        options.apiKey,
        options.simulationRuntime || DEFAULT_SIMULATION_RUNTIME_URL,
        options.developerOrgId,
    );
};

/**
 * Push every `*.simulator.ts` / `*.simulator.json` in the current directory
 * (or the one `--file` names), each packed as a bundle (manifest + script,
 * tar.gz). Each replaces the org's simulator of the same name in place; one
 * that did not change is left as it was.
 */
export async function simulatorPushCommand(options: SimulatorCommandOptions): Promise<void> {
    const manifestPaths = options.file ? [options.file] : findDeviceSimulatorManifests();
    if (manifestPaths.length === 0) {
        throw new CLIError('No *.simulator.ts or *.simulator.json found in the current directory. Use -f <file> to name one.');
    }
    // Every manifest is checked before the first one is sent, so a broken one
    // does not leave the org with half of a set pushed.
    const simulators: ResolvedDeviceSimulator[] = [];
    for (const manifestPath of manifestPaths) {
        simulators.push(await readDeviceSimulatorManifest(manifestPath));
    }
    const names = simulators.map(simulator => simulator.body.name);
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) {
        throw new CLIError(`Two manifests name the simulator "${duplicate}" — names are unique per developer org.`);
    }

    const bundles = simulators.map(simulator => packDeviceSimulatorBundle(simulator));

    const registry = registryOf(options);
    for (const [index, simulator] of simulators.entries()) {
        const existing = await registry.find(simulator.body.name);
        const scriptUnchanged = existing?.script.sha256 === simulator.sha256
            && existing.script.fileName === simulator.body.script.fileName;
        const {created, simulator: stored} = await registry.put(simulator.body.name, bundles[index]!);

        const label = `"${stored.name}" (${path.basename(simulator.manifestPath)})`;
        if (created) {
            console.log(`✅ Created ${label} — id ${stored.id}`);
        } else if (existing && stored.updatedAtIso === existing.updatedAtIso) {
            console.log(`⏭️  ${label} unchanged`);
        } else {
            console.log(`✅ Updated ${label}${scriptUnchanged ? ' (script unchanged)' : ''}`);
        }
    }
}

export async function simulatorListCommand(options: SimulatorCommandOptions): Promise<void> {
    const simulators = await registryOf(options).list();
    if (simulators.length === 0) {
        console.log('Your developer org has no device simulators yet. Push one with `enyo simulator push`.');
        return;
    }
    console.table(simulators.map(simulator => ({
        name: simulator.name,
        vendor: simulator.vendor ?? '',
        model: simulator.model ?? '',
        protocol: simulator.protocol,
        script: `${simulator.script.fileName} (${simulator.script.sizeBytes} B)`,
        updated: simulator.updatedAtIso,
        id: simulator.id,
    })));
}

/** Write a stored script to a file — `--out`, or its own file name in the current directory. */
export async function simulatorPullCommand(name: string, options: SimulatorCommandOptions & {out?: string}): Promise<void> {
    const registry = registryOf(options);
    const simulator = await registry.find(name);
    if (!simulator) {
        throw new CLIError(`Your developer org has no device simulator named "${name}".`);
    }
    const target = options.out ?? simulator.script.fileName;
    if (fs.existsSync(target) && !options.force) {
        throw new CLIError(`${target} already exists. Use --force to overwrite it, or --out <file>.`);
    }
    fs.writeFileSync(target, await registry.script(name));
    console.log(`✅ Wrote the script of "${name}" to ${target}`);
}

export async function simulatorDeleteCommand(name: string, options: SimulatorCommandOptions): Promise<void> {
    await registryOf(options).remove(name);
    console.log(`🗑️  Deleted "${name}". Simulations already running keep it until they end.`);
}
