#!/usr/bin/env node
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
import type {CommandOptions, CoreUpdateOptions, SecretCommandOptions, SubscribeEebusOptions, SubscribeLogsOptions} from './types';
import {DEFAULT_DEVICE_PORT, DEFAULT_REGISTRY_URL} from "./constants/defaults.js";
import {secretCommand} from './commands/secret.js';

program.version('0.0.3', '-v, --version', 'output the current version');

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

program.command('release')
    .description('Create a new release for your Energy app and upload to the enyo store.')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--registry <registry>', 'enyo Package Registry URL', DEFAULT_REGISTRY_URL)
    .option('-f, --file <file>', 'Specific config file to release (if not set, searches for all *.package.ts files)')
    .option('--channel <channel>', 'Package channel (production or staging)', 'production')
    .option('--release-notes <file>', 'Path to a JSON file with release notes, e.g. {"de":"…","en":"…"} (skips the interactive prompt)')
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