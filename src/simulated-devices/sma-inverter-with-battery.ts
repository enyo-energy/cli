import * as Modbus from 'jsmodbus';
import * as net from 'net';
import { InverterSimulator, SimulatedInverterValues, InverterSimulationConfig } from './inverter-helper.js';

interface ModbusServerOptions {
    holding: Buffer;
}

export interface SmaInverterWithBatteryConfig {
    inverterConfig: InverterSimulationConfig;
    port?: number;
}

// SMA NaN values from documentation
const SMA_NAN_VALUES = {
    S16: 0x8000,
    S32: 0x80000000,
    U16: 0xFFFF,
    U32: 0xFFFFFFFF,
    U64: BigInt('0xFFFFFFFFFFFFFFFF')
};

export class SmaInverterWithBatterySimulator {
    private server: net.Server;
    // @ts-expect-error this is fine
    private modbusServer: Modbus.server.TCP;
    private inverterSimulator: InverterSimulator;
    private currentSimulatedValues: SimulatedInverterValues;
    private simulationInterval?: NodeJS.Timeout;

    constructor(config: SmaInverterWithBatteryConfig) {
        this.server = new net.Server();
        this.modbusServer = new Modbus.server.TCP(this.server, {
            holding: Buffer.alloc(1_000 * 2)
        } as ModbusServerOptions);

        // Initialize the inverter simulator with battery config
        this.inverterSimulator = new InverterSimulator(config.inverterConfig);

        this.setupStaticRegisters();

        // Initialize with current simulated values
        this.currentSimulatedValues = this.inverterSimulator.generateValues();
        this.updateRegistersWithSimulatedValues(this.currentSimulatedValues);

        this.setupEventHandlers();
    }

    private getBufferOffset(address: number): number {
        const smaBaseAddress = 30001;
        const bufferOffset = 1;

        if (address >= smaBaseAddress) {
            return (address - smaBaseAddress + bufferOffset) * 2;
        }
        return address * 2;
    }

    private setupStaticRegisters(): void {
        // Software version
        this.modbusServer.holding.writeUInt32BE(0x01020304, this.getBufferOffset(30001));

        // Device type
        this.modbusServer.holding.writeUInt32BE(0x9130, this.getBufferOffset(30003));

        // Serial number
        const serialNumber = "SMA123456789";
        for (let i = 0; i < serialNumber.length && i < 32; i++) {
            this.modbusServer.holding.writeUInt8(serialNumber.charCodeAt(i), this.getBufferOffset(30005) + i);
        }

        // Device status/operating state
        this.modbusServer.holding.writeUInt32BE(307, this.getBufferOffset(30201));

        // Total energy yield (2500000Wh) - This is cumulative over device lifetime
        this.modbusServer.holding.writeBigInt64BE(BigInt(2500000), this.getBufferOffset(30517));

        // Grid frequency (50.00Hz) - Static value
        this.modbusServer.holding.writeUInt32BE(5000, this.getBufferOffset(30803));
    }

    private updateRegistersWithSimulatedValues(values: SimulatedInverterValues): void {
        // AC power L1, L2, L3 (in Watts)
        this.modbusServer.holding.writeInt32BE(values.acPowerL1W, this.getBufferOffset(30775));
        this.modbusServer.holding.writeInt32BE(values.acPowerL2W, this.getBufferOffset(30777));
        this.modbusServer.holding.writeInt32BE(values.acPowerL3W, this.getBufferOffset(30779));

        // Total AC power (in Watts)
        this.modbusServer.holding.writeInt32BE(values.totalAcPowerW, this.getBufferOffset(30783));

        // Today's energy yield (in Wh)
        this.modbusServer.holding.writeBigInt64BE(BigInt(values.dailyEnergyWh), this.getBufferOffset(30513));

        // DC voltage string 1 (in 0.01V units, so multiply by 100)
        this.modbusServer.holding.writeInt32BE(Math.round(values.dcVoltageV * 100), this.getBufferOffset(30559));

        // DC current string 1 (in 0.001A units, so multiply by 1000)
        this.modbusServer.holding.writeInt32BE(Math.round(values.dcCurrentA * 1000), this.getBufferOffset(30769));

        // Grid voltage L1, L2, L3 (in 0.01V units, so multiply by 100)
        this.modbusServer.holding.writeUInt32BE(Math.round(values.gridVoltageL1V * 100), this.getBufferOffset(30813));
        this.modbusServer.holding.writeUInt32BE(Math.round(values.gridVoltageL2V * 100), this.getBufferOffset(30815));
        this.modbusServer.holding.writeUInt32BE(Math.round(values.gridVoltageL3V * 100), this.getBufferOffset(30817));

        // PV generation power (in Watts)
        this.modbusServer.holding.writeInt32BE(values.pvPowerW, this.getBufferOffset(30869));

        // Current generator power (same as PV power)
        this.modbusServer.holding.writeUInt32BE(values.pvPowerW, this.getBufferOffset(30863));

        // Update derived values
        const consumption = Math.round(values.totalAcPowerW * 0.4); // Simulate 40% self-consumption
        const gridFeedIn = values.totalAcPowerW - consumption;
        const gridConsumption = consumption > values.totalAcPowerW ? consumption - values.totalAcPowerW : 0;

        // Consumer power (simulated household consumption)
        this.modbusServer.holding.writeInt32BE(consumption, this.getBufferOffset(30861));

        // Grid consumption power
        this.modbusServer.holding.writeInt32BE(gridConsumption, this.getBufferOffset(30865));

        // Grid feed-in power
        this.modbusServer.holding.writeInt32BE(Math.max(0, gridFeedIn), this.getBufferOffset(30867));

        // Current self-consumption
        this.modbusServer.holding.writeUInt32BE(Math.min(consumption, values.totalAcPowerW), this.getBufferOffset(30871));

        // Handle battery registers
        this.updateBatteryRegisters(values);
    }

    private updateBatteryRegisters(values: SimulatedInverterValues): void {
        if (values.battery) {
            // Battery current (30843) - S32, FIX3 format (multiply by 1000)
            const batteryCurrentRaw = Math.round(values.battery.currentA * 1000);
            this.modbusServer.holding.writeInt32BE(batteryCurrentRaw, this.getBufferOffset(30843));

            // Battery charge state % (30845) - U32, FIX0 format
            this.modbusServer.holding.writeUInt32BE(values.battery.chargeStatePercent, this.getBufferOffset(30845));

            // Battery capacity % (30847) - U32, FIX0 format
            this.modbusServer.holding.writeUInt32BE(values.battery.capacityPercent, this.getBufferOffset(30847));

            // Battery temperature °C (30849) - S32, TEMP format (multiply by 100)
            const batteryTempRaw = Math.round(values.battery.temperatureC * 100);
            this.modbusServer.holding.writeInt32BE(batteryTempRaw, this.getBufferOffset(30849));

            // Battery voltage V (30851) - U32, FIX2 format (multiply by 100)
            const batteryVoltageRaw = Math.round(values.battery.voltageV * 100);
            this.modbusServer.holding.writeUInt32BE(batteryVoltageRaw, this.getBufferOffset(30851));

            // Active charging method (30853) - U32, ENUM format
            this.modbusServer.holding.writeUInt32BE(values.battery.chargingMethod, this.getBufferOffset(30853));

            // Battery charge voltage setpoint (30855) - U32, FIX2 format - Set to nominal voltage
            const chargeVoltageRaw = Math.round(values.battery.voltageV * 100);
            this.modbusServer.holding.writeUInt32BE(chargeVoltageRaw, this.getBufferOffset(30855));

            // Battery charge cycles count (30857) - S32, FIX0 format - Simulate some cycles
            this.modbusServer.holding.writeInt32BE(150, this.getBufferOffset(30857));

            // Battery maintenance charge state (30859) - U32, ENUM format - Set to "Not active"
            this.modbusServer.holding.writeUInt32BE(802, this.getBufferOffset(30859));

            // Battery operating status (30955) - U32, ENUM format
            this.modbusServer.holding.writeUInt32BE(values.battery.operatingStatus, this.getBufferOffset(30955));
        } else {
            // No battery configured - set all battery registers to NaN values

            // Battery current (30843) - S32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.S32, this.getBufferOffset(30843));

            // Battery charge state % (30845) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30845));

            // Battery capacity % (30847) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30847));

            // Battery temperature °C (30849) - S32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.S32, this.getBufferOffset(30849));

            // Battery voltage V (30851) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30851));

            // Active charging method (30853) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30853));

            // Battery charge voltage setpoint (30855) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30855));

            // Battery charge cycles count (30857) - S32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.S32, this.getBufferOffset(30857));

            // Battery maintenance charge state (30859) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30859));

            // Battery operating status (30955) - U32 NaN
            this.modbusServer.holding.writeUInt32BE(SMA_NAN_VALUES.U32, this.getBufferOffset(30955));
        }
    }

    private setupEventHandlers(): void {
        this.modbusServer.on('connection', () => {
            console.log('New SMA inverter with battery connection');
        });

        this.modbusServer.on('preReadHoldingRegisters', (request: any) => {
            // Generate new simulated values on each read
            this.currentSimulatedValues = this.inverterSimulator.generateValues();
            this.updateRegistersWithSimulatedValues(this.currentSimulatedValues);

            const batteryStatus = this.currentSimulatedValues.battery
                ? `Battery: ${this.currentSimulatedValues.battery.chargeStatePercent}%, ${this.currentSimulatedValues.battery.currentA}A`
                : 'No battery';

            console.log(`Read SMA register from address '${request.body._start}' - PV Power: ${this.currentSimulatedValues.pvPowerW}W, ${batteryStatus}`);
            request.body._start = request.body._start - 30000;
            console.log(`Translate to real register '${request.body._start}' (length ${request.body._count})`);
        });

        this.server.on('error', (err: Error) => {
            console.error('SMA server with battery error', err);
        });
    }

    public start(port: number = 502): void {
        // Start background simulation that updates values every 10 seconds
        this.simulationInterval = this.inverterSimulator.startSimulation(10000, (values) => {
            this.currentSimulatedValues = values;
            this.updateRegistersWithSimulatedValues(values);

            const batteryInfo = values.battery
                ? `, Battery: ${values.battery.chargeStatePercent}% (${values.battery.currentA}A)`
                : ', No battery';

            console.log(`SMA Inverter updated: ${values.pvPowerW}W PV, ${values.totalAcPowerW}W AC, ${Math.round(values.dailyEnergyWh)}Wh today${batteryInfo}`);
        });

        this.server.listen(port, () => {
            console.log(`SMA Modbus server with battery listening on port ${port}`);
            console.log(`Simulation running with ${Math.round(this.currentSimulatedValues.pvPowerW)}W current PV power`);

            if (this.currentSimulatedValues.battery) {
                console.log(`Battery: ${this.currentSimulatedValues.battery.chargeStatePercent}% charge, ${this.currentSimulatedValues.battery.voltageV}V`);
            } else {
                console.log('No battery configured - battery registers set to NaN');
            }
        });

        // Clean up interval when server closes
        this.server.on('close', () => {
            if (this.simulationInterval) {
                clearInterval(this.simulationInterval);
            }
            console.log('SMA Inverter with battery simulation stopped');
        });
    }

    public stop(): void {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
        }
        this.server.close();
    }
}

// Convenience function for backward compatibility
export function startSmaInverterWithBatterySimulation(port: number = 502, battery: boolean = false): SmaInverterWithBatterySimulator {
    const simulator = new SmaInverterWithBatterySimulator({
        port,
        inverterConfig: {
            battery: battery ? {
                capacityWh: 10_000,
                initialChargePercent: 10,
                maxChargeRateW: 4100,
                maxDischargeRateW: 4100,
            } : undefined,
            maxPowerW: 10_000,
            nominalVoltage: 230,
        }
    });
    simulator.start(port);
    return simulator;
}