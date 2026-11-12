import {readEnyoPackageConfig, selectSinglePackageConfig} from '../utils/file-utils.js';
import {CLIError, handleError} from '../utils/error-handler.js';
import {
    createPackageLogHandler,
    PackageLogStream,
    packageLogStreamUrl,
    resolveLogFilePath
} from '../utils/package-log-stream.js';
import {DEFAULT_REGISTRY_URL} from '../constants/defaults.js';
import type {LogsCommandOptions} from '../types';

/** Stream one package's logs from an enyo Box through the registry, until Ctrl+C. */
export const logsCommand = async (options: LogsCommandOptions): Promise<void> => {
    try {
        if (!options.apiKey) {
            throw new CLIError('API key is required. Use --api-key <apiKey> to provide it.');
        }
        if (!options.device) {
            throw new CLIError('The enyo Box is required. Use --device <serial> to provide its serial number.');
        }

        const config = await readEnyoPackageConfig(selectSinglePackageConfig(options.file));
        const registry = options.registry || DEFAULT_REGISTRY_URL;
        const logFile = resolveLogFilePath(options.out, options.device, config.packageName);
        console.log(`👂 Streaming logs of ${config.packageName} from ${options.device}...`);
        const onEvent = createPackageLogHandler(logFile, `${config.packageName} on ${options.device}`);

        // An unknown box or package will not appear by retrying, so 404 ends
        // the stream too.
        const stream = new PackageLogStream(
            packageLogStreamUrl(registry, options.device, config.packageName),
            options.apiKey,
            onEvent,
            [401, 403, 404]
        );
        await stream.start();
        console.log('👂 Listening for log messages... (Press Ctrl+C to stop)');

        const cleanup = () => {
            console.log('\n👋 Disconnecting from log stream...');
            stream.stop();
            process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    } catch (error) {
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'streaming logs');
    }
};
