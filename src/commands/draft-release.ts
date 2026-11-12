import fs from 'fs';
import {buildBundle, preparePackageFiles, putBundle} from './release.js';
import {readEnyoPackageConfig, selectSinglePackageConfig} from '../utils/file-utils.js';
import {CLIError, handleError} from '../utils/error-handler.js';
import {uploadFirmwareFiles} from '../utils/firmware.js';
import {uploadPublicFiles} from '../utils/public-files.js';
import {registryRequest} from '../utils/registry-api.js';
import {
    buildCreateDraftReleasePayload,
    evaluateDraftStatus,
    formatDraftVersion,
    parseDebugLogMinutes,
    type DraftProgress
} from '../utils/draft-release.js';
import {
    createPackageLogHandler,
    PackageLogStream,
    packageLogStreamUrl,
    resolveLogFilePath
} from '../utils/package-log-stream.js';
import {DEFAULT_REGISTRY_URL} from '../constants/defaults.js';
import type {CreateDraftReleaseResponse, DraftReleaseCommandOptions, DraftReleaseStatus} from '../types';

const POLL_INTERVAL_MS = 3000;
/** The box gives a download ten minutes before it gives up, so the wait does too. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Push the current build to one enyo Box as a draft release: it installs there
 * as if it were the latest version, until the next regular release replaces it.
 * Only internal developer orgs may do this; the registry refuses everyone else.
 */
export const draftReleaseCommand = async (options: DraftReleaseCommandOptions): Promise<void> => {
    let stream: PackageLogStream | undefined;
    try {
        if (!options.apiKey) {
            throw new CLIError('API key is required. Use --api-key <apiKey> to provide it.');
        }
        if (!options.device) {
            throw new CLIError('The enyo Box is required. Use --device <serial> to provide its serial number.');
        }
        const apiKey = options.apiKey;
        const device = options.device;
        const registry = options.registry || DEFAULT_REGISTRY_URL;
        const debugLogMinutes = parseDebugLogMinutes(options.debug);
        const writesLogFile = options.out !== undefined && options.out !== false;

        const configFile = selectSinglePackageConfig(options.file);
        const config = await readEnyoPackageConfig(configFile);
        console.log(`📦 Loaded package: ${config.packageName}`);

        const {firmware, files} = await preparePackageFiles(config, configFile);
        const bundlePath = buildBundle(firmware);

        let draft: CreateDraftReleaseResponse;
        try {
            console.log(`🚀 Creating draft release for ${device} on ${registry} using SDK Version ${config.sdkVersion}`);
            draft = await registryRequest<CreateDraftReleaseResponse>(
                `${registry}/api/package-registry/create-draft-release`,
                apiKey,
                {method: 'POST', body: buildCreateDraftReleasePayload(config, firmware, files, device, debugLogMinutes)},
                'Creating the draft release'
            );
            console.log(
                `🏷️ Draft ${formatDraftVersion(draft.baseVersion, draft.draftNumber)} — builds on released v${draft.baseVersion}`
            );

            await uploadFirmwareFiles(firmware, draft.firmwareUploads);
            await uploadPublicFiles(files, draft.fileUploads);
            await putBundle(bundlePath, draft.uploadUrl);
        } finally {
            fs.rmSync(bundlePath, {force: true});
        }

        if (options.logs || writesLogFile) {
            // Opened before the box is told to install, so the install and the
            // app's first lines are part of the stream. A package that is not on
            // the box yet has no stream to open, which is why only a refused key
            // ends it here: everything else is retried until the draft is there.
            const logFile = resolveLogFilePath(options.out, device, config.packageName);
            const onEvent = createPackageLogHandler(logFile, `${config.packageName} on ${device}, draft ${draft.draftReleaseId}`);
            stream = new PackageLogStream(packageLogStreamUrl(registry, device, config.packageName), apiKey, onEvent);
            await stream.start();
        }

        await registryRequest<DraftReleaseStatus>(
            `${registry}/api/package-registry/finish-draft-release`,
            apiKey,
            {method: 'POST', body: {draftReleaseId: draft.draftReleaseId}},
            'Finishing the draft release'
        );
        console.log(`📨 Draft sent to ${device}`);
        if (debugLogMinutes !== undefined) {
            console.log(`🐛 Debug logs on for ${debugLogMinutes} minute(s)`);
        }

        const outcome = await waitForDraft(registry, apiKey, draft.draftReleaseId);
        if (outcome.state === 'failed') {
            throw new CLIError(outcome.message.replace(/^❌ /, ''));
        }

        if (!stream) {
            return;
        }
        const activeStream = stream;
        console.log('👂 Streaming logs... (Press Ctrl+C to stop)');
        const cleanup = () => {
            console.log('\n👋 Disconnecting from log stream...');
            activeStream.stop();
            process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    } catch (error) {
        stream?.stop();
        if (error instanceof CLIError) {
            throw error;
        }
        handleError(error, 'creating draft release');
    }
};

/** Poll the draft's status until it runs, fails, or the install timeout passes. */
const waitForDraft = async (registry: string, apiKey: string, draftReleaseId: string): Promise<DraftProgress> => {
    const deadline = Date.now() + INSTALL_TIMEOUT_MS;
    let installStarted = false;
    let lastMessage = '';

    while (Date.now() < deadline) {
        try {
            const status = await registryRequest<DraftReleaseStatus>(
                `${registry}/api/package-registry/draft-releases/${encodeURIComponent(draftReleaseId)}/status`,
                apiKey,
                {method: 'GET'},
                'Reading the draft status'
            );
            const progress = evaluateDraftStatus(status, installStarted);
            installStarted = progress.installStarted;
            if (progress.message !== lastMessage) {
                if (progress.state === 'failed') {
                    console.error(progress.message);
                } else {
                    console.log(progress.message);
                }
                lastMessage = progress.message;
            }
            if (progress.state !== 'waiting') {
                return progress;
            }
        } catch (error) {
            // A status call that fails once is no reason to give up on an
            // install that is still running on the box.
            const message = `⚠️ ${error instanceof Error ? error.message : String(error)}`;
            if (message !== lastMessage) {
                console.error(message);
                lastMessage = message;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new CLIError(
        `The box did not report the draft as running within ${INSTALL_TIMEOUT_MS / 60000} minutes. ` +
        'Check it with `enyo logs` or in the backoffice.'
    );
};
