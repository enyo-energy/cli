import { WebSocketCommand, type WebSocketCommandOptions, type CommandResponse } from '../utils/websocket-command.js';
import { validatePort, CLIError, handleError } from '../utils/error-handler.js';
import { DEFAULT_DEVICE_HOST, DEFAULT_DEVICE_PORT } from '../constants/defaults.js';
import type { SubscribeEebusOptions } from '../types';

type SpineCmdClassifier =
    | 'read' | 'reply' | 'write' | 'notify'
    | 'subscribe' | 'unsubscribe' | 'delete' | 'result' | 'call';

interface SpineAddress {
    device?: string;
    entity?: number[];
    feature?: number;
}

/**
 * Wire shape mirrored verbatim from
 * `device-core-app/src/domain/cli/cli.types.ts:EebusMessagePayload`.
 * Kept in sync by hand, same pattern as `LogMessage` in subscribe-logs.ts.
 */
interface EebusMessagePayload {
    direction: 'inbound' | 'outbound';
    timestampIso: string;
    ski: string;
    msgCounter?: number;
    msgCounterReference?: number;
    cmdClassifier?: SpineCmdClassifier;
    addressSource?: SpineAddress;
    addressDestination?: SpineAddress;
    cmdKeys: string[];
}

interface EebusEnvelope extends CommandResponse {
    type: 'eebus-message';
    data: EebusMessagePayload;
}

export const subscribeEebusCommand = async (options: SubscribeEebusOptions): Promise<void> => {
    try {
        if (!options.token) {
            throw new CLIError('Debug token is required. Use --token <token> to provide it.');
        }

        const deviceHost = options.host || DEFAULT_DEVICE_HOST;
        const devicePort = validatePort(options.port || DEFAULT_DEVICE_PORT.toString(), 'device port');

        console.log(`📡 Streaming EEBUS messages from ${deviceHost}:${devicePort}...`);
        if (options.json) {
            console.log('🧾 Emitting raw JSON per message (--json)');
        }

        const wsOptions: WebSocketCommandOptions = {
            host: deviceHost,
            port: devicePort,
            token: options.token,
        };

        const wsCommand = new WebSocketCommand(wsOptions);

        const handleMessage = (response: CommandResponse): void => {
            if (response.type === 'eebus-message' && response.data) {
                const payload = (response as EebusEnvelope).data;
                if (options.json) {
                    console.log(JSON.stringify(payload));
                } else {
                    console.log(formatEebusRow(payload, options.fullSki ?? false));
                }
            } else if (response.status === 'success' && response.message) {
                console.log(`✅ ${response.message}`);
            } else if (response.status === 'error' && response.message) {
                console.error(`❌ ${response.message}`);
            }
        };

        const handleSocketError = (error: Error): void => {
            console.error(`❌ EEBUS subscription error: ${error.message}`);
        };

        await wsCommand.executeWithSubscription(
            { command: 'subscribe-eebus' },
            handleMessage,
            handleSocketError,
        );

        console.log('📡 Listening for EEBUS messages... (Press Ctrl+C to stop)');

        const cleanup = () => {
            console.log('\n👋 Disconnecting from EEBUS stream...');
            wsCommand.disconnect();
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'subscribing to EEBUS messages');
    }
};

function formatEebusRow(p: EebusMessagePayload, fullSki: boolean): string {
    const time = new Date(p.timestampIso).toLocaleTimeString();
    const arrow = p.direction === 'inbound' ? '←' : '→';
    const ski = fullSki ? p.ski : abbreviateSki(p.ski);
    const classifier = (p.cmdClassifier ?? '-').padEnd(7);
    const src = formatAddress(p.addressSource);
    const dst = formatAddress(p.addressDestination);
    const counter = p.msgCounter !== undefined ? `msgCnt=${p.msgCounter}` : '';
    const ref = p.msgCounterReference !== undefined ? `ref=${p.msgCounterReference}` : '';
    const keys = p.cmdKeys.length > 0 ? `[${p.cmdKeys.join(',')}]` : '[]';
    const parts = [`[${time}]`, arrow, ski, classifier, `src=${src}→dst=${dst}`, counter, ref, keys]
        .filter(Boolean);
    return parts.join('  ');
}

function abbreviateSki(ski: string): string {
    if (!ski) return '?';
    const clean = ski.replace(/[^a-fA-F0-9]/g, '');
    if (clean.length <= 4) return clean;
    return `SKI…${clean.slice(-4)}`;
}

function formatAddress(a?: SpineAddress): string {
    if (!a) return '-';
    const entity = a.entity ? a.entity.join('.') : '-';
    const feature = a.feature !== undefined ? `:${a.feature}` : '';
    return `${entity}${feature}`;
}
