import WebSocket from 'ws';
import type {CommandOptions} from '../types';
import {readEnyoPackageConfig} from "../utils/file-utils.js";
import {DEFAULT_DEVICE_PORT, FILE_NAMES} from "../constants/defaults.js";
import {validatePort} from "../utils/error-handler.js";

interface CliCommandMessage {
    type: 'cli-command';
    command: string;
}

interface CliCommandResponse {
    type: 'cli-command-response';
    status: 'success' | 'error';
    message: string;
    data?: any;
}

export interface CliCommandOptions extends CommandOptions {
    // Using standard CommandOptions which already has host, port, token
}

export async function cliCommand(command: string, options: CliCommandOptions): Promise<void> {
    const {host = 'localhost', port, token} = options;
    const config = await readEnyoPackageConfig(FILE_NAMES.PACKAGE_CONFIG);

    console.log(`📤 Sending command: ${command}`);

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

            const message: CliCommandMessage = {
                type: 'cli-command',
                command: command
            };

            ws.send(JSON.stringify(message));
        });

        ws.on('message', (data: WebSocket.Data) => {
            try {
                const response = JSON.parse(data.toString()) as CliCommandResponse;

                if (response.type === 'cli-command-response') {
                    if (response.status === 'success') {
                        console.log(`✅ ${response.message}`);
                        if (response.data) {
                            console.log(`📊 Response data:`, response.data);
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