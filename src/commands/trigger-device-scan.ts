import { WebSocketCommand, type WebSocketCommandOptions } from '../utils/websocket-command.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { CommandOptions } from '../types';

interface DeviceScanResponse {
    type: 'device-scan-response';
    status: 'success' | 'error';
    message: string;
    data?: {
        devicesFound: number;
        devices: Array<{
            id: string;
            ipAddress: string;
            hostname: string;
        }>;
    };
}

export const triggerDeviceScanCommand = async (options: CommandOptions): Promise<void> => {
    try {
        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`🔍 Triggering device scan on ${deviceHost}:${devicePort}...`);

        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: options.token
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const response = await wsCommand.execute<DeviceScanResponse>({
            command: 'trigger-device-scan'
        });

        if (response.status === 'error') {
            throw new CLIError(response.message || 'Device scan failed');
        }

        if (response.type === 'device-scan-response' && response.data) {
            console.log(`✅ ${response.message}`);
            console.log(`\n🎯 Devices Found: ${response.data.devicesFound}`);

            if (response.data.devices.length === 0) {
                console.log('   No network devices detected');
            } else {
                console.log('\n📱 Discovered Devices:');
                response.data.devices.forEach((device, index) => {
                    console.log(`   ${index + 1}. ${device.hostname} (${device.id})`);
                    console.log(`      IP: ${device.ipAddress}`);
                });
            }
        } else {
            throw new CLIError('Unexpected response format from device scan');
        }

    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'triggering device scan');
    }
};