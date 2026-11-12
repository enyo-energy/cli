import fs from 'fs';
import path from 'path';
import {CLIError} from './error-handler.js';
import {readErrorMessage} from './registry-api.js';
import {SseParser} from './sse.js';
import type {PackageLogStreamEvent} from '../types';

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

export const packageLogStreamUrl = (registry: string, deviceSerialNumber: string, packageName: string): string =>
    `${registry}/api/package-registry/devices/${encodeURIComponent(deviceSerialNumber)}` +
    `/packages/${encodeURIComponent(packageName)}/logs`;

/** One `data:` payload of the stream, or `undefined` when it is not an event this CLI knows. */
export const parsePackageLogEvent = (data: string): PackageLogStreamEvent | undefined => {
    try {
        const event = JSON.parse(data) as PackageLogStreamEvent;
        return typeof event?.type === 'string' ? event : undefined;
    } catch {
        return undefined;
    }
};

/** The console line for an event; `undefined` for keep-alives. */
export const formatPackageLogEvent = (event: PackageLogStreamEvent): string | undefined => {
    switch (event.type) {
        case 'log':
            return `[${new Date(event.timestampIso).toLocaleTimeString()}] ${getLevelIcon(event.level)} ${event.message}`;
        case 'dropped':
            return `⚠️ ${event.count} log line(s) dropped — the box produced them faster than it could send them`;
        case 'status':
            return `ℹ️ ${event.message}`;
        case 'error':
            return `❌ ${event.message}`;
        case 'ping':
            return undefined;
    }
};

export const printPackageLogEvent = (event: PackageLogStreamEvent): void => {
    const line = formatPackageLogEvent(event);
    if (line === undefined) {
        return;
    }
    if (event.type === 'error' || (event.type === 'log' && event.level === 'error')) {
        console.error(line);
    } else {
        console.log(line);
    }
};

/** Where a bare `--out` writes. A folder of this name gets a `.gitignore`, so its logs stay out of the repo. */
export const DEFAULT_LOG_DIR = '.enyo-logs';

/**
 * `--out` as commander hands it over: `true` without a value, the typed path
 * otherwise, `undefined` when the flag is absent.
 */
export const resolveLogFilePath = (
    out: boolean | string | undefined,
    deviceSerialNumber: string,
    packageName: string
): string | undefined => {
    if (out === undefined || out === false) {
        return undefined;
    }
    if (out === true) {
        const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '_');
        return path.join(DEFAULT_LOG_DIR, `${safe(deviceSerialNumber)}-${safe(packageName)}.log`);
    }
    return out;
};

/**
 * The file line for an event; `undefined` for keep-alives. Unlike the console
 * it carries the full ISO timestamp and the level as a word, so the file can
 * be grepped and read across days.
 */
export const formatPackageLogFileLine = (event: PackageLogStreamEvent, now: Date = new Date()): string | undefined => {
    switch (event.type) {
        case 'log':
            return `${event.timestampIso} ${event.level.toUpperCase().padEnd(5)} ${event.message}`;
        case 'dropped':
            return `${now.toISOString()} DROPPED ${event.count} log line(s) dropped — the box produced them faster than it could send them`;
        case 'status':
            return `${now.toISOString()} STATUS ${event.message}`;
        case 'error':
            return `${now.toISOString()} STREAM-ERROR ${event.message}`;
        case 'ping':
            return undefined;
    }
};

/**
 * Appends the stream's events to `filePath`, after a line that marks where
 * this session starts. Creates the folder and, for a `.enyo-logs` folder, a
 * `.gitignore` that ignores everything in it.
 */
export const openPackageLogFile = (filePath: string, header: string): ((event: PackageLogStreamEvent) => void) => {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, {recursive: true});
    const gitignore = path.join(dir, '.gitignore');
    if (path.basename(path.resolve(dir)) === DEFAULT_LOG_DIR && !fs.existsSync(gitignore)) {
        fs.writeFileSync(gitignore, '*\n');
    }
    // Written synchronously, so nothing is lost when Ctrl+C exits the process.
    const fd = fs.openSync(filePath, 'a');
    fs.writeSync(fd, `${new Date().toISOString()} STREAM ${header}\n`);
    return (event) => {
        const line = formatPackageLogFileLine(event);
        if (line !== undefined) {
            fs.writeSync(fd, `${line}\n`);
        }
    };
};

/** Prints each event, and also appends it to `logFile` when one is given. */
export const createPackageLogHandler = (
    logFile: string | undefined,
    header: string
): ((event: PackageLogStreamEvent) => void) => {
    if (!logFile) {
        return printPackageLogEvent;
    }
    const write = openPackageLogFile(logFile, header);
    console.log(`📝 Writing logs to ${logFile}`);
    return (event) => {
        printPackageLogEvent(event);
        write(event);
    };
};

const getLevelIcon = (level: string): string => {
    switch (level.toLowerCase()) {
        case 'error': return '❌';
        case 'warn': return '⚠️';
        case 'info': return 'ℹ️';
        case 'debug': return '🐛';
        default: return '📝';
    }
};

/**
 * The live log stream of one package on one box, relayed by the registry as
 * Server-Sent Events. It reconnects with backoff whenever the connection ends —
 * the registry closes streams on its own, and the box can drop off and come
 * back — until {@link stop} is called. Only a status in `fatalStatuses`
 * (a refused key, by default) ends it for good.
 */
export class PackageLogStream {
    private abortController?: AbortController;
    private stopped = false;
    private reconnectMs = MIN_RECONNECT_MS;

    constructor(
        private readonly url: string,
        private readonly apiKey: string,
        private readonly onEvent: (event: PackageLogStreamEvent) => void,
        private readonly fatalStatuses: number[] = [401, 403]
    ) {}

    /**
     * Opens the stream and keeps it open in the background. Resolves once the
     * first attempt is answered, so a caller can rely on lines being captured
     * from then on; rejects only for a fatal status.
     */
    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const onFirstAnswer = (error?: Error) => {
                if (!settled) {
                    settled = true;
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                }
            };
            void this.run(onFirstAnswer);
        });
    }

    stop(): void {
        this.stopped = true;
        this.abortController?.abort();
    }

    private async run(onFirstAnswer: (error?: Error) => void): Promise<void> {
        while (!this.stopped) {
            try {
                await this.connectOnce(onFirstAnswer);
            } catch (error) {
                if (error instanceof CLIError) {
                    this.stopped = true;
                    onFirstAnswer(error);
                    console.error(`❌ ${error.message}`);
                    return;
                }
                if (!this.stopped) {
                    console.error(`⚠️ Log stream interrupted: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            onFirstAnswer();
            if (this.stopped) {
                return;
            }
            console.log(`🔄 Reconnecting the log stream in ${this.reconnectMs / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, this.reconnectMs));
            this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
        }
    }

    private async connectOnce(onFirstAnswer: (error?: Error) => void): Promise<void> {
        this.abortController = new AbortController();
        const response = await fetch(this.url, {
            headers: {'Authorization': `Bearer ${this.apiKey}`, 'Accept': 'text/event-stream'},
            signal: this.abortController.signal
        });

        if (!response.ok || !response.body) {
            const message = await readErrorMessage(response);
            const text = `Log stream refused: ${response.status}${message ? ` — ${message}` : ''}`;
            if (this.fatalStatuses.includes(response.status)) {
                throw new CLIError(text);
            }
            throw new Error(text);
        }

        console.log('🔌 Log stream connected');
        this.reconnectMs = MIN_RECONNECT_MS;
        onFirstAnswer();

        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        try {
            for (;;) {
                const {done, value} = await reader.read() as {done: boolean; value?: Uint8Array};
                if (done) {
                    break;
                }
                for (const data of parser.push(decoder.decode(value, {stream: true}))) {
                    const event = parsePackageLogEvent(data);
                    if (event) {
                        this.onEvent(event);
                    }
                }
            }
        } catch (error) {
            if (!this.stopped) {
                throw error;
            }
        }

        if (!this.stopped) {
            console.log('🔌 Log stream closed by the registry');
        }
    }
}
