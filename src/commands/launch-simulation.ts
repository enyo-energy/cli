import {startInverterSimulation} from '../simulated-devices/inverter.js';
import {startSmaInverterWithBatterySimulation} from "../simulated-devices/sma-inverter-with-battery.js";

export interface LaunchSimulationOptions {
    port?: string;
}

export async function launchSimulationCommand(type: string, options: LaunchSimulationOptions): Promise<void> {
    const port = options.port ? parseInt(options.port, 10) : 502;

    switch (type.toLowerCase()) {
        case 'sunspec-inverter':
            console.log(`🔌 Starting ${type} simulation...`);
            console.log(`📡 Modbus port: ${port}`);
            startInverterSimulation(port);
            break;
        case 'sma-inverter':
            console.log(`🔌 Starting ${type} simulation...`);
            console.log(`📡 Modbus port: ${port}`);
            startSmaInverterWithBatterySimulation(port, false);
            break;
        case 'sma-inverter-with-battery':
            console.log(`🔌 Starting ${type} simulation...`);
            console.log(`📡 Modbus port: ${port}`);
            startSmaInverterWithBatterySimulation(port, true);
            break;
        default:
            throw new Error(`Unknown simulation type: ${type}. Available types: inverter, sma-inverter`);
    }
}