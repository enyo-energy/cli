import {test, describe, mock, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import {
    defineOnboardingGuideV2,
    EnyoOnboardingV2StartVariant,
    onboardingV2Block,
    onboardingV2Target,
    onContinueV2
} from '@enyo-energy/energy-app-sdk';
import type {EnergyAppPackageDefinition, EnyoOnboardingV2Guide} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {validateOnboardingGuideDeclaration} from './onboarding-guide.js';
import {hashReleaseDefinition} from './fingerprint.js';
import {buildCreateReleasePayload, prepareRelease} from '../commands/release.js';

afterEach(() => {
    mock.restoreAll();
});

const en = (value: string) => [{language: 'en' as const, value}];

/** A printable guide: manual setup, no scan, one step straight to success. */
const manualGuide = (introText = 'Enable Modbus TCP in the web interface.'): EnyoOnboardingV2Guide =>
    defineOnboardingGuideV2({
        title: en('Set up the inverter manually'),
        startVariant: EnyoOnboardingV2StartVariant.ManualSetup,
        requiresNetworkScan: false,
        startStepId: 'prepare',
        steps: [
            {
                id: 'prepare',
                name: 'enable-modbus',
                title: en('Enable Modbus TCP'),
                blocks: [onboardingV2Block.text('intro', en(introText))],
                transitions: [onContinueV2(onboardingV2Target.success())]
            }
        ]
    });

/** A minimal definition, plus the given guide. */
const definitionWith = (
    onboardingGuide: EnyoOnboardingV2Guide | undefined,
    overrides: Partial<EnergyAppPackageDefinition> = {}
): EnergyAppPackageDefinition => ({
    version: '1',
    packageName: 'test-package',
    sdkVersion: '0.0.195',
    permissions: [],
    categories: [],
    storeEntry: [],
    compatibility: [],
    ...(onboardingGuide ? {onboardingGuide} : {}),
    ...overrides
} as unknown as EnergyAppPackageDefinition);

/** The same guide without `requiresNetworkScan`, which then defaults to a scan. */
const withoutScanFlag = (): EnyoOnboardingV2Guide => {
    const {requiresNetworkScan: _flag, ...rest} = manualGuide();
    return rest as EnyoOnboardingV2Guide;
};

describe('validateOnboardingGuideDeclaration', () => {
    test('passes a package declaring no guide', () => {
        assert.doesNotThrow(() => validateOnboardingGuideDeclaration(definitionWith(undefined)));
    });

    test('passes a printable manual setup guide', () => {
        assert.doesNotThrow(() => validateOnboardingGuideDeclaration(definitionWith(manualGuide())));
    });

    test('rejects a guide that does not opt out of the network scan', () => {
        assert.throws(() => validateOnboardingGuideDeclaration(definitionWith(withoutScanFlag())), CLIError);
    });

    test('rejects an image block whose file is not declared', () => {
        const guide = manualGuide();
        guide.steps[0].blocks.push(onboardingV2Block.imageFile('menu', 'modbus-menu', en('Menu')));
        // With no `files` at all the SDK can only warn; a declared list it can check.
        assert.doesNotThrow(() => validateOnboardingGuideDeclaration(definitionWith(guide)));
        assert.throws(() => validateOnboardingGuideDeclaration(definitionWith(guide, {files: []})), CLIError);
    });
});

describe('prepareRelease with an onboarding guide', () => {
    test('throws for an invalid guide before any network call', async () => {
        const request = mock.method(https, 'request', () => {
            throw new Error('no network in this test');
        });

        await assert.rejects(
            prepareRelease(definitionWith(withoutScanFlag()), 'production'),
            (error: unknown) =>
                error instanceof CLIError && /Onboarding guide declaration is invalid/.test(error.message)
        );
        assert.equal(request.mock.callCount(), 0);
    });
});

describe('buildCreateReleasePayload with an onboarding guide', () => {
    test('carries the guide verbatim', () => {
        const guide = manualGuide();
        const payload = buildCreateReleasePayload(definitionWith(guide), undefined, 'production', []);
        assert.equal(payload.onboardingGuide, guide);
    });

    test('has no guide key for a package without one', () => {
        const payload = buildCreateReleasePayload(definitionWith(undefined), undefined, 'production', []);
        assert.equal('onboardingGuide' in payload, false);
    });

    test('changes the definition hash when only the guide changes', () => {
        const hashOf = (guide: EnyoOnboardingV2Guide) =>
            hashReleaseDefinition(buildCreateReleasePayload(definitionWith(guide), undefined, 'production', []));

        assert.equal(hashOf(manualGuide()), hashOf(manualGuide()));
        assert.notEqual(hashOf(manualGuide()), hashOf(manualGuide('Enable Modbus TCP under Settings → Network.')));
    });
});
