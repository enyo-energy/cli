import type { ConnectEmsApi } from "../../connect-ems-api/dist/connect-ems-api";
import type { ConnectInterval, IntervalDuration } from "../../connect-ems-api/dist/packages/connect-interval";
import type { ConnectModbus } from "../../connect-ems-api/dist/packages/connect-modbus";
import type { ConnectNetworkDevices } from "../../connect-ems-api/dist/packages/connect-network-devices";
import type { Request, Response } from "express";
import express from 'express';
import { PermissionNotGrantedError } from './errors/permission-not-granted.js';
import { ModbusImplementation } from './protocols/modbus-implementation.js';
import { NetworkDevicesImplementation } from './protocols/network-devices-implementation.js';
import { MOCK_SERVER_PORT } from './constants/defaults.js';
import { durationToMs } from './utils/interval-utils.js';

export interface ConnectEmsApiContext {
    packageName: string;
    version: number;
    permissions?: string[];
}

export class ConnectEmsApiImplementation implements ConnectEmsApi {
    private modbusInstance?: ConnectModbus;
    private networkDevicesInstance?: ConnectNetworkDevices;

    constructor(private readonly context: ConnectEmsApiContext, private readonly fetchFunction: typeof fetch) {
    }

    register(callback: (packageName: string, version: number) => void) {
        console.log('🔌 MockConnectEmsApi: Registering package with Connect EMS API');
        const app = express();
        app.use(express.json());
        app.get('/', (req: Request, res: Response) => {
            res.json({ status: 'running', package: this.context.packageName });
        });
        app.listen(MOCK_SERVER_PORT, () => {
            console.log(`🌐 Mock server running on port ${MOCK_SERVER_PORT}`);
            callback(this.context.packageName, this.context.version);
        });
    }

    onShutdown(callback: () => Promise<void>) {
        console.log('🔄 MockConnectEmsApi: onShutdown callback registered');
        // In a real implementation, this would handle graceful shutdown
        // For now, we'll just log the registration
    }

    isOnline() {
        return true;
    }

    useFetch() {
        return this.fetchFunction;
    }

    useModbus(): ConnectModbus {
        // Check if Modbus permission is granted
        // Note: There's no specific Modbus permission in the current enum,
        // but this shows the pattern for when it's added
        this.checkPermission('Modbus', ['Modbus']);

        if (!this.modbusInstance) {
            this.modbusInstance = new ModbusImplementation();
        }

        return this.modbusInstance;
    }

    useNetworkDevices(): ConnectNetworkDevices {
        // Check if network device permissions are granted
        this.checkPermission('NetworkDeviceDiscovery', ['NetworkDeviceDiscovery', 'NetworkDeviceSearch']);

        if (!this.networkDevicesInstance) {
            this.networkDevicesInstance = new NetworkDevicesImplementation();
        }

        return this.networkDevicesInstance;
    }

    useInterval(): ConnectInterval {
        const intervals = new Map<string, NodeJS.Timeout>();
        let nextId = 0;

        return {
            createInterval: (duration: IntervalDuration, callback: () => void): string => {
                const intervalId = `interval_${++nextId}`;
                const nodeInterval = setInterval(callback, durationToMs(duration));
                intervals.set(intervalId, nodeInterval);
                return intervalId;
            },
            stopInterval: (intervalId: string): void => {
                const nodeInterval = intervals.get(intervalId);
                if (nodeInterval) {
                    clearInterval(nodeInterval);
                    intervals.delete(intervalId);
                }
            }
        };
    }

    private checkPermission(feature: string, requiredPermissions: string[]): void {
        const availablePermissions = this.context.permissions || [];

        // Check if any of the required permissions are granted
        const hasPermission = requiredPermissions.some(permission =>
            availablePermissions.includes(permission)
        );

        if (!hasPermission) {
            throw new PermissionNotGrantedError(
                `${feature} (requires: ${requiredPermissions.join(' or ')})`,
                availablePermissions
            );
        }
    }
}