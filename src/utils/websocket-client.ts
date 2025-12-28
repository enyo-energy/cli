import WebSocket from 'ws';

interface AuthMessage {
    type: 'authenticate';
    token: string;
    packageName?: string;
}

interface LogMessage {
    type: 'log';
    timestamp: string;
    level: string;
    message: string;
}

type WebSocketMessage = AuthMessage | LogMessage;

export class WebSocketLogger {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectInterval = 5000;

    constructor(
        private host: string,
        private port: number,
        private token: string,
        private packageName: string
    ) {}

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = `wss://${this.host}:${this.port}/cli`;
            console.log(`🔌 Connecting to WebSocket at ${wsUrl}...`);

            this.ws = new WebSocket(wsUrl, {
                rejectUnauthorized: false,
                headers: {
                    'authorization': `Bearer ${this.token}`,
                    'package-name': this.packageName
                }
            });

            this.ws.on('open', () => {
                console.log('✅ WebSocket connected');

                // Send subscribe-logs message after connection
                this.ws?.send(JSON.stringify({ type: 'subscribe-logs' }));

                resolve();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    const message = JSON.parse(data.toString()) as WebSocketMessage;
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`🔌 WebSocket disconnected (${code}): ${reason}`);
                this.handleReconnect();
            });
        });
    }

    private handleMessage(message: WebSocketMessage): void {
        if (message.type === 'log') {
            this.logMessage(message);
        }
    }

    private logMessage(log: LogMessage): void {
        const timestamp = new Date(log.timestamp).toLocaleTimeString();
        const levelIcon = this.getLevelIcon(log.level);
        console.log(`[${timestamp}] ${levelIcon} [${this.packageName}] ${log.message}`);
    }

    private getLevelIcon(level: string): string {
        switch (level.toLowerCase()) {
            case 'error': return '❌';
            case 'warn': case 'warning': return '⚠️';
            case 'info': return 'ℹ️';
            case 'debug': return '🐛';
            default: return '📝';
        }
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Max reconnection attempts reached. Stopping reconnection.');
            return;
        }

        this.reconnectAttempts++;
        console.log(`🔄 Reconnecting in ${this.reconnectInterval / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            this.connect().catch((error) => {
                console.error('Reconnection failed:', error);
            });
        }, this.reconnectInterval);
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.send(JSON.stringify({message: 'terminate'}));
            this.ws.close();
            this.ws = null;
        }
    }

    startListening(): void {
        console.log('👂 Listening for log messages... (Press Ctrl+C to stop)');

        process.on('SIGINT', () => {
            console.log('\n👋 Disconnecting from log stream...');
            this.disconnect();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            this.disconnect();
            process.exit(0);
        });
    }
}