/**
 * Input rules for onboarding v2 input blocks.
 *
 * Ported from `connect-core/api/src/onboarding-runtime/input-validator.ts` and
 * `input-outcome.mapper.ts`, which are themselves ports of the frontend rules.
 * The simulator applies the same check so a value the preview accepts is a value
 * a device accepts.
 */
import {EnyoOnboardingV2InputValueType} from '@enyo-energy/energy-app-sdk';

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;

/** Whether the installer's entry matches the block's value type. */
export const isValidInput = (valueType: EnyoOnboardingV2InputValueType, value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    if (valueType === EnyoOnboardingV2InputValueType.IpAddress) {
        return IPV4_RE.test(trimmed);
    }
    if (valueType === EnyoOnboardingV2InputValueType.Number) {
        return NUMBER_RE.test(trimmed);
    }
    return true;
};

/**
 * Values an author may use for "the check said yes". A guide is free to wire the
 * device-test verdicts one by one — the exact match wins — but the editor seeds
 * an input block with the plain binary pair, which is what most guides use.
 */
export const POSITIVE_OUTCOME_VALUES = ['reachable', 'success', 'found', 'paired'];

/**
 * The handle the simulator pre-selects for a block: the positive branch, because
 * on a real device an installer who typed a working address takes it. Every
 * other branch stays one click away — walking them is the point of the preview.
 */
export const defaultOutcomeId = (outcomes: { id: string; value: string }[]): string | undefined =>
    outcomes.find(outcome => POSITIVE_OUTCOME_VALUES.includes(outcome.value))?.id ?? outcomes[0]?.id;
