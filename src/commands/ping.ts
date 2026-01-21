import { WebSocketCommand, type WebSocketCommandOptions } from '../utils/websocket-command.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { CommandOptions } from '../types';

interface PingResponse {
    type: 'pong';
}

export const pingCommand = async (options: CommandOptions): Promise<void> => {
    try {
        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`🏓 Pinging device at ${deviceHost}:${devicePort}...`);

        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: options.token
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const response = await wsCommand.execute<PingResponse>({
            command: 'ping'
        });

        if (response.type === 'pong') {
            console.log('✅ Ping successful - device is responding');
        } else {
            throw new CLIError('Unexpected response from device');
        }

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'pinging device');
    }
};