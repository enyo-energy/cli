import * as Modbus from 'jsmodbus';
import * as net from 'net';
import { InverterSimulator, SimulatedInverterValues } from './inverter-helper.js';

interface ModbusServerOptions {
    holding: Buffer;
}

const server = new net.Server();
const modbusServer = new Modbus.server.TCP(server, {
    holding: Buffer.alloc(1_000 * 2)
} as ModbusServerOptions);

// Initialize the inverter simulator
const inverterSimulator = new InverterSimulator({
    maxPowerW: 8000,
    nominalVoltage: 400,
    timeZoneOffset: 1, // CET timezone
    variabilityFactor: 0.15
});

let currentSimulatedValues: SimulatedInverterValues;

console.log('SMA Inverter Modbus TCP Server Simulator');

const smaBaseAddress: number = 30001;
const bufferOffset: number = 1;

function getBufferOffset(address: number): number {
    if (address >= smaBaseAddress) {
        return (address - smaBaseAddress + bufferOffset) * 2;
    }
    return address * 2;
}

function updateRegistersWithSimulatedValues(values: SimulatedInverterValues): void {
    // AC power L1, L2, L3 (in Watts)
    modbusServer.holding.writeInt32BE(values.acPowerL1W, getBufferOffset(30775));
    modbusServer.holding.writeInt32BE(values.acPowerL2W, getBufferOffset(30777));
    modbusServer.holding.writeInt32BE(values.acPowerL3W, getBufferOffset(30779));

    // Total AC power (in Watts)
    modbusServer.holding.writeInt32BE(values.totalAcPowerW, getBufferOffset(30783));

    // Today's energy yield (in Wh)
    modbusServer.holding.writeBigInt64BE(BigInt(values.dailyEnergyWh), getBufferOffset(30513));

    // DC voltage string 1 (in 0.01V units, so multiply by 100)
    modbusServer.holding.writeInt32BE(Math.round(values.dcVoltageV * 100), getBufferOffset(30559));

    // DC current string 1 (in 0.001A units, so multiply by 1000)
    modbusServer.holding.writeInt32BE(Math.round(values.dcCurrentA * 1000), getBufferOffset(30769));

    // Grid voltage L1, L2, L3 (in 0.01V units, so multiply by 100)
    modbusServer.holding.writeUInt32BE(Math.round(values.gridVoltageL1V * 100), getBufferOffset(30813));
    modbusServer.holding.writeUInt32BE(Math.round(values.gridVoltageL2V * 100), getBufferOffset(30815));
    modbusServer.holding.writeUInt32BE(Math.round(values.gridVoltageL3V * 100), getBufferOffset(30817));

    // PV generation power (in Watts)
    modbusServer.holding.writeInt32BE(values.pvPowerW, getBufferOffset(30869));

    // Current generator power (same as PV power)
    modbusServer.holding.writeUInt32BE(values.pvPowerW, getBufferOffset(30863));

    // Update derived values
    const consumption = Math.round(values.totalAcPowerW * 0.4); // Simulate 40% self-consumption
    const gridFeedIn = values.totalAcPowerW - consumption;
    const gridConsumption = consumption > values.totalAcPowerW ? consumption - values.totalAcPowerW : 0;

    // Consumer power (simulated household consumption)
    modbusServer.holding.writeInt32BE(consumption, getBufferOffset(30861));

    // Grid consumption power
    modbusServer.holding.writeInt32BE(gridConsumption, getBufferOffset(30865));

    // Grid feed-in power
    modbusServer.holding.writeInt32BE(Math.max(0, gridFeedIn), getBufferOffset(30867));

    // Current self-consumption
    modbusServer.holding.writeUInt32BE(Math.min(consumption, values.totalAcPowerW), getBufferOffset(30871));
}

// Software version
modbusServer.holding.writeUInt32BE(0x01020304, getBufferOffset(30001));

// Device type
modbusServer.holding.writeUInt32BE(0x9130, getBufferOffset(30003));

// Serial number
const serialNumber = "SMA123456789";
for (let i = 0; i < serialNumber.length && i < 32; i++) {
    modbusServer.holding.writeUInt8(serialNumber.charCodeAt(i), getBufferOffset(30005) + i);
}

// Device status/operating state
modbusServer.holding.writeUInt32BE(307, getBufferOffset(30201));

// Total energy yield (2500000Wh) - This is cumulative over device lifetime
modbusServer.holding.writeBigInt64BE(BigInt(2500000), getBufferOffset(30517));

// Grid frequency (50.00Hz) - Static value
modbusServer.holding.writeUInt32BE(5000, getBufferOffset(30803));

// Initialize with current simulated values
currentSimulatedValues = inverterSimulator.generateValues();
updateRegistersWithSimulatedValues(currentSimulatedValues);

// TODO: implement 30587 Zählerstand PV-Erzeugungszähler, in Wh U32 FIX0 RO

modbusServer.on('connection', () => {
    console.log('New SMA inverter connection');
});

modbusServer.on('preReadHoldingRegisters', (request) => {
    // Generate new simulated values on each read
    currentSimulatedValues = inverterSimulator.generateValues();
    updateRegistersWithSimulatedValues(currentSimulatedValues);

    // @ts-expect-error this is fine
    console.log(`Read SMA register from address '${request.body._start}' - PV Power: ${currentSimulatedValues.pvPowerW}W`);
    // @ts-expect-error this is fine
    request.body._start = request.body._start - 30000;
    // @ts-expect-error this is fine
    console.log(`Translate to real register '${request.body._start}' (length ${request.body._count})`);
});

server.on('error', (err: Error) => {
    console.error('SMA server error', err);
});

export function startSmaInverterSimulation(port: number = 502): void {
    // Start background simulation that updates values every 10 seconds
    const simulationInterval = inverterSimulator.startSimulation(10000, (values) => {
        currentSimulatedValues = values;
        updateRegistersWithSimulatedValues(values);
        console.log(`SMA Inverter updated: ${values.pvPowerW}W PV, ${values.totalAcPowerW}W AC, ${Math.round(values.dailyEnergyWh)}Wh today`);
    });

    server.listen(port, () => {
        console.log(`SMA Modbus server listening on port ${port}`);
        console.log(`Simulation running with ${Math.round(currentSimulatedValues.pvPowerW)}W current PV power`);
    });

    // Clean up interval when server closes
    server.on('close', () => {
        clearInterval(simulationInterval);
        console.log('SMA Inverter simulation stopped');
    });
}