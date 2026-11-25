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
import {EnyoEnergyAppEnvironment, EnyoPackageChannel} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppConsent,
    EnergyAppPackageConsent,
    EnyoConsentChangeListener,
    EnyoConsentGrantorEnum,
    EnyoConsentState,
    EnyoOnboardingV2AdditionalSetupHandler,
    EnyoOnboardingV2DeviceSelectHandler,
    EnyoOnboardingV2DynamicHandler,
    EnyoOnboardingV2EebusDeviceSelectHandler,
    EnyoOnboardingV2GuidesHandler,
    EnyoOnboardingV2SetupProgress,
    EnyoOnboardingV2ValidationHandler,
    EnyoOnboardingV2ZigbeePairingHandler,
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
import type {EnergyAppEebus} from '@enyo-energy/energy-app-sdk/dist/packages/eebus/energy-app-eebus';
import type {EebusDeviceManagement} from '@enyo-energy/energy-app-sdk/dist/packages/eebus/eebus-device-management';
import type {EebusIdentityService} from '@enyo-energy/energy-app-sdk/dist/packages/eebus/eebus-identity-service';
import type {EebusFeatureCatalog} from '@enyo-energy/energy-app-sdk/dist/packages/eebus/eebus-feature-catalog';
import type {EebusUseCaseRegistry} from '@enyo-energy/energy-app-sdk/dist/packages/eebus/eebus-use-case-registry';
import type {EebusSpineLowLevel} from '@enyo-energy/energy-app-sdk/dist/packages/eebus/eebus-spine-low-level';
import {SIMULATED_NETWORK_DEVICES, simulatedOcppConnectionDetails} from './simulated-world.js';
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
     * The runtime the app is told it is running in. The simulator has no
     * hardware behind it, so an app that skips real device access under
     * {@link EnyoEnergyAppEnvironment.DeveloperPortalSimulation} must take that
     * branch here too.
     */
    environment: EnyoEnergyAppEnvironment;
    /**
     * Whether `useFetch()` hands out the real `fetch`.
     *
     * Off by default: a simulated run must not reach a vendor cloud, and an app
     * that needs the network to build its guides has a bug the host would hit
     * too — the guides handler is documented to answer from memory.
     */
    allowNetwork: boolean;
    /**
     * The consents the package definition declares. `useConsent()` answers one
     * state per declared consent — none given until the simulator ticks one.
     */
    consents: EnergyAppPackageConsent[];
    /** Called for every recorded call. */
    onCall?: (call: MockSdkCall) => void;
}

export const DEFAULT_MOCK_OPTIONS: Omit<MockSdkOptions, 'onCall'> = {
    packageName: 'onboarding-sim',
    packageVersion: 1,
    channel: EnyoPackageChannel.Local,
    deviceId: 'sim-device',
    environment: EnyoEnergyAppEnvironment.DeveloperPortalSimulation,
    allowNetwork: false,
    consents: [],
};

export type RegisterCallback = (
    packageName: string,
    version: number,
    channel: EnyoPackageChannel,
    deviceId: string,
    environment: EnyoEnergyAppEnvironment
) => void | Promise<void>;

/** What the app registered while it was booting. */
export interface MockSdkState {
    /** The app's `register` callbacks, in registration order. */
    registerCallbacks: RegisterCallback[];
    shutdownCallbacks: (() => void | Promise<void>)[];
    guidesHandler?: EnyoOnboardingV2GuidesHandler;
    dynamicHandler?: EnyoOnboardingV2DynamicHandler;
    additionalSetupHandler?: EnyoOnboardingV2AdditionalSetupHandler;
    /** Turns the devices an installer picked into appliances. */
    deviceSelectHandler?: EnyoOnboardingV2DeviceSelectHandler;
    /** The EEBUS counterpart — a peer is not a network device, so it is a handler of its own. */
    eebusDeviceSelectHandler?: EnyoOnboardingV2EebusDeviceSelectHandler;
    /** The Zigbee counterpart: turns the devices an installer paired into appliances. */
    zigbeePairingHandler?: EnyoOnboardingV2ZigbeePairingHandler;
    /** Checks a value typed into an input block declared `validated`. */
    inputValidationHandler?: EnyoOnboardingV2ValidationHandler;
    /**
     * Where `reportSetupProgress()` reports go. Set by the run store while a
     * setup request is running; a report with nobody listening is recorded and
     * otherwise dropped, as the host drops one for a finished request.
     */
    onSetupProgress?: (requestId: string, progress: EnyoOnboardingV2SetupProgress) => void;
    /** The recorded answer per declared consent, in declaration order. */
    consentStates: EnyoConsentState[];
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
    /**
     * Record an answer to a declared consent, as enyo would after a person
     * pressed a consent CTA (or withdrew it in the app), and tell the app's
     * `listenForConsentChanges` listeners. Returns `null` for an undeclared key.
     */
    setConsent: (consentKey: string, granted: boolean, grantedBy?: EnyoConsentGrantorEnum) => EnyoConsentState | null;
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
        // Never answered: no version, not granted — what a fresh install reads.
        consentStates: config.consents.map(consent => ({consentKey: consent.consentKey, granted: false})),
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
            const devices = filter?.accessStatus
                ? SIMULATED_NETWORK_DEVICES.filter(device => device.accessStatus === filter.accessStatus)
                : SIMULATED_NETWORK_DEVICES;
            record('useNetworkDevices().getDevices', [filter], devices);
            return devices;
        },
        getDevice: async (deviceId: string) => {
            const device = SIMULATED_NETWORK_DEVICES.find(candidate => candidate.id === deviceId) ?? null;
            record('useNetworkDevices().getDevice', [deviceId], device);
            return device;
        },
        searchDevices: async () => {
            record('useNetworkDevices().searchDevices', [], SIMULATED_NETWORK_DEVICES);
            return SIMULATED_NETWORK_DEVICES;
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
        reportSetupProgress: async (requestId: string, progress: EnyoOnboardingV2SetupProgress) => {
            record('useOnboardingV2().reportSetupProgress', [requestId, progress]);
            state.onSetupProgress?.(requestId, progress);
        },
        registerInputValidationHandler: async (handler: EnyoOnboardingV2ValidationHandler) => {
            record('useOnboardingV2().registerInputValidationHandler', [handler]);
            state.inputValidationHandler = handler;
        },
        deregisterInputValidationHandler: async () => {
            record('useOnboardingV2().deregisterInputValidationHandler', []);
            state.inputValidationHandler = undefined;
        },
        registerZigbeePairingHandler: async (handler: EnyoOnboardingV2ZigbeePairingHandler) => {
            record('useOnboardingV2().registerZigbeePairingHandler', [handler]);
            state.zigbeePairingHandler = handler;
        },
        deregisterZigbeePairingHandler: async () => {
            record('useOnboardingV2().deregisterZigbeePairingHandler', []);
            state.zigbeePairingHandler = undefined;
        },
        registerDeviceSelectHandler: async (handler: EnyoOnboardingV2DeviceSelectHandler) => {
            record('useOnboardingV2().registerDeviceSelectHandler', [handler]);
            state.deviceSelectHandler = handler;
        },
        deregisterDeviceSelectHandler: async () => {
            record('useOnboardingV2().deregisterDeviceSelectHandler', []);
            state.deviceSelectHandler = undefined;
        },
        registerEebusDeviceSelectHandler: async (handler: EnyoOnboardingV2EebusDeviceSelectHandler) => {
            record('useOnboardingV2().registerEebusDeviceSelectHandler', [handler]);
            state.eebusDeviceSelectHandler = handler;
        },
        deregisterEebusDeviceSelectHandler: async () => {
            record('useOnboardingV2().deregisterEebusDeviceSelectHandler', []);
            state.eebusDeviceSelectHandler = undefined;
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

    /**
     * `useEebus()` is the one package whose surface is not flat: it hands out
     * five sub-objects rather than methods. The generic fallback would answer
     * `devices` with a function, so an app that reaches straight through —
     * `useEebus().devices.listenForConnectionStatusChange(...)` — dies with a
     * TypeError before any of its onboarding code runs.
     *
     * Only the synchronous members are written out. Everything else is a
     * promise on the real interface too, which is exactly what the fallback
     * hands back.
     */
    const listenerId = (kind: string): string => `sim-eebus-${kind}-listener-${state.calls.length}`;

    const eebusDevicesStub = emptyPackage<EebusDeviceManagement>('useEebus().devices', {
        listenForConnectionStatusChange: listener => {
            const id = listenerId('connection-status');
            record('useEebus().devices.listenForConnectionStatusChange', [listener], id);
            return id;
        },
        removeListener: (id: string) => {
            record('useEebus().devices.removeListener', [id]);
        },
    });

    const eebusIdentityStub = emptyPackage<EebusIdentityService>('useEebus().identity', {
        onIdentityChanged: (ski, listener) => {
            const id = listenerId('identity');
            record('useEebus().identity.onIdentityChanged', [ski, listener], id);
            return id;
        },
        removeListener: (id: string) => {
            record('useEebus().identity.removeListener', [id]);
        },
    });

    const eebusFeaturesStub = emptyPackage<EebusFeatureCatalog>('useEebus().features', {
        onFeaturesChanged: (ski, listener) => {
            const id = listenerId('features');
            record('useEebus().features.onFeaturesChanged', [ski, listener], id);
            return id;
        },
        removeListener: (id: string) => {
            record('useEebus().features.removeListener', [id]);
        },
    });

    const eebusSpineStub = emptyPackage<EebusSpineLowLevel>('useEebus().spine', {
        subscribe: (ski, featureType, listener, target) => {
            const id = listenerId('spine');
            record('useEebus().spine.subscribe', [ski, featureType, listener, target], id);
            return id;
        },
        removeListener: (id: string) => {
            record('useEebus().spine.removeListener', [id]);
        },
    });

    /**
     * Every registry method is a synchronous factory for a typed use-case
     * client, so the fallback's promise is the wrong shape everywhere here: the
     * whole object is a proxy that hands back an empty client instead.
     */
    const eebusUseCasesStub = new Proxy({} as EebusUseCaseRegistry, {
        get: (target, property) => {
            if (typeof property === 'symbol' || property === 'then') {
                return undefined;
            }
            return (...args: unknown[]) => {
                record(`useEebus().useCases.${property}`, args);
                return emptyPackage(`useEebus().useCases.${property}()`);
            };
        },
    });

    const eebusStub: EnergyAppEebus = {
        devices: eebusDevicesStub,
        identity: eebusIdentityStub,
        features: eebusFeaturesStub,
        useCases: eebusUseCasesStub,
        spine: eebusSpineStub,
    };

    /**
     * Consents are recorded by the host, never by the app, so the stub only
     * reads: the simulator ticks a consent through {@link MockSdk.setConsent}
     * — from a consent block, an additional setup's checkboxes, or the
     * inspector — and the app hears about it like it would on a device.
     */
    const consentListeners = new Map<string, EnyoConsentChangeListener>();
    const copyState = (consentState: EnyoConsentState): EnyoConsentState => ({...consentState});

    const consentStub: EnergyAppConsent = {
        getConsents: async () => {
            const states = state.consentStates.map(copyState);
            record('useConsent().getConsents', [], states);
            return states;
        },
        getConsent: async (consentKey: string) => {
            const found = state.consentStates.find(entry => entry.consentKey === consentKey);
            const answer = found ? copyState(found) : null;
            record('useConsent().getConsent', [consentKey], answer);
            return answer;
        },
        listenForConsentChanges: (listener: EnyoConsentChangeListener) => {
            const id = `sim-consent-listener-${state.calls.length}`;
            record('useConsent().listenForConsentChanges', [listener], id);
            consentListeners.set(id, listener);
            return id;
        },
        removeListener: (id: string) => {
            record('useConsent().removeListener', [id]);
            consentListeners.delete(id);
        },
    };

    const setConsent = (
        consentKey: string,
        granted: boolean,
        grantedBy?: EnyoConsentGrantorEnum
    ): EnyoConsentState | null => {
        const declared = config.consents.find(consent => consent.consentKey === consentKey);
        const index = state.consentStates.findIndex(entry => entry.consentKey === consentKey);
        if (!declared || index < 0) {
            return null;
        }
        const previous = state.consentStates[index];
        const now = new Date().toISOString();
        const next: EnyoConsentState = granted
            ? {consentKey, version: declared.version, granted: true, grantedBy, grantedAtIso: now}
            // A withdrawn consent keeps who gave it and when; one never given stays bare.
            : previous.granted
              ? {...previous, granted: false, revokedAtIso: now}
              : {consentKey, granted: false};
        state.consentStates[index] = next;
        if (previous.granted !== next.granted) {
            for (const listener of consentListeners.values()) {
                // Fire and forget, as the host does: a throwing listener is the app's problem.
                Promise.resolve()
                    .then(() => listener(copyState(next)))
                    .catch(() => undefined);
            }
        }
        return copyState(next);
    };

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
        useAuthenticationV2: packageAccessor('useAuthenticationV2'),
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
        useWeatherHistory: packageAccessor('useWeatherHistory'),
        usePvForecasting: packageAccessor('usePvForecasting'),
        useDynamicPriceForecast: packageAccessor('useDynamicPriceForecast'),
        usePvSystem: packageAccessor('usePvSystem'),
        useSequenceGenerator: packageAccessor('useSequenceGenerator'),
        useModbusRtu: packageAccessor('useModbusRtu'),
        useModbusServer: packageAccessor('useModbusServer'),
        useEebus: () => {
            record('useEebus', []);
            return eebusStub;
        },
        useMqtt: packageAccessor('useMqtt'),
        useBluetooth: packageAccessor('useBluetooth'),
        useZigbee: packageAccessor('useZigbee'),
        // No radio and no controller here: an app that checks first takes its
        // "not supported" branch rather than calling into an empty package.
        isZigbeeSupported: async () => {
            record('isZigbeeSupported', [], false);
            return false;
        },
        isMatterSupported: async () => {
            record('isMatterSupported', [], false);
            return false;
        },
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
        useCalibration: packageAccessor('useCalibration'),
        useCascade: packageAccessor('useCascade'),
        useWebhook: packageAccessor('useWebhook'),
        useSubscriptions: packageAccessor('useSubscriptions'),
        useConsent: () => {
            record('useConsent', []);
            return consentStub;
        },
        useRoom: packageAccessor('useRoom'),
        useRoomTemperatures: packageAccessor('useRoomTemperatures'),
        useVacations: packageAccessor('useVacations'),
        useTimeseriesStore: packageAccessor('useTimeseriesStore'),
    };

    return {instance, state, options: config, setConsent};
};
