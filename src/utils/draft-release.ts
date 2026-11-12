import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {buildCreateReleasePayload} from '../commands/release.js';
import {CLIError} from './error-handler.js';
import type {DraftReleaseStatus, PreparedFirmwareFile, PreparedPublicFile} from '../types';

/** Minutes of debug logging for a bare `--debug`. */
export const DEFAULT_DEBUG_LOG_MINUTES = 60;
/** The registry's upper bound for one debug-log window. */
export const MAX_DEBUG_LOG_MINUTES = 1440;

/** How a draft is shown everywhere: the released version it builds on plus its draft counter. */
export const formatDraftVersion = (baseVersion: number, draftNumber: number): string =>
    `v${baseVersion}-draft.${draftNumber}`;

/**
 * `--debug` as commander hands it over: `true` without a value, the typed
 * string otherwise, `undefined` when the flag is absent.
 */
export const parseDebugLogMinutes = (value: boolean | string | undefined): number | undefined => {
    if (value === undefined || value === false) {
        return undefined;
    }
    if (value === true) {
        return DEFAULT_DEBUG_LOG_MINUTES;
    }
    return parseMinutes(value);
};

/** A whole number of minutes between 1 and {@link MAX_DEBUG_LOG_MINUTES}. */
export const parseMinutes = (value: string): number => {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DEBUG_LOG_MINUTES) {
        throw new CLIError(`Debug log minutes must be a whole number from 1 to ${MAX_DEBUG_LOG_MINUTES}, got '${value}'.`);
    }
    return minutes;
};

/**
 * The `create-draft-release` body: what `create-release` gets, minus the
 * channel (the registry takes the one the box runs), the logo and the release
 * notes — plus the box and the optional debug window.
 */
export const buildCreateDraftReleasePayload = (
    config: EnergyAppPackageDefinition,
    firmware: PreparedFirmwareFile[],
    files: PreparedPublicFile[],
    deviceSerialNumber: string,
    debugLogMinutes?: number
): Record<string, unknown> => ({
    ...buildCreateReleasePayload(config, undefined, undefined, firmware, files),
    deviceSerialNumber,
    ...(debugLogMinutes !== undefined ? {debugLogMinutes} : {})
});

export interface DraftProgress {
    state: 'waiting' | 'done' | 'failed';
    message: string;
    /** The box has been seen working on an install — a `failed` from before the draft no longer counts as stale. */
    installStarted: boolean;
}

const INSTALL_PROGRESS_STATUSES = ['installation-pending', 'update-pending', 'installing', 'updating'];

/**
 * Turn one draft status into what the command prints and whether it stops.
 *
 * A package that already sat at `failed` before the draft was pushed reports
 * `failed` until the box picks the install up, so `failed` only ends the wait
 * once an install was seen in progress or the draft itself is on the box. An
 * app that is installed but has not been onboarded on this box settles at
 * `configuration-required`, which is as far as a fresh install gets — only
 * `launching` is still on its way.
 */
export const evaluateDraftStatus = (status: DraftReleaseStatus, installStartedBefore: boolean): DraftProgress => {
    const label = formatDraftVersion(status.baseVersion, status.draftNumber);
    const installStarted = installStartedBefore
        || INSTALL_PROGRESS_STATUSES.includes(status.packageStatus ?? '')
        || status.installed;

    if (status.packageStatus === 'failed' && installStarted) {
        return {state: 'failed', message: `❌ ${label} failed to install on ${status.deviceSerialNumber}`, installStarted};
    }
    if (status.installed && status.runningState && status.runningState !== 'launching') {
        const message = status.runningState === 'running'
            ? `✅ ${label} running on ${status.deviceSerialNumber}`
            : `✅ ${label} installed on ${status.deviceSerialNumber} — the app reports '${status.runningState}'`;
        return {state: 'done', message, installStarted};
    }
    if (!status.deviceOnline) {
        return {state: 'waiting', message: `📴 ${status.deviceSerialNumber} is offline — waiting for it to come back...`, installStarted};
    }
    if (status.installed) {
        return {state: 'waiting', message: `🚦 ${label} installed, waiting for the app to start...`, installStarted};
    }
    if (installStarted) {
        return {state: 'waiting', message: `⏳ ${status.deviceSerialNumber} is installing ${label} (${status.packageStatus})...`, installStarted};
    }
    return {state: 'waiting', message: `⏳ Waiting for ${status.deviceSerialNumber} to pick up ${label}...`, installStarted};
};
