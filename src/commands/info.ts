import { WebSocketCommand, type WebSocketCommandOptions } from '../utils/websocket-command.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { CommandOptions } from '../types';

interface InfoResponse {
    type: 'info-response';
    status: 'success' | 'error';
    data?: {
        deviceId: string;
        debugModeEnabled: boolean;
        connectedPackages: Array<{
            name: string;
            status: string;
        }>;
        uptime: string;
        version: string;
    };
    message?: string;
}

export const infoCommand = async (options: CommandOptions): Promise<void> => {
    try {
        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`ℹ️  Getting device information from ${deviceHost}:${devicePort}...`);

        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: options.token
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const response = await wsCommand.execute<InfoResponse>({
            command: 'info'
        });

        if (response.status === 'error') {
            throw new CLIError(response.message || 'Failed to get device information');
        }

        if (response.type === 'info-response' && response.data) {
            const { data } = response;

            console.log('\n📱 Device Information:');
            console.log(`   ID: ${data.deviceId}`);
            console.log(`   Version: ${data.version}`);
            console.log(`   Debug Mode: ${data.debugModeEnabled ? '✅ Enabled' : '❌ Disabled'}`);
            console.log(`   Uptime: ${formatUptime(data.uptime)}`);

            console.log('\n📦 Connected Packages:');
            if (data.connectedPackages.length === 0) {
                console.log('   No packages currently connected');
            } else {
                data.connectedPackages.forEach(pkg => {
                    const statusIcon = pkg.status.toLowerCase() === 'running' ? '🟢' : '🔴';
                    console.log(`   ${statusIcon} ${pkg.name} (${pkg.status})`);
                });
            }
        } else {
            throw new CLIError('Unexpected response format from device');
        }

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'getting device information');
    }
};

function formatUptime(uptime: string): string {
    const uptimeSeconds = parseInt(uptime, 10);

    if (isNaN(uptimeSeconds)) {
        return uptime;
    }

    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}