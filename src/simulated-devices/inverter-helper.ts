export interface BatteryConfig {
    capacityWh: number;
    maxChargeRateW: number;
    maxDischargeRateW: number;
    initialChargePercent?: number;
    nominalVoltage?: number;
}

export interface InverterSimulationConfig {
    maxPowerW: number;
    nominalVoltage: number;
    timeZoneOffset?: number;
    variabilityFactor?: number;
    battery?: BatteryConfig;
}

export interface BatteryValues {
    currentA: number;
    chargeStatePercent: number;
    capacityPercent: number;
    temperatureC: number;
    voltageV: number;
    chargingMethod: number;
    operatingStatus: number;
}

export interface SimulatedInverterValues {
    pvPowerW: number;
    acPowerL1W: number;
    acPowerL2W: number;
    acPowerL3W: number;
    totalAcPowerW: number;
    dcVoltageV: number;
    dcCurrentA: number;
    dailyEnergyWh: number;
    gridVoltageL1V: number;
    gridVoltageL2V: number;
    gridVoltageL3V: number;
    battery?: BatteryValues;
}

export class InverterSimulator {
    private config: InverterSimulationConfig;
    private dailyEnergyWh: number = 0;
    private lastUpdateTime: Date;
    private batteryChargeWh: number = 0;

    constructor(config: InverterSimulationConfig) {
        this.config = {
            timeZoneOffset: 0,
            variabilityFactor: 0.1,
            ...config
        };
        this.lastUpdateTime = new Date();

        // Initialize battery charge if battery is configured
        if (this.config.battery) {
            const initialPercent = this.config.battery.initialChargePercent ?? 50;
            this.batteryChargeWh = (this.config.battery.capacityWh * initialPercent) / 100;
        }
    }

    private getSolarIrradiance(hour: number, minute: number): number {
        const timeDecimal = hour + minute / 60;

        // Solar curve: starts at sunrise (~6am), peaks at noon, ends at sunset (~6pm)
        const sunriseHour = 6;
        const sunsetHour = 18;

        if (timeDecimal < sunriseHour || timeDecimal > sunsetHour) {
            return 0;
        }

        // Create a bell curve for solar irradiance
        const solarDay = timeDecimal - sunriseHour;
        const dayLength = sunsetHour - sunriseHour;
        const normalizedTime = (solarDay / dayLength) * Math.PI;

        // Use sine curve for realistic solar irradiance
        const baseIrradiance = Math.sin(normalizedTime);

        // Add some variability to simulate clouds
        const variability = 1 + (Math.random() - 0.5) * (this.config.variabilityFactor || 0.15);

        return Math.max(0, baseIrradiance * variability);
    }

    private addRandomVariation(baseValue: number, factor: number = 0.02): number {
        const variation = 1 + (Math.random() - 0.5) * factor;
        return baseValue * variation;
    }

    private simulateBattery(pvPowerW: number, consumptionW: number, timeDiffHours: number): BatteryValues | undefined {
        if (!this.config.battery) {
            return undefined;
        }

        const battery = this.config.battery;
        const netPowerW = pvPowerW - consumptionW; // Positive = excess, negative = deficit

        // Calculate battery power (charge/discharge)
        let batteryPowerW = 0;

        if (netPowerW > 0) {
            // Excess power - charge battery
            const maxChargeW = Math.min(battery.maxChargeRateW, netPowerW);
            const remainingCapacityWh = battery.capacityWh - this.batteryChargeWh;
            const maxChargeThisPeriod = remainingCapacityWh / timeDiffHours;
            batteryPowerW = Math.min(maxChargeW, maxChargeThisPeriod);
        } else if (netPowerW < 0) {
            // Power deficit - discharge battery
            const maxDischargeW = Math.min(battery.maxDischargeRateW, Math.abs(netPowerW));
            const maxDischargeThisPeriod = this.batteryChargeWh / timeDiffHours;
            batteryPowerW = -Math.min(maxDischargeW, maxDischargeThisPeriod);
        }

        // Update battery charge
        this.batteryChargeWh = Math.max(0, Math.min(battery.capacityWh,
            this.batteryChargeWh + (batteryPowerW * timeDiffHours)));

        // Calculate battery values
        const chargeStatePercent = Math.round((this.batteryChargeWh / battery.capacityWh) * 100);
        const capacityPercent = 100; // Assume battery is in good condition
        const voltageV = battery.nominalVoltage ?? 48.0; // Default to 48V battery system
        const currentA = Math.round((batteryPowerW / voltageV) * 1000) / 1000; // Round to 3 decimal places
        const temperatureC = Math.round(this.addRandomVariation(25, 0.1)); // Simulate around 25°C

        // Determine charging method and operating status
        let chargingMethod = 802; // "Not active" from SMA documentation
        let operatingStatus = 2291; // "Ok" from SMA documentation

        if (batteryPowerW > 0) {
            chargingMethod = 2501; // "PV charging" from documentation
        } else if (batteryPowerW < 0) {
            operatingStatus = 2292; // "Discharging"
        }

        return {
            currentA,
            chargeStatePercent,
            capacityPercent,
            temperatureC,
            voltageV: Math.round(voltageV * 100) / 100,
            chargingMethod,
            operatingStatus
        };
    }

    generateValues(timestamp?: Date): SimulatedInverterValues {
        const now = timestamp || new Date();
        const adjustedTime = new Date(now.getTime() + (this.config.timeZoneOffset || 0) * 60 * 60 * 1000);
        const hour = adjustedTime.getHours();
        const minute = adjustedTime.getMinutes();

        const irradiance = this.getSolarIrradiance(hour, minute);
        const basePvPower = this.config.maxPowerW * irradiance;

        // Calculate power values with small variations
        const pvPowerW = Math.round(this.addRandomVariation(basePvPower));

        // Distribute AC power across three phases (slightly uneven like real installations)
        const phase1Factor = 0.34;
        const phase2Factor = 0.33;
        const phase3Factor = 0.33;

        const acPowerL1W = Math.round(pvPowerW * phase1Factor);
        const acPowerL2W = Math.round(pvPowerW * phase2Factor);
        const acPowerL3W = Math.round(pvPowerW * phase3Factor);
        const totalAcPowerW = acPowerL1W + acPowerL2W + acPowerL3W;

        // DC voltage varies with power output
        const dcVoltageV = Math.round(this.addRandomVariation(
            this.config.nominalVoltage + (irradiance * 50), 0.01
        ) * 10) / 10; // Round to 1 decimal place

        // DC current = power / voltage
        const dcCurrentA = dcVoltageV > 0 ?
            Math.round(this.addRandomVariation(pvPowerW / dcVoltageV, 0.01) * 10) / 10 : 0;

        // Grid voltages with small variations
        const baseGridVoltage = 230;
        const gridVoltageL1V = Math.round(this.addRandomVariation(baseGridVoltage, 0.02) * 10) / 10;
        const gridVoltageL2V = Math.round(this.addRandomVariation(baseGridVoltage, 0.02) * 10) / 10;
        const gridVoltageL3V = Math.round(this.addRandomVariation(baseGridVoltage, 0.02) * 10) / 10;

        // Calculate energy increment since last update
        const timeDiffMs = now.getTime() - this.lastUpdateTime.getTime();
        const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
        const energyIncrement = pvPowerW * timeDiffHours;

        // Reset daily energy at midnight
        if (now.getDate() !== this.lastUpdateTime.getDate()) {
            this.dailyEnergyWh = 0;
        }

        this.dailyEnergyWh += energyIncrement;
        this.lastUpdateTime = now;

        // Simulate battery if configured
        const consumption = Math.round(totalAcPowerW * 0.4); // Simulate 40% self-consumption
        const battery = this.simulateBattery(pvPowerW, consumption, timeDiffHours);

        return {
            pvPowerW,
            acPowerL1W,
            acPowerL2W,
            acPowerL3W,
            totalAcPowerW,
            dcVoltageV,
            dcCurrentA,
            dailyEnergyWh: Math.round(this.dailyEnergyWh),
            gridVoltageL1V,
            gridVoltageL2V,
            gridVoltageL3V,
            battery
        };
    }

    startSimulation(intervalMs: number = 10000, callback: (values: SimulatedInverterValues) => void): NodeJS.Timeout {
        // Generate initial values
        callback(this.generateValues());

        // Set up interval for subsequent updates
        return setInterval(() => {
            callback(this.generateValues());
        }, intervalMs);
    }
}