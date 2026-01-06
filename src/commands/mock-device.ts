import WebSocket from 'ws';
import type {CommandOptions} from '../types';
import {readEnyoPackageConfig} from "../utils/file-utils.js";
import {DEFAULT_DEVICE_PORT, FILE_NAMES} from "../constants/defaults.js";
import {validatePort} from "../utils/error-handler.js";

interface MockNetworkDeviceMessage {
    type: 'mock-network-device';
    payload: {
        ports: number[];
        ipAddress?: string;
    };
}

interface MockNetworkDeviceResponse {
    type: 'mock-network-device-response';
    status: 'success' | 'error';
    deviceId?: string;
    message: string;
}

export interface MockDeviceOptions extends CommandOptions {
    ports: string;
    ipAddress?: string;
}

export async function mockDeviceCommand(options: MockDeviceOptions): Promise<void> {
    const {ports, ipAddress, host, port, token} = options;
    const config = await readEnyoPackageConfig(FILE_NAMES.PACKAGE_CONFIG);

    const parsedPorts = ports.split(',').map(port => {
        const num = parseInt(port.trim(), 10);
        if (isNaN(num) || num < 1 || num > 65535) {
            throw new Error(`Invalid port number: ${port}`);
        }
        return num;
    });

    console.log(`🔌 Creating mock network device with ${parsedPorts.length} ports on IP ${ipAddress}...`);

    const websocketPort = validatePort(port || DEFAULT_DEVICE_PORT.toString(), 'device port');

    return new Promise((resolve, reject) => {
        const wsUrl = `wss://${host}:${websocketPort}/cli`;
        console.log(`🔌 Connecting to WebSocket at ${wsUrl}...`);

        const ws = new WebSocket(wsUrl, {
            rejectUnauthorized: false,
            headers: {
                'authorization': `Bearer ${token}`,
                'package-name': config.packageName
            }
        });

        ws.on('open', () => {
            console.log('✅ WebSocket connected');

            const message: MockNetworkDeviceMessage = {
                type: 'mock-network-device',
                payload: {
                    ports: parsedPorts,
                    ipAddress
                }
            };

            ws.send(JSON.stringify(message));
        });

        ws.on('message', (data: WebSocket.Data) => {
            try {
                const response = JSON.parse(data.toString()) as MockNetworkDeviceResponse;

                if (response.type === 'mock-network-device-response') {
                    if (response.status === 'success') {
                        console.log(`✅ ${response.message}`);
                        if (response.deviceId) {
                            console.log(`📱 Device ID: ${response.deviceId}`);
                        }
                        ws.close();
                        resolve();
                    } else {
                        console.error(`❌ ${response.message}`);
                        ws.close();
                        reject(new Error(response.message));
                    }
                }
            } catch (error) {
                console.error('Failed to parse WebSocket response:', error);
                ws.close();
                reject(error);
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        });

        ws.on('close', (code, reason) => {
            if (code !== 1000) {
                console.log(`🔌 WebSocket disconnected unexpectedly (${code}): ${reason}`);
                reject(new Error(`WebSocket closed with code ${code}: ${reason}`));
            }
        });
    });
}