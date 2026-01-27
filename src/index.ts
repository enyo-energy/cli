#!/usr/bin/env node
import {program} from 'commander';
import {initCommand} from './commands/init.js';
import {installCommand} from './commands/install.js';
import {releaseCommand} from './commands/release.js';
import {mockDeviceCommand, type MockDeviceOptions} from './commands/mock-device.js';
import {launchSimulationCommand, type LaunchSimulationOptions} from './commands/launch-simulation.js';
import {pingCommand} from './commands/ping.js';
import {subscribeLogsCommand} from './commands/subscribe-logs.js';
import {infoCommand} from './commands/info.js';
import {triggerDeviceScanCommand} from './commands/trigger-device-scan.js';
import {CLIError, handleError} from './utils/error-handler.js';
import type {CommandOptions, SecretCommandOptions, SubscribeLogsOptions} from './types';
import {DEFAULT_DEVICE_PORT} from "./constants/defaults.js";
import {secretCommand} from './commands/secret.js';

program.version('0.0.1', '-v, --version', 'output the current version');

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
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
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
    .option('--registry <registry>', 'enyo Package Registry URL', 'https://api.hems1.de')
    .option('-f, --file <file>', 'Specific config file to release (if not set, searches for all *.package.ts files)')
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

program.command('mock-device')
    .description('Create a mock network device for testing')
    .requiredOption('--ports <ports>', 'Comma-separated list of port numbers (e.g., "80,443,8080")')
    .requiredOption('--token <token>', 'Debug token from the enyo device')
    .option('--ip-address <ipAddress>', 'IP address for the mock device')
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', `${DEFAULT_DEVICE_PORT}`)
    .action(async (options: MockDeviceOptions) => {
        try {
            await mockDeviceCommand(options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'creating mock device');
        }
    });

program.command('launch-simulation')
    .description('Launch a simulation of a device type')
    .argument('<type>', 'Simulation type (e.g., inverter)')
    .option('--port <port>', 'Port number for the simulation', '502')
    .action(async (type: string, options: LaunchSimulationOptions) => {
        try {
            await launchSimulationCommand(type, options);
        } catch (error) {
            if (error instanceof CLIError) {
                console.error(`❌ ${error.message}`);
                process.exit(error.exitCode);
            }
            handleError(error, 'launching simulation');
        }
    });

program.command('ping')
    .description('Test connection to the enyo device')
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
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
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
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

program.command('info')
    .description('Get device information and connected packages')
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
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
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
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
    .option('--value <value>', 'Value of the secret (will be encrypted)')
    .option('--file <file>', 'Path to JSON file to use as secret value')
    .requiredOption('--token <token>', 'Developer Org Access Token')
    .requiredOption('--master-secret <masterSecret>', 'Master secret used for encryption')
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

program.parse(process.argv);