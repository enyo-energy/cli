/**
 * End to end over the fixture app in `example/onboarding-sim-fixture`: boot a
 * real bundle against the mock SDK, pull its guides, and walk them.
 */
import {describe, it, before} from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {fileURLToPath} from 'url';
import {
    EnyoOnboardingV2StartVariant,
    EnyoOnboardingV2TargetType,
    EnyoOnboardingV2TransitionSourceKind,
} from '@enyo-energy/energy-app-sdk';
import {loadEnergyApp, type LoadedApp} from './app-loader.js';
import {RunStore, START_VARIANTS, defaultContextFor} from './run-store.js';

const fixtureDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../example/onboarding-sim-fixture'
);

const loadFixture = (): Promise<LoadedApp> => loadEnergyApp({cwd: fixtureDir});

describe('loadEnergyApp', () => {
    let app: LoadedApp;
    before(async () => {
        app = await loadFixture();
    });

    it('boots the bundle and pulls the guides the app returns', () => {
        assert.equal(app.answer, 'guides');
        assert.equal(app.guides.length, 4);
        assert.equal(app.detail, 'onboarding-sim fixture');
    });

    it('runs the app\'s register callback, so its handlers are live', () => {
        assert.ok(app.mock.state.guidesHandler);
        assert.ok(app.mock.state.dynamicHandler);
        assert.ok(app.mock.state.additionalSetupHandler);
        assert.ok(app.logs.some(line => line.message.includes('fixture app registered')));
    });

    it('covers every start variant', () => {
        // `Array.from` rather than `map`: the guides were built inside the vm
        // context, so an array derived from them carries that realm's Array
        // prototype and would never compare equal to one built out here.
        const variants = Array.from(app.guides, guide => guide.startVariant).sort();
        assert.deepEqual(variants, [...START_VARIANTS].sort());
    });

    it('validates the answer with the SDK\'s own validators', () => {
        assert.deepEqual(app.validation.result.errors, []);
        assert.deepEqual(app.validation.result.warnings, []);
        assert.equal(app.validation.guides.length, 4);
    });
});

describe('variant contexts', () => {
    it('gives a device only to the variant that starts from a successful scan', () => {
        assert.equal(defaultContextFor(EnyoOnboardingV2StartVariant.DeviceNotFound).networkDeviceId, undefined);
        assert.equal(defaultContextFor(EnyoOnboardingV2StartVariant.ManualSetup).networkDeviceId, undefined);
        assert.ok(defaultContextFor(EnyoOnboardingV2StartVariant.DeviceFoundConfig).networkDeviceId);
    });

    it('binds a maintenance run to the appliance its guide names', () => {
        const context = defaultContextFor(EnyoOnboardingV2StartVariant.Maintenance, {
            title: [],
            startVariant: EnyoOnboardingV2StartVariant.Maintenance,
            applianceId: 'wallbox-7',
            startStepId: 'x',
            steps: [],
        });
        assert.equal(context.applianceId, 'wallbox-7');
    });
});

describe('walking a run', () => {
    let store: RunStore;
    let wallboxIndex: number;

    before(async () => {
        const app = await loadFixture();
        store = new RunStore(app);
        wallboxIndex = app.guides.findIndex(guide => guide.name === 'sim-wallbox-not-found');
    });

    it('walks the happy path to success, running the app\'s setup handler on the way', async () => {
        const run = store.createRun(wallboxIndex);

        store.answer(run.id, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice,
            blockId: 'connection-choice',
            optionId: 'lan',
        });
        store.recordInput(run.id, 'address-input', '192.168.1.50');
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'address-input',
            outcomeId: 'reachable',
        });

        const verdict = await store.runAdditionalSetup(run.id, 'vendor-setup', [
            {name: 'token', value: 'good-token'},
        ]);
        assert.equal(verdict.rawOutcome, 'connected');
        assert.equal(verdict.fellBackToFailed, false);

        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'ocpp-connect',
            outcomeId: 'connected',
        });

        const view = await store.view(run.id);
        assert.equal(view.status, 'terminal');
        assert.equal(view.terminal?.type, EnyoOnboardingV2TargetType.Success);
    });

    it('routes a rejected token to the branch the app\'s verdict names', async () => {
        const run = store.createRun(wallboxIndex);
        store.answer(run.id, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice,
            blockId: 'connection-choice',
            optionId: 'lan',
        });
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'address-input',
            outcomeId: 'reachable',
        });

        const verdict = await store.runAdditionalSetup(run.id, 'vendor-setup', [
            {name: 'token', value: 'wrong'},
        ]);
        assert.equal(verdict.rawOutcome, 'failed');

        const view = await store.view(run.id);
        assert.equal(view.status, 'terminal');
        assert.deepEqual(view.terminal, {type: EnyoOnboardingV2TargetType.Support, reason: 'vendor-token-rejected'});
    });

    it('takes the skip handle to the pause the guide declares', async () => {
        const run = store.createRun(wallboxIndex);
        store.answer(run.id, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice,
            blockId: 'connection-choice',
            optionId: 'lan',
        });
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'address-input',
            outcomeId: 'reachable',
        });
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Skip,
            blockId: 'vendor-setup',
            skipId: 'later',
        });

        const view = await store.view(run.id);
        assert.equal(view.terminal?.type, EnyoOnboardingV2TargetType.Pause);
    });

    it('checks a typed value with the block\'s own value type', () => {
        const run = store.createRun(wallboxIndex);
        assert.equal(store.validateInput(run.id, 'address-input', 'not-an-ip').valid, false);
        assert.equal(store.validateInput(run.id, 'address-input', '192.168.1.50').valid, true);
    });

    it('goes back by dropping the last answer, not by unwinding', async () => {
        const run = store.createRun(wallboxIndex);
        store.answer(run.id, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice,
            blockId: 'connection-choice',
            optionId: 'lan',
        });
        assert.equal((await store.view(run.id)).step?.name, 'enter-address');

        store.back(run.id);
        assert.equal((await store.view(run.id)).step?.name, 'pick-connection');
    });
});

describe('dynamic blocks', () => {
    let store: RunStore;
    let app: LoadedApp;

    before(async () => {
        app = await loadFixture();
        store = new RunStore(app);
    });

    it('shows the app\'s value when it answers', async () => {
        const index = app.guides.findIndex(guide => guide.name === 'sim-device-found');
        const run = store.createRun(index);
        const view = await store.view(run.id);
        assert.deepEqual(view.dynamic['found-ip'].value, '192.168.178.42');
        assert.equal(view.dynamic['found-ip'].source, 'app');
    });

    it('falls back to the host\'s own resolution when the app answers nothing', async () => {
        // The fixture answers null for `ocpp-url`, which is the ordinary case:
        // the URL is the host's to build, not the app's to know.
        const index = app.guides.findIndex(guide => guide.name === 'sim-wallbox-not-found');
        const run = store.createRun(index);
        store.answer(run.id, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice,
            blockId: 'connection-choice',
            optionId: 'lan',
        });
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'address-input',
            outcomeId: 'reachable',
        });
        await store.runAdditionalSetup(run.id, 'vendor-setup', [{name: 'token', value: 'good-token'}]);

        const view = await store.view(run.id);
        assert.equal(view.step?.name, 'pair');
        assert.equal(view.dynamic['ocpp-url'].source, 'host');
        assert.match(view.dynamic['ocpp-url'].value ?? '', /^wss:\/\/.+\/ocpp\/.+\/.+$/);
    });

    it('leaves device-ip unresolved for a run that carries no device', async () => {
        // The device-not-found run carries no device, and the fixture answers
        // null for exactly that case.
        const index = app.guides.findIndex(guide => guide.name === 'sim-wallbox-not-found');
        const run = store.createRun(index);
        store.answer(run.id, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice,
            blockId: 'connection-choice',
            optionId: 'lan',
        });

        const view = await store.view(run.id);
        // Nothing was found, so neither the app nor the host has an address —
        // which is the honest state of a `device-not-found` run.
        assert.equal(view.dynamic['device-ip'].value, null);
        assert.equal(view.dynamic['device-ip'].source, 'unresolved');
        assert.equal(view.status, 'await');
    });
});

describe('hand-off between variants', () => {
    it('points a start-variant terminal at the guide that serves it', async () => {
        const app = await loadFixture();
        const store = new RunStore(app);
        const index = app.guides.findIndex(guide => guide.name === 'sim-device-found');
        const run = store.createRun(index);

        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'device-test',
            outcomeId: 'unreachable',
        });

        const view = await store.view(run.id);
        assert.equal(view.terminal?.type, EnyoOnboardingV2TargetType.StartVariant);
        assert.equal(
            app.guides[view.handoffGuideIndex!].startVariant,
            EnyoOnboardingV2StartVariant.ManualSetup
        );
    });
});
