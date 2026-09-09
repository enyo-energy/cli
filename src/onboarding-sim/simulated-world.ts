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
import type {EnyoOnboardingV2EebusPeer} from '@enyo-energy/energy-app-sdk';
import {EnyoEebusDeviceTypeEnum} from '@enyo-energy/energy-app-sdk';

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

/**
 * The other devices the scan "found".
 *
 * One device was enough while nothing picked between them; a
 * {@link EnyoOnboardingV2DeviceSelectBlock} is a screen whose whole point is
 * telling one entry from another, and a list of one can only ever demonstrate
 * the skip. Three, with different `detectedAt` channels, make both halves of a
 * `detectedAt` filter visible: a filter that leaves two candidates renders the
 * picker, one that leaves a single candidate skips it.
 */
export const SIMULATED_NETWORK_DEVICES: EnyoNetworkDevice[] = [
    SIMULATED_NETWORK_DEVICE,
    {
        id: 'sim-network-device-inverter',
        hostname: 'sim-inverter.local',
        ipAddress: '192.168.178.43',
        macAddress: '02:00:5E:10:00:2B',
        isOnline: true,
        lastSeen: new Date('2025-01-01T12:00:00.000Z'),
        accessStatus: 'granted',
        detectedAt: [EnyoNetworkDeviceDetectedAtEnum.Modbus],
        ports: [{port: 502, service: 'modbus'}],
    },
    {
        id: 'sim-network-device-heatpump',
        hostname: 'sim-heatpump.local',
        ipAddress: '192.168.178.44',
        macAddress: '02:00:5E:10:00:2C',
        isOnline: true,
        lastSeen: new Date('2025-01-01T12:00:00.000Z'),
        accessStatus: 'granted',
        detectedAt: [EnyoNetworkDeviceDetectedAtEnum.Eebus, EnyoNetworkDeviceDetectedAtEnum.Mdns],
        ports: [{port: 4712, service: 'ship'}],
    },
];

/**
 * The devices a `device-select` block offers, after its `detectedAt` filter.
 *
 * Mirrors the host: the filter is a list and so is
 * {@link EnyoNetworkDevice.detectedAt}, so a device seen over both mDNS and
 * Modbus matches a filter naming either. A device detected through no channel at
 * all cannot match a filter that names one, so it is left out — the same rule
 * the EEBUS picker applies to a peer that announced no type.
 */
export const simulatedDevicesFor = (detectedAt?: EnyoNetworkDeviceDetectedAtEnum[]): EnyoNetworkDevice[] => {
    if (!detectedAt) {
        return SIMULATED_NETWORK_DEVICES;
    }
    const wanted = new Set<EnyoNetworkDeviceDetectedAtEnum>(detectedAt);
    return SIMULATED_NETWORK_DEVICES.filter(device => device.detectedAt?.some(channel => wanted.has(channel)));
};

/**
 * The EEBUS peers the simulated LAN announces — the list an
 * `eebus-device-select` block picks from.
 *
 * A peer is not an {@link EnyoNetworkDevice}: it is addressed by its SKI, and
 * what an app builds an appliance from — the SKI and the announced device type —
 * has no counterpart in a network device. The last one deliberately announces no
 * type, because that is the case a `deviceTypes` filter must exclude rather than
 * wave through.
 */
export const SIMULATED_EEBUS_PEERS: EnyoOnboardingV2EebusPeer[] = [
    {
        ski: '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
        deviceName: 'Sim Wärmepumpe',
        deviceModel: 'sim-heatpump-1',
        deviceType: EnyoEebusDeviceTypeEnum.HeatPumpAppliance,
        host: '192.168.178.44',
        port: 4712,
    },
    {
        ski: '1122334455667788990011223344556677889900',
        deviceName: 'Sim Wallbox',
        deviceModel: 'sim-evse-1',
        deviceType: EnyoEebusDeviceTypeEnum.Evse,
        host: '192.168.178.42',
        port: 4712,
    },
    {
        ski: 'ffeeddccbbaa99887766554433221100ffeeddcc',
        deviceName: 'Sim Fremdgerät',
        host: '192.168.178.45',
        port: 4712,
    },
];

/**
 * The peers an `eebus-device-select` block offers, after its `deviceTypes`
 * filter.
 *
 * A peer that announced nothing — or a type this SDK does not know — is treated
 * as *some other type*: it survives an omitted filter and is excluded by any
 * filter present, so a guide can never pair something it did not ask for.
 */
export const simulatedEebusPeersFor = (deviceTypes?: EnyoEebusDeviceTypeEnum[]): EnyoOnboardingV2EebusPeer[] => {
    if (!deviceTypes) {
        return SIMULATED_EEBUS_PEERS;
    }
    const wanted = new Set<EnyoEebusDeviceTypeEnum>(deviceTypes);
    return SIMULATED_EEBUS_PEERS.filter(peer => peer.deviceType !== undefined && wanted.has(peer.deviceType));
};
