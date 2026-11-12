import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {
    buildCreateDraftReleasePayload,
    evaluateDraftStatus,
    formatDraftVersion,
    parseDebugLogMinutes
} from './draft-release.js';
import type {DraftReleaseStatus} from '../types';

const config = {
    packageName: 'my-app',
    version: '1',
    sdkVersion: '1.60.0',
    permissions: [],
    logo: './logo.png'
} as unknown as EnergyAppPackageDefinition;

const status = (overrides: Partial<DraftReleaseStatus> = {}): DraftReleaseStatus => ({
    draftReleaseId: 'draft-1',
    cloudPackageId: 'pkg-1',
    packageName: 'enyo-my-app',
    deviceSerialNumber: 'SERIAL-1',
    baseVersion: 42,
    draftNumber: 3,
    status: 'ready',
    deviceOnline: true,
    installed: false,
    ...overrides
});

describe('formatDraftVersion', () => {
    test('shows the base version and the draft counter', () => {
        assert.equal(formatDraftVersion(42, 3), 'v42-draft.3');
    });
});

describe('parseDebugLogMinutes', () => {
    test('is absent without the flag', () => {
        assert.equal(parseDebugLogMinutes(undefined), undefined);
    });

    test('defaults a bare --debug to 60 minutes', () => {
        assert.equal(parseDebugLogMinutes(true), 60);
    });

    test('takes typed minutes', () => {
        assert.equal(parseDebugLogMinutes('15'), 15);
    });

    test('refuses minutes outside 1–1440 or not whole', () => {
        for (const value of ['0', '1441', '2.5', 'abc']) {
            assert.throws(() => parseDebugLogMinutes(value), CLIError);
        }
    });
});

describe('buildCreateDraftReleasePayload', () => {
    test('carries the box and the debug window, but no channel, logo or release note', () => {
        const payload = buildCreateDraftReleasePayload(config, [], [], 'SERIAL-1', 30);

        assert.equal(payload.deviceSerialNumber, 'SERIAL-1');
        assert.equal(payload.debugLogMinutes, 30);
        assert.equal(payload.packageName, 'my-app');
        assert.equal('channel' in payload, false);
        assert.equal(payload.uploadLogo, undefined);
        assert.equal('releaseNote' in payload, false);
        assert.equal('bundleSha256' in payload, false);
    });

    test('leaves the debug window out when it was not asked for', () => {
        const payload = buildCreateDraftReleasePayload(config, [], [], 'SERIAL-1');
        assert.equal('debugLogMinutes' in payload, false);
    });
});

describe('evaluateDraftStatus', () => {
    test('waits while the box has not picked the draft up', () => {
        assert.equal(evaluateDraftStatus(status(), false).state, 'waiting');
    });

    test('is done once the draft is installed and running', () => {
        const progress = evaluateDraftStatus(status({installed: true, packageStatus: 'installed', runningState: 'running'}), true);
        assert.equal(progress.state, 'done');
        assert.equal(progress.message, '✅ v42-draft.3 running on SERIAL-1');
    });

    test('is done for a fresh install that waits for its configuration', () => {
        const progress = evaluateDraftStatus(
            status({installed: true, packageStatus: 'installed', runningState: 'configuration-required'}),
            true
        );
        assert.equal(progress.state, 'done');
    });

    test('keeps waiting while the installed app is still launching', () => {
        const progress = evaluateDraftStatus(status({installed: true, packageStatus: 'installed', runningState: 'launching'}), true);
        assert.equal(progress.state, 'waiting');
    });

    test('ignores a failed status from before the box started the install', () => {
        assert.equal(evaluateDraftStatus(status({packageStatus: 'failed'}), false).state, 'waiting');
    });

    test('fails once an install that was seen in progress ends failed', () => {
        const started = evaluateDraftStatus(status({packageStatus: 'updating'}), false);
        assert.equal(started.installStarted, true);
        assert.equal(evaluateDraftStatus(status({packageStatus: 'failed'}), started.installStarted).state, 'failed');
    });

    test('says when the box is offline', () => {
        const progress = evaluateDraftStatus(status({deviceOnline: false}), false);
        assert.equal(progress.state, 'waiting');
        assert.match(progress.message, /offline/);
    });
});
