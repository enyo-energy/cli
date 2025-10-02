import type { ConnectModbus, ModbusOptions } from "../../../connect-ems-api/dist/packages/connect-modbus";

/**
 * Mock implementation of Modbus protocol for the CLI environment
 * In a real implementation, this would connect to actual Modbus devices
 */
export class ModbusImplementation implements ConnectModbus {
    private connected = false;
    private currentOptions?: ModbusOptions;

    async connect(options: ModbusOptions): Promise<void> {
        console.log(`Modbus: Connecting to ${options.host}:${options.port || 502}`);

        // Simulate connection delay
        await new Promise(resolve => setTimeout(resolve, 100));

        this.currentOptions = options;
        this.connected = true;

        console.log(`Modbus: Connected successfully to ${options.host}:${options.port || 502}`);
    }

    async disconnect(): Promise<void> {
        if (!this.connected) {
            console.log('Modbus: Already disconnected');
            return;
        }

        console.log('Modbus: Disconnecting...');

        // Simulate disconnection delay
        await new Promise(resolve => setTimeout(resolve, 50));

        this.connected = false;
        this.currentOptions = undefined;

        console.log('Modbus: Disconnected successfully');
    }

    isConnected(): boolean {
        return this.connected;
    }

    async readCoils(address: number, quantity: number): Promise<boolean[]> {
        this.ensureConnected();

        console.log(`Modbus: Reading ${quantity} coils from address ${address}`);

        // Simulate read delay
        await new Promise(resolve => setTimeout(resolve, 50));

        // Return mock data - alternating true/false pattern
        const result = Array.from({ length: quantity }, (_, i) => (address + i) % 2 === 0);

        console.log(`Modbus: Read coils result:`, result);
        return result;
    }

    async readDiscreteInputs(address: number, quantity: number): Promise<boolean[]> {
        this.ensureConnected();

        console.log(`Modbus: Reading ${quantity} discrete inputs from address ${address}`);

        // Simulate read delay
        await new Promise(resolve => setTimeout(resolve, 50));

        // Return mock data - random boolean values
        const result = Array.from({ length: quantity }, () => Math.random() > 0.5);

        console.log(`Modbus: Read discrete inputs result:`, result);
        return result;
    }

    async readHoldingRegisters(address: number, quantity: number): Promise<number[]> {
        this.ensureConnected();

        console.log(`Modbus: Reading ${quantity} holding registers from address ${address}`);

        // Simulate read delay
        await new Promise(resolve => setTimeout(resolve, 50));

        // Return mock data - incremental values
        const result = Array.from({ length: quantity }, (_, i) => address + i + 1000);

        console.log(`Modbus: Read holding registers result:`, result);
        return result;
    }

    async readInputRegisters(address: number, quantity: number): Promise<number[]> {
        this.ensureConnected();

        console.log(`Modbus: Reading ${quantity} input registers from address ${address}`);

        // Simulate read delay
        await new Promise(resolve => setTimeout(resolve, 50));

        // Return mock data - random values
        const result = Array.from({ length: quantity }, () => Math.floor(Math.random() * 65536));

        console.log(`Modbus: Read input registers result:`, result);
        return result;
    }

    async writeSingleCoil(address: number, value: boolean): Promise<void> {
        this.ensureConnected();

        console.log(`Modbus: Writing coil at address ${address} = ${value}`);

        // Simulate write delay
        await new Promise(resolve => setTimeout(resolve, 50));

        console.log(`Modbus: Successfully wrote coil at address ${address}`);
    }

    async writeSingleRegister(address: number, value: number): Promise<void> {
        this.ensureConnected();

        if (value < 0 || value > 65535) {
            throw new Error(`Modbus: Register value must be between 0 and 65535, got ${value}`);
        }

        console.log(`Modbus: Writing register at address ${address} = ${value}`);

        // Simulate write delay
        await new Promise(resolve => setTimeout(resolve, 50));

        console.log(`Modbus: Successfully wrote register at address ${address}`);
    }

    async writeMultipleCoils(address: number, values: boolean[]): Promise<void> {
        this.ensureConnected();

        console.log(`Modbus: Writing ${values.length} coils starting at address ${address}:`, values);

        // Simulate write delay
        await new Promise(resolve => setTimeout(resolve, 75));

        console.log(`Modbus: Successfully wrote ${values.length} coils starting at address ${address}`);
    }

    async writeMultipleRegisters(address: number, values: number[]): Promise<void> {
        this.ensureConnected();

        // Validate all values
        for (let i = 0; i < values.length; i++) {
            if (values[i] < 0 || values[i] > 65535) {
                throw new Error(`Modbus: Register value at index ${i} must be between 0 and 65535, got ${values[i]}`);
            }
        }

        console.log(`Modbus: Writing ${values.length} registers starting at address ${address}:`, values);

        // Simulate write delay
        await new Promise(resolve => setTimeout(resolve, 75));

        console.log(`Modbus: Successfully wrote ${values.length} registers starting at address ${address}`);
    }

    private ensureConnected(): void {
        if (!this.connected) {
            throw new Error('Modbus: Not connected. Call connect() first.');
        }
    }
}