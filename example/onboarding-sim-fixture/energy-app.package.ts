import {defineEnergyAppPackage, EnergyAppPackageCategory} from '@enyo-energy/energy-app-sdk';

/**
 * The fixture app's package definition.
 *
 * The simulator runs without one — it only needs a built bundle — but a config
 * is what gives it the app's name and its declared public files, so this is also
 * how `enyo onboarding-sim -f` is exercised.
 */
export default defineEnergyAppPackage({
    version: '1',
    packageName: 'onboarding-sim-fixture',
    categories: [EnergyAppPackageCategory.Wallbox],
    storeEntry: [
        {
            language: 'de',
            title: 'Onboarding-Simulator-Fixture',
            shortDescription: 'Beispiel-App für den Onboarding-Simulator',
            description: 'Eine Beispiel-App mit je einem Onboarding-v2-Guide pro Startvariante.',
        },
        {
            language: 'en',
            title: 'Onboarding simulator fixture',
            shortDescription: 'Example app for the onboarding simulator',
            description: 'An example app with one onboarding v2 guide per start variant.',
        },
    ],
    permissions: [],
    compatibility: [],
});
