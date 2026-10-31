#!/usr/bin/env node
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {program} from 'commander';
import {initCommand} from './commands/init.js';
import {installCommand} from './commands/install.js';
import {releaseCommand} from './commands/release.js';
import {pingCommand} from './commands/ping.js';
import {subscribeLogsCommand} from './commands/subscribe-logs.js';
import {subscribeEebusCommand} from './commands/subscribe-eebus.js';
import {infoCommand} from './commands/info.js';
import {triggerDeviceScanCommand} from './commands/trigger-device-scan.js';
import {CLIError, handleError} from './utils/error-handler.js';
import {coreUpdateCommand} from './commands/core-update.js';
import type {CommandOptions, CoreUpdateOptions, OnboardingSimOptions, SecretCommandOptions, SimulatorCommandOptions, SubscribeEebusOptions, SubscribeLogsOptions} from './types';
import {DEFAULT_DEVICE_PORT, DEFAULT_REGISTRY_URL, DEFAULT_SIMULATION_RUNTIME_URL} from "./constants/defaults.js";
import {secretCommand} from './commands/secret.js';
import {onboardingSimCommand} from './commands/onboarding-sim.js';
import {simulatorDeleteCommand, simulatorListCommand, simulatorPullCommand, simulatorPushCommand} from './commands/simulator.js';

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = [
    path.join(cliDir, '../package.json'),
    path.join(cliDir, '../../package.json'),
].find(candidate => existsSync(candidate));
const version = packageJsonPath
    ? (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {version: string}).version
    : 'unknown';

program.version(version, '-v, --version', 'output the current version');

program.command('init')
    .description('Create a new enyo Package')
    .action(() => {
        try {
            initCommand();
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'during package initialization');
        }
    });

program.command('install')
    .description('Build and install the package on a local enyo device for development')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .option('-f, --file <file>', 'Specific config file to install (if not set, searches for *.package.ts files)')
    .action(async (options: CommandOptions) => {
        try {
            await installCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'installing package');
        }
    });

program.command('onboarding-sim')
    .description('Run the app against a mock SDK and walk its onboarding v2 guides in the browser')
    .option('--port <port>', 'Port for the simulator UI', '4600')
    .option('-f, --file <file>', 'Specific config file to read (if not set, searches for *.package.ts files)')
    .option('--entry <file>', 'Bundle entry point (defaults to dist/index.js)')
    .option('--build', 'Run "npx rsbuild build" before loading the app')
    .option('--allow-network', 'Let the app use the real network instead of blocking useFetch()')
    .option('--print', 'Print the guides the app returned and exit')
    .action(async (options: OnboardingSimOptions) => {
        try {
            await onboardingSimCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'running the onboarding simulator');
        }
    });

program.command('release')
    .description('Create a new release for your Energy app and upload to the enyo store.')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--registry <registry>', 'enyo Package Registry URL', DEFAULT_REGISTRY_URL)
    .option('-f, --file <file>', 'Specific config file to release (if not set, searches for all *.package.ts files)')
    .option('--channel <channel>', 'Package channel (production or staging)', 'production')
    .option('--release-notes <file>', 'Path to a JSON file with release notes, e.g. {"de":"…","en":"…"} (skips the interactive prompt)')
    .option('--force', 'Publish even when nothing changed since the last release on this channel')
    .action(async (options: CommandOptions) => {
        try {
            await releaseCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'creating release');
        }
    });

program.command('ping')
    .description('Test connection to the enyo device')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .action(async (options: CommandOptions) => {
        try {
            await pingCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'pinging device');
        }
    });

program.command('subscribe-logs')
    .description('Subscribe to log messages from the enyo device')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .option('--package-name <packageName>', 'Filter logs for specific package')
    .action(async (options: SubscribeLogsOptions) => {
        try {
            await subscribeLogsCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'subscribing to logs');
        }
    });

program.command('subscribe-eebus')
    .description('Stream EEBUS / SPINE messages from the enyo device')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .option('--json', 'Emit raw JSON per message (table-renderer friendly)')
    .option('--full-ski', 'Print full SKI instead of abbreviated form')
    .action(async (options: SubscribeEebusOptions) => {
        try {
            await subscribeEebusCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'subscribing to EEBUS messages');
        }
    });

program.command('info')
    .description('Get device information and connected packages')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .action(async (options: CommandOptions) => {
        try {
            await infoCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'getting device information');
        }
    });

program.command('trigger-device-scan')
    .description('Trigger a scan for network devices')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .action(async (options: CommandOptions) => {
        try {
            await triggerDeviceScanCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'triggering device scan');
        }
    });

program.command('secret')
    .description('Save encrypted secrets to Enyo API')
    .requiredOption('--name <name>', 'Name of the secret')
    .requiredOption('--api-key <apiKey>', 'Developer Org API key')
    .requiredOption('--secret <secret>', 'Secret used for encryption')
    .option('--value <value>', 'Value of the secret (will be encrypted)')
    .option('--file <file>', 'Path to JSON file to use as secret value')
    .option('--registry <registry>', 'API Registry', DEFAULT_REGISTRY_URL)
    .option('--channel <channel>', 'Package channel (production or staging)', 'production')
    .action(async (options: SecretCommandOptions) => {
        try {
            await secretCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'managing secrets');
        }
    });

const simulator = program.command('simulator')
    .description('Manage your developer org\'s device simulators in the enyo simulation runtime');

const runSimulatorCommand = async (action: () => Promise<void>, context: string): Promise<void> => {
    try {
        await action();
    } catch (error) {
        if (error instanceof CLIError) {
            console.error(`❌ ${error.message}`);
            process.exit(error.exitCode);
        }
        handleError(error, context);
    }
};

simulator.command('push')
    .description('Create or replace device simulators from *.simulator.ts / *.simulator.json manifests')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--simulation-runtime <url>', 'enyo Simulation Runtime URL', DEFAULT_SIMULATION_RUNTIME_URL)
    .option('--developer-org-id <developerOrgId>', 'Refuse to act unless the API key belongs to this developer org')
    .option('-f, --file <file>', 'Specific manifest to push (if not set, pushes every *.simulator.ts / *.simulator.json)')
    .action((options: SimulatorCommandOptions) =>
        runSimulatorCommand(() => simulatorPushCommand(options), 'pushing device simulators'));

simulator.command('list')
    .description('List your developer org\'s device simulators')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--simulation-runtime <url>', 'enyo Simulation Runtime URL', DEFAULT_SIMULATION_RUNTIME_URL)
    .option('--developer-org-id <developerOrgId>', 'Refuse to act unless the API key belongs to this developer org')
    .action((options: SimulatorCommandOptions) =>
        runSimulatorCommand(() => simulatorListCommand(options), 'listing device simulators'));

simulator.command('pull <name>')
    .description('Download the stored script of a device simulator')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--simulation-runtime <url>', 'enyo Simulation Runtime URL', DEFAULT_SIMULATION_RUNTIME_URL)
    .option('--developer-org-id <developerOrgId>', 'Refuse to act unless the API key belongs to this developer org')
    .option('--out <file>', 'Where to write the script (defaults to its stored file name)')
    .option('--force', 'Overwrite an existing file')
    .action((name: string, options: SimulatorCommandOptions & {out?: string}) =>
        runSimulatorCommand(() => simulatorPullCommand(name, options), 'pulling a device simulator'));

simulator.command('delete <name>')
    .description('Delete a device simulator of your developer org')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--simulation-runtime <url>', 'enyo Simulation Runtime URL', DEFAULT_SIMULATION_RUNTIME_URL)
    .option('--developer-org-id <developerOrgId>', 'Refuse to act unless the API key belongs to this developer org')
    .action((name: string, options: SimulatorCommandOptions) =>
        runSimulatorCommand(() => simulatorDeleteCommand(name, options), 'deleting a device simulator'));

program.command('core-update')
    .description('Send a core update bundle to the enyo device')
    .requiredOption('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .requiredOption('-f, --file <file>', 'Path to the core update bundle file')
    .requiredOption('--bundle-version <bundleVersion>', 'Version string for the update')
    .action(async (options: CoreUpdateOptions) => {
        try {
            await coreUpdateCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'sending core update');
        }
    });

program.parse(process.argv);