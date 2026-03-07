import fs from 'fs';
import path from 'path';
import { WebSocketCommand, type WebSocketCommandOptions } from '../utils/websocket-command.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { CoreUpdateOptions, CoreUpdateResponse } from '../types';

export const coreUpdateCommand = async (options: CoreUpdateOptions): Promise<void> => {
    try {
        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        if (!options.file) {
            throw new CLIError('Bundle file is required. Use --file <file> to provide it.');
        }

        if (!options.bundleVersion) {
            throw new CLIError('Version is required. Use --version <version> to provide it.');
        }

        const filePath = path.resolve(options.file);
        if (!fs.existsSync(filePath)) {
            throw new CLIError(`Bundle file not found: ${filePath}`);
        }

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`📦 Sending core update v${options.bundleVersion} to ${deviceHost}:${devicePort}...`);

        const bundleBuffer = fs.readFileSync(filePath);
        const bundleBase64 = bundleBuffer.toString('base64');

        console.log(`   Bundle size: ${(bundleBuffer.length / 1024).toFixed(1)} KB`);

        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: options.token
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const response = await wsCommand.execute<CoreUpdateResponse>({
            command: 'core-update',
            payload: {
                versionNumber: options.bundleVersion,
                bundle: bundleBase64
            }
        });

        if (response.type === 'core-update-response' && response.status === 'success') {
            console.log(`✅ Core update successful: ${response.message}`);
        } else {
            throw new CLIError(`Core update failed: ${response.message}`);
        }

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'sending core update');
    }
};
