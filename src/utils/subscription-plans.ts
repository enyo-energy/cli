import {EnyoSubscriptionPricingModelEnum, validatePackageSubscriptionPlans} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageDefinition,
    EnergyAppPackageSubscriptionPlan,
    PackageSubscriptionPlansSource,
    PackageSubscriptionPlansValidationResult
} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';

/**
 * The paid plans a package declares
 * (`EnergyAppPackageDefinition.subscriptionPlans`).
 *
 * They leave the developer's machine only through the release, and enyo sells
 * them from then on: offer screen, checkout, renewals. The API checks them with
 * the same SDK validator and answers 400, but only after the bundle was built
 * and the prompt answered — this check makes a broken plan fail first, locally.
 */

/**
 * Run the SDK's subscription plan validator and abort the release on blocking
 * errors. Warnings are printed and never block.
 *
 * The checks live in the SDK on purpose, same as `validatePackageOnboardingGuide()`:
 * the CLI must not re-implement or relax them, so the CLI and the API can never
 * disagree.
 *
 * @param config - The package definition being released.
 * @param validate - The validator to run; only replaced in tests.
 * @throws {CLIError} If the declared plans have blocking errors.
 */
export const validateSubscriptionPlansDeclaration = (
    config: EnergyAppPackageDefinition,
    validate: (definition: PackageSubscriptionPlansSource) => PackageSubscriptionPlansValidationResult =
        validatePackageSubscriptionPlans
): void => {
    const result = validate(config);

    for (const warning of result.warnings) {
        console.log(`⚠️ Subscription plans: ${warning}`);
    }

    if (!result.ok) {
        console.error(`❌ Subscription plan validation failed with ${result.errors.length} error(s):`);
        for (const error of result.errors) {
            console.error(`   • ${error}`);
        }
        throw new CLIError('Subscription plans declaration is invalid. Aborting release.');
    }
};

/**
 * One summary line for a validated plan, e.g.
 * `premium — yearly, 83.19 EUR net, 30 days trial`.
 *
 * Prices are said to be net because the customer is shown gross (+19 % VAT).
 *
 * @param plan - A plan that passed {@link validateSubscriptionPlansDeclaration}.
 * @returns The summary line, without the leading icon.
 */
export const describeSubscriptionPlan = (plan: EnergyAppPackageSubscriptionPlan): string => {
    const prices = plan.prices
        .map((price) => `${price.amountWithoutTax.toFixed(2)} ${price.currency}`)
        .join(' / ');
    const perUnit = plan.pricingModel === EnyoSubscriptionPricingModelEnum.PerUnit ? ' per unit' : '';
    const trial = plan.trialDays ? `, ${plan.trialDays} ${plan.trialDays === 1 ? 'day' : 'days'} trial` : '';
    return `${plan.planKey} — ${plan.paymentInterval}, ${prices} net${perUnit}${trial}`;
};
