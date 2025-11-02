import { startInverterSimulation } from '../simulated-devices/inverter.js';

export interface LaunchSimulationOptions {
    port?: string;
}

export async function launchSimulationCommand(type: string, options: LaunchSimulationOptions): Promise<void> {
    const port = options.port ? parseInt(options.port, 10) : 502;

    switch (type.toLowerCase()) {
        case 'inverter':
            console.log(`🔌 Starting ${type} simulation...`);
            console.log(`📡 Modbus port: ${port}`);
            startInverterSimulation(port);
            break;
        default:
            throw new Error(`Unknown simulation type: ${type}. Available types: inverter`);
    }
}