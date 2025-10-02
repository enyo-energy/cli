import type { ConnectNetworkDevices, NetworkDevice, NetworkPort } from "../../../connect-ems-api/dist/packages/connect-network-devices";

/**
 * Mock implementation of network device discovery for the CLI environment
 * In a real implementation, this would perform actual network scanning and device discovery
 */
export class NetworkDevicesImplementation implements ConnectNetworkDevices {
    private devices: Map<string, NetworkDevice> = new Map();
    private lastScanTime: Date | null = null;

    constructor() {
        // Pre-populate with some mock devices for testing
        this.initializeMockDevices();
    }

    async getDetectedDevices(): Promise<NetworkDevice[]> {
        console.log('NetworkDevices: Getting detected devices');

        // Return all devices that have been discovered
        const devices = Array.from(this.devices.values());

        console.log(`NetworkDevices: Found ${devices.length} detected devices`);
        return devices;
    }

    async getDevice(deviceId: string): Promise<NetworkDevice | null> {
        console.log(`NetworkDevices: Getting device with ID: ${deviceId}`);

        const device = this.devices.get(deviceId) || null;

        if (device) {
            console.log(`NetworkDevices: Found device:`, device);
        } else {
            console.log(`NetworkDevices: Device not found with ID: ${deviceId}`);
        }

        return device;
    }

    async searchDevices(): Promise<NetworkDevice[]> {
        console.log('NetworkDevices: Starting device search...');

        // Simulate network scanning delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulate discovering new devices
        const newDevices = this.generateMockDevices();

        // Add new devices to our collection
        newDevices.forEach(device => {
            this.devices.set(device.id, device);
        });

        this.lastScanTime = new Date();

        const allDevices = Array.from(this.devices.values());
        console.log(`NetworkDevices: Search completed. Found ${allDevices.length} total devices (${newDevices.length} new)`);

        return allDevices;
    }

    private initializeMockDevices(): void {
        const initialDevices: NetworkDevice[] = [
            {
                id: 'device-001',
                name: 'Home Router',
                ipAddress: '192.168.1.1',
                macAddress: '00:11:22:33:44:55',
                deviceType: 'router',
                manufacturer: 'TP-Link',
                isOnline: true,
                lastSeen: new Date(Date.now() - 60000), // 1 minute ago
                ports: [
                    { port: 80, protocol: 'tcp', isOpen: true, service: 'http' },
                    { port: 443, protocol: 'tcp', isOpen: true, service: 'https' },
                    { port: 53, protocol: 'udp', isOpen: true, service: 'dns' }
                ]
            },
            {
                id: 'device-002',
                name: 'Smart Thermostat',
                ipAddress: '192.168.1.100',
                macAddress: '00:AA:BB:CC:DD:EE',
                deviceType: 'thermostat',
                manufacturer: 'Nest',
                isOnline: true,
                lastSeen: new Date(Date.now() - 30000), // 30 seconds ago
                ports: [
                    { port: 80, protocol: 'tcp', isOpen: true, service: 'http' }
                ]
            }
        ];

        initialDevices.forEach(device => {
            this.devices.set(device.id, device);
        });
    }

    private generateMockDevices(): NetworkDevice[] {
        const deviceTypes = ['printer', 'smart-switch', 'camera', 'speaker', 'laptop', 'phone'];
        const manufacturers = ['HP', 'Canon', 'Epson', 'Netgear', 'Cisco', 'Apple', 'Samsung', 'Sonos'];

        const newDevices: NetworkDevice[] = [];
        const numDevices = Math.floor(Math.random() * 3) + 1; // 1-3 new devices

        for (let i = 0; i < numDevices; i++) {
            const deviceId = `device-${Date.now()}-${i}`;
            const deviceType = deviceTypes[Math.floor(Math.random() * deviceTypes.length)];
            const manufacturer = manufacturers[Math.floor(Math.random() * manufacturers.length)];
            const lastOctet = Math.floor(Math.random() * 200) + 50; // 50-249

            const device: NetworkDevice = {
                id: deviceId,
                name: `${manufacturer} ${deviceType}`,
                ipAddress: `192.168.1.${lastOctet}`,
                macAddress: this.generateMacAddress(),
                deviceType,
                manufacturer,
                isOnline: Math.random() > 0.2, // 80% chance online
                lastSeen: new Date(Date.now() - Math.floor(Math.random() * 300000)), // within last 5 minutes
                ports: this.generateRandomPorts()
            };

            newDevices.push(device);
        }

        return newDevices;
    }

    private generateMacAddress(): string {
        const chars = '0123456789ABCDEF';
        const segments = [];

        for (let i = 0; i < 6; i++) {
            let segment = '';
            for (let j = 0; j < 2; j++) {
                segment += chars[Math.floor(Math.random() * chars.length)];
            }
            segments.push(segment);
        }

        return segments.join(':');
    }

    private generateRandomPorts(): NetworkPort[] {
        const commonPorts = [
            { port: 80, protocol: 'tcp' as const, service: 'http' },
            { port: 443, protocol: 'tcp' as const, service: 'https' },
            { port: 22, protocol: 'tcp' as const, service: 'ssh' },
            { port: 23, protocol: 'tcp' as const, service: 'telnet' },
            { port: 53, protocol: 'udp' as const, service: 'dns' },
            { port: 161, protocol: 'udp' as const, service: 'snmp' },
            { port: 8080, protocol: 'tcp' as const, service: 'http-alt' }
        ];

        const numPorts = Math.floor(Math.random() * 4) + 1; // 1-4 ports
        const selectedPorts = [];

        for (let i = 0; i < numPorts; i++) {
            const portInfo = commonPorts[Math.floor(Math.random() * commonPorts.length)];
            const port: NetworkPort = {
                ...portInfo,
                isOpen: Math.random() > 0.3 // 70% chance port is open
            };
            selectedPorts.push(port);
        }

        return selectedPorts;
    }
}