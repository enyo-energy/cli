import { WebSocketCommand, type WebSocketCommandOptions, type CommandResponse } from '../utils/websocket-command.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { CommandOptions } from '../types';

interface SubscribeLogsOptions extends CommandOptions {
    packageName?: string;
}

interface LogMessage {
    type: 'log';
    timestamp: string;
    level: string;
    message: string;
}

export const subscribeLogsCommand = async (options: SubscribeLogsOptions): Promise<void> => {
    try {
        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`👂 Subscribing to logs from device at ${deviceHost}:${devicePort}...`);
        if (options.packageName) {
            console.log(`📦 Filtering logs for package: ${options.packageName}`);
        }

        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: options.token,
            packageName: options.packageName
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const handleMessage = (response: CommandResponse): void => {
            if (response.type === 'log') {
                const logMessage = response as LogMessage;
                const timestamp = new Date(logMessage.timestamp).toLocaleTimeString();
                const levelIcon = getLevelIcon(logMessage.level);
                const packageInfo = options.packageName ? ` [${options.packageName}]` : '';
                console.log(`[${timestamp}] ${levelIcon}${packageInfo} ${logMessage.message}`);
            } else if (response.status === 'success' && response.message) {
                console.log(`✅ ${response.message}`);
            } else if (response.status === 'error' && response.message) {
                console.error(`❌ ${response.message}`);
            }
        };

        const handleError = (error: Error): void => {
            console.error(`❌ Log subscription error: ${error.message}`);
        };

        await wsCommand.executeWithSubscription(
            { command: 'subscribe-logs' },
            handleMessage,
            handleError
        );

        console.log('👂 Listening for log messages... (Press Ctrl+C to stop)');

        // Handle graceful shutdown
        const cleanup = () => {
            console.log('\n👋 Disconnecting from log stream...');
            wsCommand.disconnect();
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'subscribing to logs');
    }
};

function getLevelIcon(level: string): string {
    switch (level.toLowerCase()) {
        case 'error': return '❌';
        case 'warn':
        case 'warning': return '⚠️';
        case 'info': return 'ℹ️';
        case 'debug': return '🐛';
        default: return '📝';
    }
}