import * as Modbus from 'jsmodbus';
import * as net from 'net';

interface ModbusServerOptions {
    holding: Buffer;
}

// Create a new Modbus TCP server
const server = new net.Server();
const modbusServer = new Modbus.server.TCP(server, {
    holding: Buffer.alloc(1_000 * 2)
} as ModbusServerOptions);

console.log('SMA Inverter Modbus TCP Server Simulator');

// The buffer represents the holding registers starting from address 0.
// We will map the SunSpec addresses to offsets in this buffer.
const sunspecBaseAddress: number = 40001;
const bufferOffset: number = 1;

function getBufferOffset(address: number): number {
    if (address >= sunspecBaseAddress) {
        return (address - sunspecBaseAddress + bufferOffset) * 2;
    }
    return address * 2;
}

// SunSpec Common Model Block (Model ID 1)
// SunSpec Identifier "SunS"
modbusServer.holding.writeUInt32BE(0x53756e53, getBufferOffset(40001)); // 40001-40002

// Model ID
modbusServer.holding.writeUInt16BE(1, getBufferOffset(40003)); // 40003

modbusServer.holding.write("SN123455", getBufferOffset(40053), 16, 'ascii');
console.log(`Write Serial Number SN123455 into Register ${getBufferOffset(40053)}`)

// Model Length
modbusServer.holding.writeUInt16BE(66, getBufferOffset(40004)); // 40004

// Inverter Model (Model ID 101 or 103 for single/three phase)
const inverterModelAddress = 40069;

// Model ID for Inverter (e.g., 103 for three-phase)
modbusServer.holding.writeUInt16BE(103, getBufferOffset(inverterModelAddress)); // 40069

// Model Length
modbusServer.holding.writeUInt16BE(50, getBufferOffset(inverterModelAddress + 1)); // 40070

// Dummy Data for Inverter Registers
// AC Current (A) - Register 40072
modbusServer.holding.writeUInt16BE(10 * 10, getBufferOffset(40072)); // 10.0 A

// AC Voltage (V) - Register 40078 - L-N voltage
modbusServer.holding.writeUInt16BE(230 * 10, getBufferOffset(40078)); // 230.0 V

// AC Power (W) - Register 40084
modbusServer.holding.writeUInt16BE(3000, getBufferOffset(40084)); // 3000 W

// Total Energy (Wh) - Register 40094
modbusServer.holding.writeUInt32BE(1234567, getBufferOffset(40094)); // 1234.567 kWh (if scale factor is -3)

// DC Current (A) - Register 40101
modbusServer.holding.writeUInt16BE(8 * 10, getBufferOffset(40101)); // 8.0 A

// DC Voltage (V) - Register 40102
modbusServer.holding.writeUInt16BE(400 * 10, getBufferOffset(40102)); // 400.0 V

// DC Power (W) - Register 40104
modbusServer.holding.writeUInt16BE(3200, getBufferOffset(40104)); // 3200 W


modbusServer.on('connection', () => {
    console.log('New connection');
});

modbusServer.on('preReadHoldingRegisters', (request) => {
    // @ts-expect-error this is fine
    console.log(`Read holding register from address '${request.body._start}'`)
    // @ts-expect-error this is fine
    request.body._start = request.body._start - 40000
    // @ts-expect-error this is fine
    console.log(`Translate to real register '${request.body._start}' (length ${request.body._count})`)
});

server.on('error', (err: Error) => {
    console.error('Server error', err);
});

console.log(modbusServer.holding.toString('ascii'))

export function startInverterSimulation(port: number = 502): void {
    server.listen(port, () => {
        console.log(`Modbus server listening on port ${port}`);
    });
}
