import type { IntervalDuration } from "../../../connect-ems-api/dist/packages/connect-interval";

export const DURATION_TO_MS: Record<IntervalDuration, number> = {
    '1s': 1000,
    '10s': 10000,
    '30s': 30000,
    '1m': 60000,
    '5m': 300000,
    '1hr': 3600000,
} as const;

export const durationToMs = (duration: IntervalDuration): number => {
    const ms = DURATION_TO_MS[duration];
    if (ms === undefined) {
        throw new Error(`Unsupported duration: ${duration}`);
    }
    return ms;
};