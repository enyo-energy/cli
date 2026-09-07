/**
 * The one fake world the simulator runs in.
 *
 * Most of the mock SDK answers empty, which is the honest answer for "what is on
 * this system" — nothing is. Two things cannot be empty without making an
 * onboarding flow untestable, because they are what an installer is asked to
 * *read off the screen and type into a device*: the OCPP endpoint and the
 * device's address. A guide whose whole point is "enter this URL in your
 * wallbox" shows an empty box otherwise.
 *
 * Everything here is invented but shaped exactly like the real thing:
 *
 * - the connection details mirror what the hub sends an app that calls
 *   `useOcpp().getAvailableConnectionDetails()`
 *   (`device-core-app/src/domain/ocpp/ocpp.service.ts#handleGetOcppConnectionDetails`),
 * - the cloud URL mirrors what the cloud builds for a `dynamic` block
 *   (`api/src/onboarding-runtime/ocpp-url.builder.ts`): `wss://<api
 *   host>/ocpp/<deviceSlug>/<packageSlug>`, the charger appending its own id.
 *
 * The addresses are documentation-safe: `192.168.178.x` is a private LAN, and
 * the cloud host is enyo's real API host because that is what an installer would
 * genuinely be given — nothing here is dialled by the simulator.
 */
import type {EnyoOcppAvailableConnectionDetails} from '@enyo-energy/energy-app-sdk/dist/packages/energy-app-ocpp';
import type {EnyoNetworkDevice} from '@enyo-energy/energy-app-sdk/dist/types/enyo-network-device';
import {EnyoNetworkDeviceDetectedAtEnum} from '@enyo-energy/energy-app-sdk/dist/types/enyo-network-device.js';

/** The simulated enyo hub — the thing the app runs on. */
export const SIMULATED_HUB = {
    /** The hub's own address on the LAN, which the local OCPP URL points at. */
    ipAddress: '192.168.178.10',
    /** The hub's slug in a cloud URL — the cloud routes a charger on it. */
    deviceSlug: 'sim-hub',
    /**
     * The app's OCPP slug. The hub mints one the first time an app asks for its
     * connection details, so an app that never asked has no URL at all — here it
     * always exists, because a run that cannot show the URL cannot be walked.
     */
    packageSlug: 'sim-app',
    cloud: {
        host: 'api.enyo-energy.de',
        port: 443,
        secure: true,
    },
} as const;

/** The device the scan "found" — the one a `device-found-config` run carries. */
export const SIMULATED_NETWORK_DEVICE: EnyoNetworkDevice = {
    id: 'sim-network-device',
    hostname: 'sim-wallbox.local',
    ipAddress: '192.168.178.42',
    macAddress: '02:00:5E:10:00:2A',
    isOnline: true,
    // A fixed date: a run walked twice must look the same both times.
    lastSeen: new Date('2025-01-01T12:00:00.000Z'),
    accessStatus: 'granted',
    detectedAt: [EnyoNetworkDeviceDetectedAtEnum.Mdns, EnyoNetworkDeviceDetectedAtEnum.Modbus],
    ports: [
        {port: 80, service: 'http'},
        {port: 502, service: 'modbus'},
    ],
};

/**
 * What the hub would tell an app asking where its chargers should dial in.
 *
 * Both halves are present, which is the interesting case: an app has to choose
 * which one an installer gets, and the simulator is where that choice becomes
 * visible.
 */
export const simulatedOcppConnectionDetails = (): EnyoOcppAvailableConnectionDetails => {
    const {cloud, deviceSlug, packageSlug, ipAddress} = SIMULATED_HUB;
    return {
        cloud: {
            url: `${cloud.secure ? 'wss' : 'ws'}://${cloud.host}/ocpp/${deviceSlug}/${packageSlug}`,
            path: `/ocpp/${deviceSlug}/${packageSlug}`,
            host: cloud.host,
            port: cloud.port,
            secure: cloud.secure,
        },
        local: {
            url: `ws://${ipAddress}/ocpp/${packageSlug}`,
            path: `/ocpp/${packageSlug}`,
            host: ipAddress,
            port: 80,
            secure: false,
        },
    };
};

/**
 * The URL the *host* puts behind an `ocpp-url` block when the app does not
 * answer — the cloud one, as `DynamicResolverService` resolves it.
 */
export const simulatedOcppUrl = (): string => simulatedOcppConnectionDetails().cloud!.url;
