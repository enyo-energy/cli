import {validatePackageOnboardingGuide} from '@enyo-energy/energy-app-sdk';
import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';

/**
 * The static manual setup guide a package declares
 * (`EnergyAppPackageDefinition.onboardingGuide`).
 *
 * It leaves the developer's machine only through the release and is used for
 * pre-app onboarding. It is not an onboarding run guide — the host never offers
 * it and it has no relation to the guides an app returns from `registerOnboardingGuidesHandler()` — so nothing at runtime
 * would ever catch a broken one. The release is the only place it is checked.
 */

/**
 * Run the SDK's static onboarding guide validator and abort the release on
 * blocking errors. Warnings are printed and never block.
 *
 * The checks live in the SDK on purpose, same as `validatePackageFiles()`: the
 * CLI must not re-implement or relax them. Image references are resolved
 * against the declared `files` names only; that those files exist on disk is
 * `preparePublicFiles()`'s job.
 *
 * @param config - The package definition being released.
 * @throws {CLIError} If the declared guide has blocking errors.
 */
export const validateOnboardingGuideDeclaration = (config: EnergyAppPackageDefinition): void => {
    const result = validatePackageOnboardingGuide(config);

    for (const warning of result.warnings) {
        console.log(`⚠️ Onboarding guide: ${warning}`);
    }

    if (!result.ok) {
        console.error(`❌ Onboarding guide validation failed with ${result.errors.length} error(s):`);
        for (const error of result.errors) {
            console.error(`   • ${error}`);
        }
        throw new CLIError('Onboarding guide declaration is invalid. Aborting release.');
    }
};
