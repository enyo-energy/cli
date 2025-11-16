export interface InverterSimulationConfig {
    maxPowerW: number;
    nominalVoltage: number;
    timeZoneOffset?: number;
    variabilityFactor?: number;
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
}

export class InverterSimulator {
    private config: Required<InverterSimulationConfig>;
    private dailyEnergyWh: number = 0;
    private lastUpdateTime: Date;

    constructor(config: InverterSimulationConfig) {
        this.config = {
            timeZoneOffset: 0,
            variabilityFactor: 0.1,
            ...config
        };
        this.lastUpdateTime = new Date();
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
        const variability = 1 + (Math.random() - 0.5) * this.config.variabilityFactor;

        return Math.max(0, baseIrradiance * variability);
    }

    private addRandomVariation(baseValue: number, factor: number = 0.02): number {
        const variation = 1 + (Math.random() - 0.5) * factor;
        return baseValue * variation;
    }

    generateValues(timestamp?: Date): SimulatedInverterValues {
        const now = timestamp || new Date();
        const adjustedTime = new Date(now.getTime() + this.config.timeZoneOffset * 60 * 60 * 1000);
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
            gridVoltageL3V
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