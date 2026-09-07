import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {EnergyAppStateEnum} from '@enyo-energy/energy-app-sdk/dist/enyo-energy-app-sdk.js';
import {createMockSdk} from './mock-sdk.js';
import {SIMULATED_NETWORK_DEVICE} from './simulated-world.js';

describe('createMockSdk', () => {
    it('answers every unstubbed package method with an empty list', async () => {
        const {instance, state} = createMockSdk();

        assert.deepEqual(await instance.useAppliances().getAppliances(), []);
        assert.deepEqual(await instance.useNetworkDevices().getNetworkDevices(), []);
        assert.ok(state.calls.some(call => call.method === 'useNetworkDevices().getNetworkDevices'));
    });

    it('hands out OCPP connection details in both flavours', async () => {
        const {instance} = createMockSdk();
        const details = await instance.useOcpp().getAvailableConnectionDetails();

        // An installer types one of these into a charger, so both have to be a
        // complete, plausible URL — half a URL is worse than none.
        assert.match(details.cloud!.url, /^wss:\/\/[^/]+\/ocpp\/[^/]+\/[^/]+$/);
        assert.equal(details.cloud!.secure, true);
        assert.match(details.local!.url, /^ws:\/\/\d+\.\d+\.\d+\.\d+\/ocpp\/[^/]+$/);
        assert.equal(details.local!.port, 80);
    });

    it('answers OCPP\'s synchronous reads inline rather than with a promise', () => {
        const {instance} = createMockSdk();
        assert.deepEqual(instance.useOcpp().getConnectedChargePoints(), []);
        assert.equal(instance.useOcpp().getChargePoint('cp-1'), undefined);
    });

    it('serves one device on the simulated LAN, findable by the id the host hands out', async () => {
        const {instance} = createMockSdk();
        const devices = await instance.useNetworkDevices().getDevices();

        assert.equal(devices.length, 1);
        assert.match(devices[0].ipAddress, /^\d+\.\d+\.\d+\.\d+$/);
        assert.equal(
            await instance.useNetworkDevices().getDevice(SIMULATED_NETWORK_DEVICE.id),
            SIMULATED_NETWORK_DEVICE
        );
        assert.equal(await instance.useNetworkDevices().getDevice('someone-else'), null);
    });

    it('filters the device list by access status the way the real one does', async () => {
        const {instance} = createMockSdk();
        assert.equal((await instance.useNetworkDevices().getDevices({accessStatus: 'granted'})).length, 1);
        assert.equal((await instance.useNetworkDevices().getDevices({accessStatus: 'denied'})).length, 0);
    });

    it('grants device access, so a run never stalls on a permission dialog', async () => {
        const {instance} = createMockSdk();
        assert.deepEqual(
            await instance.useNetworkDevices().requestDeviceAccess(SIMULATED_NETWORK_DEVICE.id),
            {status: 'granted'}
        );
    });

    it('keeps the onboarding v2 handlers the app registers', async () => {
        const {instance, state} = createMockSdk();
        const handler = async () => null;

        await instance.useOnboardingV2().registerOnboardingGuidesHandler(handler);
        assert.equal(state.guidesHandler, handler);

        await instance.useOnboardingV2().deregisterOnboardingGuidesHandler();
        assert.equal(state.guidesHandler, undefined);
    });

    it('records the run actions an app asks for', async () => {
        const {instance, state} = createMockSdk();
        await instance.useOnboardingV2().completeOnboardingRun('a-guide', {applianceId: 'appliance-1'});
        assert.deepEqual(state.runActions, [
            {action: 'completeOnboardingRun', args: ['a-guide', {applianceId: 'appliance-1'}]},
        ]);
    });

    it('stores what the app saved so a reload of the same run sees it', async () => {
        const {instance} = createMockSdk();
        await instance.useStorage().save('state', {setupCompleted: true});
        assert.deepEqual(await instance.useStorage().load('state'), {setupCompleted: true});
        assert.deepEqual(await instance.useStorage().listKeys(), ['state']);
        assert.equal(await instance.useStorage().load('never-written'), null);
    });

    it('blocks the network unless the simulator was started with --allow-network', async () => {
        const {instance} = createMockSdk();
        await assert.rejects(
            () => instance.useFetch()('https://example.invalid'),
            /Network access is blocked/
        );
    });

    it('swallows intervals so a booted app does not keep polling', () => {
        const {instance, state} = createMockSdk();
        let ticks = 0;
        instance.useInterval().createInterval('1s', () => {
            ticks += 1;
        });
        assert.equal(ticks, 0);
        assert.ok(state.calls.some(call => call.method === 'useInterval().createInterval'));
    });

    it('keeps the app state the app reported', () => {
        const {instance, state} = createMockSdk();
        instance.updateEnergyAppState(EnergyAppStateEnum.Running);
        assert.equal(state.energyAppState, EnergyAppStateEnum.Running);
    });

    it('never looks like a thenable, so awaiting a package does not hang', async () => {
        const {instance} = createMockSdk();
        const settings = await instance.useSettings();
        assert.equal(typeof settings, 'object');
    });
});
