import {validatePackageConsents} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageConsent,
    EnergyAppPackageDefinition,
    PackageConsentsSource,
    PackageConsentsValidationResult
} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';

/**
 * The consents a package declares (`EnergyAppPackageDefinition.consents`).
 *
 * They leave the developer's machine only through the release, inside the
 * spread config. What a person agrees to — and what enyo records as agreed — is
 * exactly this text, so a missing translation or an empty legal-text section
 * must fail here, locally, before the bundle is built and the prompt answered.
 */

/**
 * Run the SDK's consent validator and abort the release on blocking errors.
 * Warnings — such as a required consent only the installer may give — are
 * printed and never block.
 *
 * The checks live in the SDK on purpose, same as
 * `validateSubscriptionPlansDeclaration()`: the CLI must not re-implement or
 * relax them, so the CLI and the API can never disagree.
 *
 * @param config - The package definition being released.
 * @param validate - The validator to run; only replaced in tests.
 * @throws {CLIError} If the declared consents have blocking errors.
 */
export const validateConsentsDeclaration = (
    config: EnergyAppPackageDefinition,
    validate: (definition: PackageConsentsSource) => PackageConsentsValidationResult = validatePackageConsents
): void => {
    const result = validate(config);

    for (const warning of result.warnings) {
        console.log(`⚠️ Consents: ${warning}`);
    }

    if (!result.ok) {
        console.error(`❌ Consent validation failed with ${result.errors.length} error(s):`);
        for (const error of result.errors) {
            console.error(`   • ${error}`);
        }
        throw new CLIError('Consents declaration is invalid. Aborting release.');
    }
};

/**
 * One consent in a few words, e.g.
 * `backup-and-developer-mode v1 (required, customer+installer)`.
 *
 * @param consent - A consent that passed {@link validateConsentsDeclaration}.
 */
export const describeConsent = (consent: EnergyAppPackageConsent): string =>
    `${consent.consentKey} v${consent.version} (${consent.required ? 'required' : 'voluntary'}, ` +
    `${consent.grantableBy.join('+')})`;

/**
 * The release summary line for the declared consents, e.g.
 * `2 consent(s): backup-and-developer-mode v1 (required, customer+installer), share-usage-data v1 (voluntary, customer)`.
 *
 * @param config - The package definition being released.
 * @returns The line without the leading icon, or `undefined` when the package declares none.
 */
export const describeConsents = (config: EnergyAppPackageDefinition): string | undefined => {
    const consents = config.consents ?? [];
    if (consents.length === 0) {
        return undefined;
    }
    return `${consents.length} consent(s): ${consents.map(describeConsent).join(', ')}`;
};
