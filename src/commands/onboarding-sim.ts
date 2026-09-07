import {execSync} from 'child_process';
import path from 'path';
import type {Server} from 'http';
import {EnyoOnboardingV2StartVariant} from '@enyo-energy/energy-app-sdk';
import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {readAndValidatePackageConfig, selectPackageConfig} from '../utils/file-utils.js';
import {CLIError, validatePort} from '../utils/error-handler.js';
import {loadEnergyApp, type LoadedApp} from '../onboarding-sim/app-loader.js';
import {createSimulatorServer, SimulatorLog} from '../onboarding-sim/server.js';
import {START_VARIANTS} from '../onboarding-sim/run-store.js';
import type {OnboardingSimOptions} from '../types';

const DEFAULT_PORT = 4600;

/** The app the simulator is about to boot: where it lives, and what it declares. */
export interface ResolvedApp {
    /**
     * The package root. Everything else — the bundle, the declared public
     * files — is resolved against it.
     */
    root: string;
    config?: EnergyAppPackageDefinition;
}

/**
 * Find the app, from a `--file` config or from the current directory.
 *
 * A config is optional: the simulator only needs a built bundle. What it adds is
 * the app's name and its declared public files, which is what lets image blocks
 * render and the SDK's validators check a guide's file references.
 *
 * When `--file` names a config, its **directory** becomes the package root
 * rather than wherever the command was run from. A config in another project is
 * the whole point of passing the flag, and resolving `dist/index.js` against the
 * current directory instead would load whatever bundle happens to sit there —
 * the CLI's own, if you are standing in the CLI repo.
 */
export const resolveApp = async (file?: string): Promise<ResolvedApp> => {
    let configPath: string;
    try {
        configPath = await selectPackageConfig(file);
    } catch (error) {
        if (file) {
            throw error;
        }
        console.log('ℹ️  No package config found — running with the bundle alone.');
        return {root: process.cwd()};
    }

    return {
        root: path.dirname(configPath),
        config: (await readAndValidatePackageConfig(configPath)) ?? undefined,
    };
};

/** What the app answered when asked for its guides, in one line. */
const describeAnswer = (app: LoadedApp): string => {
    switch (app.answer) {
        case 'guides':
            return `✅ ${app.guides.length} guide(s)`;
        case 'empty':
            return '⚠️  an EMPTY array — on a device that retires every guide the host cached. Return null for "not answering right now".';
        case 'null':
            return 'ℹ️  null — the host would keep the guides it already cached.';
        case 'timeout':
            return '⚠️  nothing in time — the host would keep its cached guides.';
        case 'rejected':
            return '⚠️  a rejection, which the host treats as null.';
        default:
            return '⚠️  no guides handler is registered, so this app ships no v2 onboarding.';
    }
};

const printSummary = (app: LoadedApp): void => {
    console.log(`📦 ${app.packageName} — loaded ${path.relative(app.cwd, app.entryPath)}`);
    console.log(`📖 Guides: ${describeAnswer(app)}`);

    for (const variant of START_VARIANTS) {
        const guides = app.guides.filter(guide => guide.startVariant === variant);
        const label = guides.length === 0 ? '—' : guides.map(guide => guide.name ?? '(unnamed)').join(', ');
        console.log(`   ${variant.padEnd(20)} ${label}`);
    }

    // The whole-answer validator already reports each guide's own complaints,
    // prefixed with the guide it belongs to, so printing the per-guide results
    // again would say everything twice. The UI shows those on the guide card.
    const {errors, warnings} = app.validation.result;
    for (const error of errors) {
        console.log(`❌ ${error}`);
    }
    for (const warning of warnings) {
        console.log(`⚠️  ${warning}`);
    }

    if (app.answer === 'guides' && errors.length === 0) {
        const missing = START_VARIANTS.filter(
            variant => !app.guides.some(guide => guide.startVariant === variant)
        );
        if (missing.length > 0 && missing.length < START_VARIANTS.length) {
            console.log(`ℹ️  No guide for: ${missing.join(', ')}`);
        }
    }
};

export const onboardingSimCommand = async (options: OnboardingSimOptions): Promise<void> => {
    const port = validatePort(options.port ?? `${DEFAULT_PORT}`, 'simulator port');
    const {root: cwd, config} = await resolveApp(options.file);

    if (options.build) {
        console.log('🔨 Building the app (npx rsbuild build)...');
        execSync('npx rsbuild build', {stdio: 'inherit', cwd});
    }

    const log = new SimulatorLog();
    const load = (): Promise<LoadedApp> =>
        loadEnergyApp({
            cwd,
            entry: options.entry,
            config,
            allowNetwork: Boolean(options.allowNetwork),
            onCall: call =>
                log.push({
                    at: call.at,
                    kind: 'sdk',
                    message: `${call.method}(${call.args.map(arg => JSON.stringify(arg)).join(', ')})`,
                    detail: call.result,
                }),
            onLog: line => log.push({at: line.at, kind: 'app', level: line.level, message: line.message}),
        });

    const app = await load();
    printSummary(app);

    if (options.print) {
        console.log(JSON.stringify(app.guides, null, 2));
        return;
    }

    if (app.guides.length === 0) {
        // Still worth serving: the UI names which variants have nothing and why
        // the answer was empty, which is the thing being debugged.
        console.log('ℹ️  There is nothing to walk yet — the simulator will show why.');
    }

    const server = createSimulatorServer({app, log, reload: load});
    const listener: Server = server.listen(port, () => {
        console.log(`🌐 Onboarding v2 simulator on http://localhost:${port}`);
        console.log('   Every SDK call answers empty — no device, no network, no storage.');
        console.log('   Press Ctrl+C to stop.');
    });

    listener.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            throw new CLIError(`Port ${port} is already in use. Pass --port <port> to pick another one.`);
        }
        throw error;
    });

    await new Promise<void>(resolve => {
        const stop = () => {
            listener.close(() => resolve());
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    });
};

/** Exported for the tests, which assert the variant list stays complete. */
export const ALL_START_VARIANTS: EnyoOnboardingV2StartVariant[] = START_VARIANTS;
