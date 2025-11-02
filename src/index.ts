#!/usr/bin/env node
import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { installCommand } from './commands/install.js';
import { releaseCommand } from './commands/release.js';
import { mockDeviceCommand, type MockDeviceOptions } from './commands/mock-device.js';
import { launchSimulationCommand, type LaunchSimulationOptions } from './commands/launch-simulation.js';
import { handleError, CLIError } from './utils/error-handler.js';
import type { CommandOptions } from './types/index.js';

program.version('0.0.1', '-v, --version', 'output the current version');

program.command('init')
    .description('Create a new Connect EMS Package')
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
    .description('Build and install the package on a local Connect EMS device for development')
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', '6021')
    .requiredOption('--token <token>', 'Debug token from the Connect EMS device')
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
    .description('Create a new release for your Connect EMS app and upload to the connect EMS store.')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--registry <registry>', 'Connect EMS Package Registry URL', 'https://api.connect-ems.com')
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
    .requiredOption('--token <token>', 'Debug token from the Connect EMS device')
    .option('--ip-address <ipAddress>', 'IP address for the mock device')
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', '6021')
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

program.parse(process.argv);