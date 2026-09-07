/**
 * A mock `EnyoEnergyAppSdk` for the onboarding simulator.
 *
 * The energy app never imports the SDK implementation: `EnergyApp` reads a bare
 * `energyAppSdkInstance` global that the device runtime puts into the package's
 * sandbox (see `device-core-package-worker/src/sandbox/vm-context.ts`). The
 * simulator puts this object there instead.
 *
 * Everything answers empty. That is the entire contract: no device, no network,
 * no storage, no appliances — `[]`, `null` and no-ops all the way down, so an
 * app's onboarding code runs against a system that has nothing in it. What the
 * mock does keep is the onboarding v2 handlers the app registers, because those
 * are the app's real code and the whole reason to boot it.
 *
 * Every call is recorded and streamed to the UI. An app that leans on a call
 * this mock answers with nothing shows up there rather than failing silently.
 */
import {EnyoPackageChannel} from '@enyo-energy/energy-app-sdk';
import type {
    EnyoOnboardingV2AdditionalSetupHandler,
    EnyoOnboardingV2DynamicHandler,
    EnyoOnboardingV2GuidesHandler,
} from '@enyo-energy/energy-app-sdk';
// The SDK's own barrel does not re-export the host-facing interfaces — the
// device runtime imports them by path too (see the package worker's sandbox).
import type {EnergyAppStateEnum, EnyoEnergyAppSdk} from '@enyo-energy/energy-app-sdk/dist/enyo-energy-app-sdk';
import type {EnergyAppInterval, IntervalDuration} from '@enyo-energy/energy-app-sdk/dist/packages/energy-app-interval';
import type {EnergyAppStorage} from '@enyo-energy/energy-app-sdk/dist/packages/energy-app-storage';
import type {EnergyAppOnboardingV2} from '@enyo-energy/energy-app-sdk/dist/packages/energy-app-onboarding-v2';
import type {EnergyAppOcpp} from '@enyo-energy/energy-app-sdk/dist/packages/energy-app-ocpp';
import type {EnergyAppNetworkDevice} from '@enyo-energy/energy-app-sdk/dist/packages/energy-app-network-device';
import type {EnyoNetworkDeviceAccessStatus} from '@enyo-energy/energy-app-sdk/dist/types/enyo-network-device';
import {SIMULATED_NETWORK_DEVICE, simulatedOcppConnectionDetails} from './simulated-world.js';
import type {UseFetchOptions} from '@enyo-energy/energy-app-sdk/dist/types/enyo-fetch';

/** One recorded call from the app into the mock. */
export interface MockSdkCall {
    /** Milliseconds since the mock was created. */
    at: number;
    /** e.g. `useStorage().load` or `updateEnergyAppState`. */
    method: string;
    /** Arguments, JSON-safe and truncated — functions become `[function]`. */
    args: unknown[];
    /** What the mock answered, for the value-returning calls worth showing. */
    result?: unknown;
}

export interface MockSdkOptions {
    /** Fake identity handed to the app's `register` callback. */
    packageName: string;
    packageVersion: number;
    channel: EnyoPackageChannel;
    deviceId: string;
    /**
     * Whether `useFetch()` hands out the real `fetch`.
     *
     * Off by default: a simulated run must not reach a vendor cloud, and an app
     * that needs the network to build its guides has a bug the host would hit
     * too — the guides handler is documented to answer from memory.
     */
    allowNetwork: boolean;
    /** Called for every recorded call. */
    onCall?: (call: MockSdkCall) => void;
}

export const DEFAULT_MOCK_OPTIONS: Omit<MockSdkOptions, 'onCall'> = {
    packageName: 'onboarding-sim',
    packageVersion: 1,
    channel: EnyoPackageChannel.Local,
    deviceId: 'sim-device',
    allowNetwork: false,
};

export type RegisterCallback = (
    packageName: string,
    version: number,
    channel: EnyoPackageChannel,
    deviceId: string
) => void | Promise<void>;

/** What the app registered while it was booting. */
export interface MockSdkState {
    /** The app's `register` callbacks, in registration order. */
    registerCallbacks: RegisterCallback[];
    shutdownCallbacks: (() => void | Promise<void>)[];
    guidesHandler?: EnyoOnboardingV2GuidesHandler;
    dynamicHandler?: EnyoOnboardingV2DynamicHandler;
    additionalSetupHandler?: EnyoOnboardingV2AdditionalSetupHandler;
    /** The app's last `updateEnergyAppState`, if it set one. */
    energyAppState?: EnergyAppStateEnum;
    /** `completeOnboardingRun` and friends the app asked for. */
    runActions: { action: string; args: unknown[] }[];
    calls: MockSdkCall[];
}

export interface MockSdk {
    /** The object that goes into the sandbox as `energyAppSdkInstance`. */
    instance: EnyoEnergyAppSdk;
    state: MockSdkState;
    options: MockSdkOptions;
}

/** Arguments as they go into the log: no functions, no cycles, nothing huge. */
const describeValue = (value: unknown): unknown => {
    if (typeof value === 'function') {
        return '[function]';
    }
    try {
        const json = JSON.stringify(value);
        if (json === undefined) {
            return String(value);
        }
        return json.length > 500 ? `${json.slice(0, 500)}…` : (JSON.parse(json) as unknown);
    } catch {
        return String(value);
    }
};

export const createMockSdk = (options: Partial<MockSdkOptions> = {}): MockSdk => {
    const config: MockSdkOptions = {...DEFAULT_MOCK_OPTIONS, ...options};
    const startedAt = Date.now();

    const state: MockSdkState = {
        registerCallbacks: [],
        shutdownCallbacks: [],
        runActions: [],
        calls: [],
    };

    const record = (method: string, args: unknown[], result?: unknown): void => {
        const call: MockSdkCall = {
            at: Date.now() - startedAt,
            method,
            args: args.map(describeValue),
            result: result === undefined ? undefined : describeValue(result),
        };
        state.calls.push(call);
        config.onCall?.(call);
    };

    /**
     * A package stub: the hand-written methods that matter, and an empty answer
     * for every other method the interface has.
     *
     * The fallback resolves to `[]` because the SDK's package methods are almost
     * all promise-returning, and an empty list is the honest "there is nothing
     * here" for the ones that return collections. A synchronous method that is
     * not overridden here therefore hands back a promise — the call shows up in
     * the log, which is where an app that needs a real answer becomes visible.
     */
    const emptyPackage = <T extends object>(name: string, overrides: Partial<T> = {}): T =>
        new Proxy(overrides, {
            get: (target, property, receiver) => {
                if (property in target) {
                    return Reflect.get(target, property, receiver) as unknown;
                }
                // Never look like a thenable: `await sdk.useX()` must not hang.
                if (typeof property === 'symbol' || property === 'then') {
                    return undefined;
                }
                return (...args: unknown[]) => {
                    record(`${name}.${property}`, args, []);
                    return Promise.resolve([]);
                };
            },
        }) as T;

    const storage = new Map<string, object>();

    const storageStub = emptyPackage<EnergyAppStorage>('useStorage()', {
        save: async (key: string, value: object) => {
            record('useStorage().save', [key, value]);
            storage.set(key, value);
        },
        load: async <T>(key: string) => {
            const value = (storage.get(key) ?? null) as T | null;
            record('useStorage().load', [key], value);
            return value;
        },
        remove: async (key: string) => {
            record('useStorage().remove', [key]);
            storage.delete(key);
        },
        listKeys: async () => {
            const keys = [...storage.keys()];
            record('useStorage().listKeys', [], keys);
            return keys;
        },
    });

    const intervalStub = emptyPackage<EnergyAppInterval>('useInterval()', {
        // Intervals are swallowed: the app is booted to answer a handful of
        // handler calls, and a polling loop left running would keep the process
        // busy long after the browser tab is closed.
        createInterval: (duration: IntervalDuration, callback: (clockId: string) => void | Promise<void>) => {
            const id = `sim-interval-${state.calls.length}`;
            record('useInterval().createInterval', [duration, callback], id);
            return id;
        },
        stopInterval: (intervalId: string) => {
            record('useInterval().stopInterval', [intervalId]);
        },
    });

    /**
     * The one device the simulated LAN has.
     *
     * An empty list here would be defensible — nothing is really out there — but
     * it makes every guide that reads an address untestable, and an app that
     * looks its device up by the id the host handed it would get `null` for an
     * id the host itself supplied. Whether a *run* has a device is decided by
     * its start variant, not by this list.
     */
    const ocppStub = emptyPackage<EnergyAppOcpp>('useOcpp()', {
        getAvailableConnectionDetails: async () => {
            const details = simulatedOcppConnectionDetails();
            record('useOcpp().getAvailableConnectionDetails', [], details);
            return details;
        },
        // Sync methods: the generic fallback hands back a promise, which is the
        // wrong shape for the ones an app reads inline.
        getConnectedChargePoints: () => {
            record('useOcpp().getConnectedChargePoints', [], []);
            return [];
        },
        getChargePoint: (chargePointId: string) => {
            record('useOcpp().getChargePoint', [chargePointId], undefined);
            return undefined;
        },
        registerHandler: (action, handler, version) => {
            const id = `sim-ocpp-handler-${state.calls.length}`;
            record('useOcpp().registerHandler', [action, handler, version], id);
            return id;
        },
        listenForChargePointConnected: listener => {
            const id = `sim-ocpp-connect-listener-${state.calls.length}`;
            record('useOcpp().listenForChargePointConnected', [listener], id);
            return id;
        },
        listenForChargePointDisconnected: listener => {
            const id = `sim-ocpp-disconnect-listener-${state.calls.length}`;
            record('useOcpp().listenForChargePointDisconnected', [listener], id);
            return id;
        },
        disconnectChargePoint: (chargePointId: string, reason?: string) => {
            record('useOcpp().disconnectChargePoint', [chargePointId, reason]);
        },
        unsubscribe: (id: string) => {
            record('useOcpp().unsubscribe', [id]);
        },
    });

    const networkDeviceStub = emptyPackage<EnergyAppNetworkDevice>('useNetworkDevices()', {
        getDevices: async (filter?: {accessStatus?: EnyoNetworkDeviceAccessStatus}) => {
            const devices =
                filter?.accessStatus && filter.accessStatus !== SIMULATED_NETWORK_DEVICE.accessStatus
                    ? []
                    : [SIMULATED_NETWORK_DEVICE];
            record('useNetworkDevices().getDevices', [filter], devices);
            return devices;
        },
        getDevice: async (deviceId: string) => {
            const device = deviceId === SIMULATED_NETWORK_DEVICE.id ? SIMULATED_NETWORK_DEVICE : null;
            record('useNetworkDevices().getDevice', [deviceId], device);
            return device;
        },
        searchDevices: async () => {
            record('useNetworkDevices().searchDevices', [], [SIMULATED_NETWORK_DEVICE]);
            return [SIMULATED_NETWORK_DEVICE];
        },
        // Access is granted: a simulated run must not stall on a permission
        // dialog that only exists in the app.
        requestDeviceAccess: async (deviceId: string, ports?: number[]) => {
            const answer = {status: 'granted' as EnyoNetworkDeviceAccessStatus};
            record('useNetworkDevices().requestDeviceAccess', [deviceId, ports], answer);
            return answer;
        },
        listenForDeviceAccessChange: listener => {
            const id = `sim-access-listener-${state.calls.length}`;
            record('useNetworkDevices().listenForDeviceAccessChange', [listener], id);
            return id;
        },
        listenForDetectedDevice: listener => {
            const id = `sim-detected-listener-${state.calls.length}`;
            record('useNetworkDevices().listenForDetectedDevice', [listener], id);
            return id;
        },
        listenForNetworkDeviceRemoved: listener => {
            const id = `sim-removed-listener-${state.calls.length}`;
            record('useNetworkDevices().listenForNetworkDeviceRemoved', [listener], id);
            return id;
        },
        removeListener: (listenerId: string) => {
            record('useNetworkDevices().removeListener', [listenerId]);
        },
    });

    const onboardingV2Stub = emptyPackage<EnergyAppOnboardingV2>('useOnboardingV2()', {
        registerOnboardingGuidesHandler: async (handler: EnyoOnboardingV2GuidesHandler) => {
            record('useOnboardingV2().registerOnboardingGuidesHandler', [handler]);
            state.guidesHandler = handler;
        },
        deregisterOnboardingGuidesHandler: async () => {
            record('useOnboardingV2().deregisterOnboardingGuidesHandler', []);
            state.guidesHandler = undefined;
        },
        registerDynamicValueHandler: async (handler: EnyoOnboardingV2DynamicHandler) => {
            record('useOnboardingV2().registerDynamicValueHandler', [handler]);
            state.dynamicHandler = handler;
        },
        deregisterDynamicValueHandler: async () => {
            record('useOnboardingV2().deregisterDynamicValueHandler', []);
            state.dynamicHandler = undefined;
        },
        registerAdditionalSetupHandler: async (handler: EnyoOnboardingV2AdditionalSetupHandler) => {
            record('useOnboardingV2().registerAdditionalSetupHandler', [handler]);
            state.additionalSetupHandler = handler;
        },
        deregisterAdditionalSetupHandler: async () => {
            record('useOnboardingV2().deregisterAdditionalSetupHandler', []);
            state.additionalSetupHandler = undefined;
        },
        refreshOnboardingGuides: async () => {
            record('useOnboardingV2().refreshOnboardingGuides', []);
            state.runActions.push({action: 'refreshOnboardingGuides', args: []});
        },
        removeOnboardingGuide: async (name: string) => {
            record('useOnboardingV2().removeOnboardingGuide', [name]);
            state.runActions.push({action: 'removeOnboardingGuide', args: [name]});
        },
        completeOnboardingRun: async (name, selector) => {
            record('useOnboardingV2().completeOnboardingRun', [name, selector]);
            state.runActions.push({
                action: 'completeOnboardingRun',
                args: [name, selector].map(describeValue),
            });
        },
        removeOnboardingRun: async (name, selector) => {
            record('useOnboardingV2().removeOnboardingRun', [name, selector]);
            state.runActions.push({
                action: 'removeOnboardingRun',
                args: [name, selector].map(describeValue),
            });
        },
    });

    /** A `use*()` accessor that is nothing but an empty package. */
    const packageAccessor = <T extends object>(name: string): (() => T) => {
        const stub = emptyPackage<T>(`${name}()`);
        return () => {
            record(name, []);
            return stub;
        };
    };

    const blockedFetch = (async (input: unknown) => {
        const url = typeof input === 'string' ? input : String((input as {url?: string}).url ?? input);
        record('useFetch()', [url], 'blocked');
        throw new Error(
            `Network access is blocked in the onboarding simulator (tried ${url}). ` +
            'Start it with --allow-network to let the app talk to the outside world.'
        );
    }) as typeof fetch;

    const instance: EnyoEnergyAppSdk = {
        register: (callback: RegisterCallback) => {
            record('register', [callback]);
            state.registerCallbacks.push(callback);
        },
        healthcheck: () => new Date(),
        onShutdown: (callback: () => void | Promise<void>) => {
            record('onShutdown', [callback]);
            state.shutdownCallbacks.push(callback);
        },
        updateEnergyAppState: (appState: EnergyAppStateEnum) => {
            record('updateEnergyAppState', [appState]);
            state.energyAppState = appState;
        },
        isSystemOnline: () => {
            record('isSystemOnline', [], true);
            return true;
        },
        onNetworkStatusChanged: (listener: (online: boolean) => void | Promise<void>) => {
            const id = `sim-network-listener-${state.calls.length}`;
            record('onNetworkStatusChanged', [listener], id);
            return id;
        },
        useFetch: (fetchOptions?: UseFetchOptions) => {
            record('useFetch', [fetchOptions]);
            return config.allowNetwork ? fetch : blockedFetch;
        },
        useInterval: () => {
            record('useInterval', []);
            return intervalStub;
        },
        useStorage: () => {
            record('useStorage', []);
            return storageStub;
        },
        useOnboardingV2: () => {
            record('useOnboardingV2', []);
            return onboardingV2Stub;
        },
        useModbus: packageAccessor('useModbus'),
        useNetworkDevices: () => {
            record('useNetworkDevices', []);
            return networkDeviceStub;
        },
        useAppliances: packageAccessor('useAppliances'),
        useDataBus: packageAccessor('useDataBus'),
        useOcpp: () => {
            record('useOcpp', []);
            return ocppStub;
        },
        useCharge: packageAccessor('useCharge'),
        useVehicle: packageAccessor('useVehicle'),
        useChargingCard: packageAccessor('useChargingCard'),
        useAuthentication: packageAccessor('useAuthentication'),
        useSettings: packageAccessor('useSettings'),
        useElectricityPrices: packageAccessor('useElectricityPrices'),
        useNotification: packageAccessor('useNotification'),
        useSecretManager: packageAccessor('useSecretManager'),
        useLocation: packageAccessor('useLocation'),
        useOnboarding: packageAccessor('useOnboarding'),
        useTimeseries: packageAccessor('useTimeseries'),
        useEnergyManager: packageAccessor('useEnergyManager'),
        useElectricityTariff: packageAccessor('useElectricityTariff'),
        useWeatherForecasting: packageAccessor('useWeatherForecasting'),
        usePvForecasting: packageAccessor('usePvForecasting'),
        useDynamicPriceForecast: packageAccessor('useDynamicPriceForecast'),
        usePvSystem: packageAccessor('usePvSystem'),
        useSequenceGenerator: packageAccessor('useSequenceGenerator'),
        useModbusRtu: packageAccessor('useModbusRtu'),
        useModbusServer: packageAccessor('useModbusServer'),
        useEebus: packageAccessor('useEebus'),
        useMqtt: packageAccessor('useMqtt'),
        useBluetooth: packageAccessor('useBluetooth'),
        useDiagnostics: packageAccessor('useDiagnostics'),
        useLearningPhase: packageAccessor('useLearningPhase'),
        useWifi: packageAccessor('useWifi'),
        useUdp: packageAccessor('useUdp'),
        useGridConnectionPoint: packageAccessor('useGridConnectionPoint'),
        useConfigurationManager: packageAccessor('useConfigurationManager'),
        useApplianceEnergyManagerForecast: packageAccessor('useApplianceEnergyManagerForecast'),
        useBatteries: packageAccessor('useBatteries'),
        useFiles: packageAccessor('useFiles'),
        useFirmwareRegistry: packageAccessor('useFirmwareRegistry'),
        useAutomations: packageAccessor('useAutomations'),
        useSavings: packageAccessor('useSavings'),
        useDeviceTest: packageAccessor('useDeviceTest'),
        useEpexSpotPrices: packageAccessor('useEpexSpotPrices'),
        useGridFee: packageAccessor('useGridFee'),
        useCommandLog: packageAccessor('useCommandLog'),
    };

    return {instance, state, options: config};
};
