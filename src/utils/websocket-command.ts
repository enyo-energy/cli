import WebSocket from 'ws';

export interface WebSocketCommandOptions {
    host: string;
    port: number;
    token: string;
    packageName?: string;
}

export interface CommandMessage {
    command: string;
    payload?: any;
}

export interface CommandResponse {
    type: string;
    status?: 'success' | 'error';
    message?: string;
    data?: any;
    timestamp?: string;
    level?: string;
}

export class WebSocketCommand {
    private ws: WebSocket | null = null;

    constructor(private options: WebSocketCommandOptions) {}

    async execute<T = CommandResponse>(command: CommandMessage): Promise<T> {
        return new Promise((resolve, reject) => {
            const wsUrl = `wss://${this.options.host}:${this.options.port}/cli`;

            const headers: Record<string, string> = {
                'Authorization': `Bearer ${this.options.token}`
            };

            if (this.options.packageName) {
                headers['package-name'] = this.options.packageName;
            }

            this.ws = new WebSocket(wsUrl, {
                rejectUnauthorized: false,
                headers
            });

            this.ws.on('open', () => {
                this.ws?.send(JSON.stringify(command));
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString()) as T;
                    this.ws?.close();
                    resolve(response);
                } catch (error) {
                    this.ws?.close();
                    reject(new Error(`Failed to parse WebSocket response: ${error}`));
                }
            });

            this.ws.on('error', (error) => {
                this.ws?.close();
                reject(new Error(`WebSocket error: ${error}`));
            });

            this.ws.on('close', (code, reason) => {
                if (code !== 1000) {
                    reject(new Error(`WebSocket closed with code ${code}: ${reason}`));
                }
            });
        });
    }

    async executeWithSubscription(
        command: CommandMessage,
        onMessage: (message: CommandResponse) => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = `wss://${this.options.host}:${this.options.port}/cli`;

            const headers: Record<string, string> = {
                'Authorization': `Bearer ${this.options.token}`
            };

            if (this.options.packageName) {
                headers['package-name'] = this.options.packageName;
            }

            this.ws = new WebSocket(wsUrl, {
                rejectUnauthorized: false,
                headers
            });

            this.ws.on('open', () => {
                this.ws?.send(JSON.stringify(command));
                resolve();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString()) as CommandResponse;
                    onMessage(response);
                } catch (error) {
                    const err = new Error(`Failed to parse WebSocket response: ${error}`);
                    if (onError) {
                        onError(err);
                    } else {
                        console.error(err.message);
                    }
                }
            });

            this.ws.on('error', (error) => {
                const err = new Error(`WebSocket error: ${error}`);
                if (onError) {
                    onError(err);
                } else {
                    reject(err);
                }
            });

            this.ws.on('close', (code, reason) => {
                if (code !== 1000) {
                    const err = new Error(`WebSocket closed with code ${code}: ${reason}`);
                    if (onError) {
                        onError(err);
                    }
                }
            });
        });
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}