/**
 * Boots an energy app bundle against the mock SDK and pulls its onboarding v2
 * guides — the "give me your guides" call the host makes on a real device.
 *
 * The bundle runs in a `vm` context shaped like the one the device runtime
 * builds for a package (`device-core-package-worker/src/sandbox/vm-context.ts`):
 * `energyAppSdkInstance` and its `connectEmsApi` alias are globals there, which
 * is why the app needs no changes to run here. Isolation is not the point — an
 * app that wants the filesystem still gets it through `require` — the point is
 * that `console` and the SDK global belong to the app alone.
 */
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {
    EnyoOnboardingV2GuidesOriginEnum,
    validateOnboardingGuideV2,
    validateOnboardingV2GuidesResult,
} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageDefinition,
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2GuidesResult,
} from '@enyo-energy/energy-app-sdk';
import {CLIError} from '../utils/error-handler.js';
import {createMockSdk, type MockSdk, type MockSdkCall} from './mock-sdk.js';

/** One line the app printed while it was booting or answering. */
export interface AppLogLine {
    at: number;
    level: 'log' | 'info' | 'warn' | 'error' | 'debug';
    message: string;
}

/**
 * What the app said when asked for its guides.
 *
 * `null` and `[]` are different answers and the distinction is the app's most
 * common onboarding bug: `[]` retires every guide the host cached, `null` means
 * "not answering right now". The simulator names which one it got.
 */
export type GuidesAnswer = 'guides' | 'empty' | 'null' | 'timeout' | 'rejected' | 'no-handler';

export interface GuideValidation {
    guideName: string;
    ok: boolean;
    errors: string[];
    warnings: string[];
}

export interface LoadedApp {
    packageName: string;
    /** The package root the app was loaded from — declared file paths resolve against it. */
    cwd: string;
    entryPath: string;
    /** Public files declared in the package definition — image blocks resolve against these. */
    files: EnergyAppPackagePublicFile[];
    mock: MockSdk;
    guides: EnyoOnboardingV2Guide[];
    answer: GuidesAnswer;
    /** Untranslated detail the app attached to its answer, if any. */
    detail?: string;
    /** The whole-answer verdict, plus one entry per guide. */
    validation: {
        result: { ok: boolean; errors: string[]; warnings: string[] };
        guides: GuideValidation[];
    };
    logs: AppLogLine[];
    /** Ask the app for its guides again — the `refreshOnboardingGuides` path. */
    reload: () => Promise<void>;
}

type EnergyAppPackagePublicFile = NonNullable<EnergyAppPackageDefinition['files']>[number];

export interface LoadEnergyAppOptions {
    /** Directory the app lives in; `dist/index.js` is resolved against it. */
    cwd?: string;
    /** Explicit bundle entry point, overriding the `dist/index.js` default. */
    entry?: string;
    /** The package definition, when one was found — used for the app's name and file list. */
    config?: EnergyAppPackageDefinition;
    allowNetwork?: boolean;
    /** How long the app gets to answer the guides request, mirroring the host's budget. */
    timeoutMs?: number;
    onCall?: (call: MockSdkCall) => void;
    onLog?: (line: AppLogLine) => void;
}

/** The host's budget for a guides request made while an installer waits. */
export const DEFAULT_GUIDES_TIMEOUT_MS = 5_000;

const resolveEntry = (options: LoadEnergyAppOptions): string => {
    const cwd = options.cwd ?? process.cwd();
    if (options.entry) {
        const explicit = path.resolve(cwd, options.entry);
        if (!fs.existsSync(explicit)) {
            throw new CLIError(`Bundle not found at ${explicit}`);
        }
        return explicit;
    }

    for (const candidate of ['dist/index.js', 'dist/main.js']) {
        const resolved = path.resolve(cwd, candidate);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    throw new CLIError(
        'No built bundle found (looked for dist/index.js and dist/main.js). ' +
        'Build the app first with "npx rsbuild build", pass --entry <file>, or start the simulator with --build.'
    );
};

/** The app's `console`, captured rather than interleaved with the CLI's own output. */
const createAppConsole = (startedAt: number, sink: (line: AppLogLine) => void): Console => {
    const write = (level: AppLogLine['level']) => (...args: unknown[]) => {
        const message = args
            .map(arg => {
                if (typeof arg === 'string') {
                    return arg;
                }
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            })
            .join(' ');
        sink({at: Date.now() - startedAt, level, message});
    };

    // A Proxy so the app can call any console method (`console.table`, `dir`, …)
    // without the simulator having to enumerate them.
    return new Proxy({} as Console, {
        get: (_target, property) => {
            switch (property) {
                case 'warn':
                    return write('warn');
                case 'error':
                    return write('error');
                case 'debug':
                    return write('debug');
                case 'info':
                    return write('info');
                default:
                    return write('log');
            }
        },
    });
};

/**
 * The globals this Node has that a bare `vm` context does not: `crypto`,
 * `fetch`, `process`, `Buffer`, `performance`, the timers, and whatever a newer
 * Node adds next.
 *
 * Derived rather than listed. A hand-written list is a list of the globals
 * *someone thought of*, and an app only finds out which one is missing when it
 * crashes on `crypto.subtle` halfway through a bundle. The JS built-ins are left
 * to the context itself so the app still gets its own `Object`, `Array` and
 * friends; only the host-provided ones are passed through.
 */
const hostOnlyGlobals = (): Record<string, unknown> => {
    const builtIns = new Set(
        Object.getOwnPropertyNames(vm.runInNewContext('globalThis') as object)
    );
    const host = globalThis as unknown as Record<string, unknown>;
    const extras: Record<string, unknown> = {};

    for (const name of Object.getOwnPropertyNames(globalThis)) {
        // `global`/`globalThis` are the sandbox's own self-references, set below.
        if (builtIns.has(name) || name === 'global' || name === 'globalThis') {
            continue;
        }
        try {
            extras[name] = host[name];
        } catch {
            // A lazy global that throws when touched outside its own context is
            // one the app cannot have used either.
        }
    }
    return extras;
};

const runBundle = (entryPath: string, sandbox: Record<string, unknown>): void => {
    const source = fs.readFileSync(entryPath, 'utf-8');
    const context = vm.createContext(sandbox);
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    try {
        new vm.Script(source, {filename: entryPath}).runInContext(context);
    } catch (error) {
        if (error instanceof SyntaxError && /import statement outside a module|Unexpected token 'export'/.test(error.message)) {
            throw new CLIError(
                `${entryPath} is an ES module bundle, which the simulator cannot load into a sandbox. ` +
                'Build the app with rsbuild\'s node target (CommonJS output), which is what a device runs.'
            );
        }
        throw error;
    }
};

/** Reject after `timeoutMs`, the way the host gives up on a slow handler. */
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> => {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<'timeout'>(resolve => {
                timer = setTimeout(() => resolve('timeout'), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

export const loadEnergyApp = async (options: LoadEnergyAppOptions = {}): Promise<LoadedApp> => {
    const cwd = options.cwd ?? process.cwd();
    const entryPath = resolveEntry(options);
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_GUIDES_TIMEOUT_MS;
    const packageName = options.config?.packageName ?? path.basename(cwd);
    const files = options.config?.files ?? [];

    const logs: AppLogLine[] = [];
    const appConsole = createAppConsole(startedAt, line => {
        logs.push(line);
        options.onLog?.(line);
    });

    const mock = createMockSdk({
        packageName,
        allowNetwork: options.allowNetwork ?? false,
        onCall: options.onCall,
    });

    const appRequire = createRequire(entryPath);
    const moduleShim = {exports: {}, id: entryPath, filename: entryPath, loaded: false};
    const sandbox: Record<string, unknown> = {
        ...hostOnlyGlobals(),
        console: appConsole,
        require: appRequire,
        __dirname: path.dirname(entryPath),
        __filename: entryPath,
        exports: moduleShim.exports,
        module: moduleShim,
        energyAppSdkInstance: mock.instance,
        // The runtime exposes the same object under its historic name.
        connectEmsApi: mock.instance,
    };

    // An app that bundles the SDK (what rsbuild does, and what a device runs)
    // finds the global inside the sandbox. An app that keeps the SDK external
    // gets its copy loaded through `require` into this realm instead, where the
    // sandbox global is invisible — so the same instance is published here too.
    // The CLI process runs exactly one app, so there is nothing to collide with.
    const host = globalThis as Record<string, unknown>;
    host.energyAppSdkInstance = mock.instance;
    host.connectEmsApi = mock.instance;

    runBundle(entryPath, sandbox);

    // The host tells the app who it is before anything else happens; a guides
    // handler is usually registered from inside this callback.
    for (const callback of mock.state.registerCallbacks) {
        await callback(
            mock.options.packageName,
            mock.options.packageVersion,
            mock.options.channel,
            mock.options.deviceId,
            mock.options.environment
        );
    }

    const loaded: LoadedApp = {
        packageName,
        cwd,
        entryPath,
        files,
        mock,
        guides: [],
        answer: 'no-handler',
        validation: {result: {ok: true, errors: [], warnings: []}, guides: []},
        logs,
        reload: async () => {
            await pullGuides(loaded, timeoutMs);
        },
    };

    await pullGuides(loaded, timeoutMs);
    return loaded;
};

/**
 * Ask the app for its complete guide set and validate the answer with the SDK's
 * own validators — the same ones the host runs before it will show a guide.
 */
const pullGuides = async (app: LoadedApp, timeoutMs: number): Promise<void> => {
    const handler = app.mock.state.guidesHandler;
    if (!handler) {
        app.answer = 'no-handler';
        app.guides = [];
        app.validation = {result: {ok: true, errors: [], warnings: []}, guides: []};
        return;
    }

    const requestId = randomUUID();
    let answer: EnyoOnboardingV2GuidesResult | null | 'timeout';
    try {
        answer = await withTimeout(
            handler({
                requestId,
                origin: EnyoOnboardingV2GuidesOriginEnum.OnboardingStart,
                timeoutMs,
            }),
            timeoutMs
        );
    } catch {
        // A rejection is the host's `null`: keep nothing, blame nothing.
        app.answer = 'rejected';
        app.guides = [];
        return;
    }

    if (answer === 'timeout') {
        app.answer = 'timeout';
        app.guides = [];
        return;
    }
    if (answer === null) {
        app.answer = 'null';
        app.guides = [];
        return;
    }

    const context = {files: app.files};
    app.guides = answer.guides ?? [];
    app.answer = app.guides.length === 0 ? 'empty' : 'guides';
    app.detail = answer.detail;
    app.validation = {
        result: validateOnboardingV2GuidesResult(answer, context),
        guides: app.guides.map((guide, index) => {
            const validation = validateOnboardingGuideV2(guide, context);
            return {
                guideName: guide.name ?? `guide-${index + 1}`,
                ok: validation.ok,
                errors: validation.errors,
                warnings: validation.warnings,
            };
        }),
    };

    if (answer.requestId !== requestId) {
        app.validation.result = {
            ...app.validation.result,
            ok: false,
            errors: [
                ...app.validation.result.errors,
                `The answer's requestId (${answer.requestId}) does not match the request (${requestId}).`,
            ],
        };
    }
};

/** `pathToFileURL` is re-exported for the UI, which links to the loaded bundle. */
export const entryUrl = (entryPath: string): string => pathToFileURL(entryPath).href;
