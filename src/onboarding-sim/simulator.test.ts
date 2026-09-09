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
import {SIMULATED_EEBUS_PEERS} from './simulated-world.js';
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
        assert.equal(app.guides.length, 5);
        assert.equal(app.detail, 'onboarding-sim fixture');
    });

    it('runs the app\'s register callback, so its handlers are live', () => {
        assert.ok(app.mock.state.guidesHandler);
        assert.ok(app.mock.state.dynamicHandler);
        assert.ok(app.mock.state.additionalSetupHandler);
        assert.ok(app.mock.state.deviceSelectHandler);
        assert.ok(app.mock.state.eebusDeviceSelectHandler);
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
        assert.equal(app.validation.guides.length, 5);
    });
});

describe('variant contexts', () => {
    it('gives a device only to the variant that starts from a successful scan', () => {
        assert.equal(defaultContextFor(EnyoOnboardingV2StartVariant.DeviceNotFound).networkDeviceId, undefined);
        assert.equal(defaultContextFor(EnyoOnboardingV2StartVariant.ManualSetup).networkDeviceId, undefined);
        assert.ok(defaultContextFor(EnyoOnboardingV2StartVariant.DeviceFoundConfig).networkDeviceId);
    });

    it('binds an offline-reconnect run to the appliance its guide names, and to no device', () => {
        // The appliance is the input; finding a device again is the run's job,
        // which is exactly what its picker is handed the appliance id for.
        const context = defaultContextFor(EnyoOnboardingV2StartVariant.OfflineReconnect, {
            title: [],
            startVariant: EnyoOnboardingV2StartVariant.OfflineReconnect,
            applianceId: 'heatpump-3',
            startStepId: 'x',
            steps: [],
        });
        assert.equal(context.applianceId, 'heatpump-3');
        assert.equal(context.networkDeviceId, undefined);
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

describe('picker blocks', () => {
    let app: LoadedApp;
    let store: RunStore;
    let reconnectIndex: number;

    before(async () => {
        app = await loadFixture();
        store = new RunStore(app);
        reconnectIndex = app.guides.findIndex(guide => guide.name === 'sim-heatpump-reconnect');
    });

    it('renders the list a `detectedAt` filter leaves, and nothing else', async () => {
        const run = store.createRun(reconnectIndex);
        const view = await store.view(run.id);

        assert.equal(view.step?.name, 'rescan');
        const picker = view.pickers['reconnect-pick'];
        assert.equal(picker.kind, 'device-select');
        // Two devices announce themselves over mDNS; the Modbus-only one is
        // filtered out, so the screen is rendered rather than skipped.
        assert.deepEqual(
            picker.candidates.map(candidate => candidate.key).sort(),
            ['sim-network-device', 'sim-network-device-heatpump']
        );
        assert.equal(picker.wouldSkip, false);
    });

    it('hands the pick to the app, binds the run to it, and takes `selected`', async () => {
        const run = store.createRun(reconnectIndex);
        const resolution = await store.pick(run.id, 'reconnect-pick', 'sim-network-device-heatpump');

        assert.equal(resolution.autoSelected, false);
        assert.equal(resolution.source, 'app');
        // The fixture answers with the appliance the run came in with: a
        // reconnect re-points the existing one rather than making a second.
        // `Array.from`: the array came back from the app's own vm realm.
        assert.deepEqual(Array.from(resolution.applianceIds), ['sim-appliance']);

        const view = await store.view(run.id);
        assert.equal(view.context.networkDeviceId, 'sim-network-device-heatpump');
        assert.equal(view.context.deviceIp, '192.168.178.44');
        assert.equal(view.context.applianceId, 'sim-appliance');
    });

    it('skips the screen when exactly one candidate matches, and still calls the handler', async () => {
        const run = store.createRun(reconnectIndex);
        await store.pick(run.id, 'reconnect-pick', 'sim-network-device-heatpump');

        // The EEBUS picker filters to heat pumps and is left with one peer, so
        // the host binds it, fires `paired` and never renders the step — which
        // here walks the run straight to its success terminal.
        const view = await store.view(run.id);
        assert.equal(view.status, 'terminal');
        assert.equal(view.terminal?.type, EnyoOnboardingV2TargetType.Success);

        const pick = store.run(run.id).picks['reconnect-pair'];
        assert.equal(pick.autoSelected, true);
        assert.equal(pick.kind, 'eebus-device-select');
        assert.equal(pick.key, SIMULATED_EEBUS_PEERS[0].ski);
        assert.deepEqual(Array.from(pick.applianceIds), ['sim-appliance']);
        assert.equal(store.run(run.id).context.eebusSki, SIMULATED_EEBUS_PEERS[0].ski);
    });

    it('shows the skipped screen again when the installer walks back onto it', async () => {
        const run = store.createRun(reconnectIndex);
        await store.pick(run.id, 'reconnect-pick', 'sim-network-device-heatpump');
        assert.equal((await store.view(run.id)).status, 'terminal');

        store.back(run.id);
        const view = await store.view(run.id);
        // The pick is remembered, so the auto-select does not fire again and
        // bounce the installer forward — the screen is theirs to change.
        assert.equal(view.step?.name, 'repair');
        assert.equal(view.pickers['reconnect-pair'].wouldSkip, true);
        assert.ok(view.pickers['reconnect-pair'].resolution);
    });

    it('routes an empty list through not-found, which never skips', async () => {
        const run = store.createRun(reconnectIndex);
        store.answer(run.id, {
            kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
            blockId: 'reconnect-pick',
            outcomeId: 'none',
        });

        const view = await store.view(run.id);
        assert.deepEqual(view.terminal, {
            type: EnyoOnboardingV2TargetType.Support,
            reason: 'device-still-offline',
        });
    });

    it('refuses a key its filter leaves off the list', async () => {
        const run = store.createRun(reconnectIndex);
        await assert.rejects(
            () => store.pick(run.id, 'reconnect-pick', 'sim-network-device-inverter'),
            /is not on reconnect-pick's list/
        );
    });

    it('binds the run even when the app registered no picker handler', async () => {
        const bare = await loadFixture();
        bare.mock.state.deviceSelectHandler = undefined;
        const bareStore = new RunStore(bare);
        const index = bare.guides.findIndex(guide => guide.name === 'sim-heatpump-reconnect');

        const run = bareStore.createRun(index);
        const resolution = await bareStore.pick(run.id, 'reconnect-pick', 'sim-network-device');

        // No appliance, but the flow is unaffected: the pick binds the device
        // and the run still takes `selected`.
        assert.equal(resolution.source, 'no-handler');
        assert.deepEqual(resolution.applianceIds, []);
        assert.equal(bareStore.run(run.id).context.networkDeviceId, 'sim-network-device');
        // The run walks on to the EEBUS picker, which still pairs and — with the
        // handler it does have — still produces an appliance.
        assert.equal((await bareStore.view(run.id)).terminal?.type, EnyoOnboardingV2TargetType.Success);
    });

    it('takes the positive branch when the app\'s handler rejects', async () => {
        const angry = await loadFixture();
        angry.mock.state.deviceSelectHandler = async () => {
            throw new Error('vendor cloud is down');
        };
        const angryStore = new RunStore(angry);
        const index = angry.guides.findIndex(guide => guide.name === 'sim-heatpump-reconnect');

        const run = angryStore.createRun(index);
        const resolution = await angryStore.pick(run.id, 'reconnect-pick', 'sim-network-device');

        assert.equal(resolution.source, 'rejected');
        assert.match(resolution.note ?? '', /vendor cloud is down/);
        // A handler that fails loudly must not strand the installer: the run
        // takes `selected` and walks on exactly as it would have.
        assert.equal((await angryStore.view(run.id)).terminal?.type, EnyoOnboardingV2TargetType.Success);
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
