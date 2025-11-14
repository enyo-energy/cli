import * as Modbus from 'jsmodbus';
import * as net from 'net';

interface ModbusServerOptions {
    holding: Buffer;
}

const server = new net.Server();
const modbusServer = new Modbus.server.TCP(server, {
    holding: Buffer.alloc(1_000 * 2)
} as ModbusServerOptions);

console.log('SMA Inverter Modbus TCP Server Simulator');

const smaBaseAddress: number = 30001;
const bufferOffset: number = 1;

function getBufferOffset(address: number): number {
    if (address >= smaBaseAddress) {
        return (address - smaBaseAddress + bufferOffset) * 2;
    }
    return address * 2;
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

// AC power L1 (2500W)
modbusServer.holding.writeInt32BE(2500, getBufferOffset(30775));
// AC power L2 (2600W)
modbusServer.holding.writeInt32BE(2600, getBufferOffset(30777));
// AC power L3 (2400W)
modbusServer.holding.writeInt32BE(2400, getBufferOffset(30779));

// Total AC power (7500W)
modbusServer.holding.writeInt32BE(7500, getBufferOffset(30783));

// Today's energy yield (15000Wh)
modbusServer.holding.writeBigInt64BE(BigInt(15000), getBufferOffset(30513));

// Total energy yield (2500000Wh)
modbusServer.holding.writeBigInt64BE(BigInt(2500000), getBufferOffset(30517));

// DC voltage string 1 (420.0V)
modbusServer.holding.writeInt32BE(4200, getBufferOffset(30559));

// DC current string 1 (18.0A)
modbusServer.holding.writeInt32BE(1800, getBufferOffset(30769));

// Grid frequency (50.00Hz)
modbusServer.holding.writeUInt32BE(5000, getBufferOffset(30803));

// Grid voltage L1 (230.0V)
modbusServer.holding.writeUInt32BE(23000, getBufferOffset(30813));
// Grid voltage L2 (231.0V)
modbusServer.holding.writeUInt32BE(23100, getBufferOffset(30815));
// Grid voltage L3 (229.0V)
modbusServer.holding.writeUInt32BE(22900, getBufferOffset(30817));

// Consumer power (3200W)
modbusServer.holding.writeInt32BE(3200, getBufferOffset(30861));

// Current generator power (7800W)
modbusServer.holding.writeUInt32BE(7800, getBufferOffset(30863));

// Grid consumption power (1500W)
modbusServer.holding.writeInt32BE(1500, getBufferOffset(30865));

// Grid feed-in power (6300W)
modbusServer.holding.writeInt32BE(6300, getBufferOffset(30867));

// PV generation power (7800W)
modbusServer.holding.writeInt32BE(7800, getBufferOffset(30869));

// Current self-consumption (1500W)
modbusServer.holding.writeUInt32BE(1500, getBufferOffset(30871));

modbusServer.on('connection', () => {
    console.log('New SMA inverter connection');
});

modbusServer.on('preReadHoldingRegisters', (request) => {
    // @ts-expect-error this is fine
    console.log(`Read SMA register from address '${request.body._start}'`);
    // @ts-expect-error this is fine
    request.body._start = request.body._start - 30000;
    // @ts-expect-error this is fine
    console.log(`Translate to real register '${request.body._start}' (length ${request.body._count})`);
});

server.on('error', (err: Error) => {
    console.error('SMA server error', err);
});

export function startSmaInverterSimulation(port: number = 502): void {
    server.listen(port, () => {
        console.log(`SMA Modbus server listening on port ${port}`);
    });
}