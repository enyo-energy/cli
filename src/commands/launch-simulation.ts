import {SmaInverter} from "@hems-one/simulated-devices";

export interface LaunchSimulationOptions {
    port?: string;
}

function startSmaInverter(port: number, battery: boolean) {
    console.log(`Starting SMA Inverter on Port ${port}`);
    const inverter = new SmaInverter({
        port: port,
        inverter: '11kWp',
        battery: battery ? '10kWh' : undefined
    });
    inverter.start();
}

export async function launchSimulationCommand(type: string, options: LaunchSimulationOptions): Promise<void> {
    const port = options.port ? parseInt(options.port, 10) : 502;

    switch (type.toLowerCase()) {
        case 'sma-inverter':
            startSmaInverter(port, false);
            break;
        case 'sma-inverter-with-battery':
            startSmaInverter(port, true);
            break;
        default:
            throw new Error(`Unknown simulation type: ${type}. Available types: sma-inverter, sma-inverter-with-battery`);
    }
}