import {
    defineEnergyAppPackage,
    defineOnboardingGuideV2,
    EnergyAppPackageCategory,
    EnyoDeviceTestOutcomeEnum,
    EnyoOnboardingV2InputValueType,
    EnyoOnboardingV2StartVariant,
    onboardingV2Block,
    onboardingV2Target,
    onContinueV2,
    onOutcomeV2,
} from '@enyo-energy/energy-app-sdk';

const t = (de: string, en: string) => [
    {language: 'de' as const, value: de},
    {language: 'en' as const, value: en},
];

/**
 * The static manual setup guide for pre-app onboarding. It is not one of the
 * guides the app's handler returns, and the simulator lists it on its own.
 */
const manualSetupGuide = defineOnboardingGuideV2({
    title: t('Wallbox manuell einrichten', 'Set up the wallbox manually'),
    startVariant: EnyoOnboardingV2StartVariant.ManualSetup,
    requiresNetworkScan: false,
    startStepId: 'prepare',
    steps: [
        {
            id: 'prepare',
            name: 'ocpp-aktivieren',
            title: t('OCPP aktivieren', 'Enable OCPP'),
            blocks: [
                onboardingV2Block.text('intro', t(
                    'Öffne das Webinterface der Wallbox und aktiviere OCPP 1.6J.',
                    'Open the wallbox web interface and enable OCPP 1.6J.',
                )),
            ],
            transitions: [onContinueV2(onboardingV2Target.step('ip'))],
        },
        {
            id: 'ip',
            name: 'ip-eingeben',
            title: t('IP-Adresse eingeben', 'Enter the IP address'),
            blocks: [
                onboardingV2Block.input(
                    'device-ip',
                    EnyoOnboardingV2InputValueType.IpAddress,
                    t('IP-Adresse der Wallbox', 'Wallbox IP address'),
                    t('Verbindung prüfen', 'Check connection'),
                    [
                        {id: 'ok', value: EnyoDeviceTestOutcomeEnum.AppliancesCreated, label: t('Verbunden', 'Connected')},
                        {id: 'unreachable', value: EnyoDeviceTestOutcomeEnum.Unreachable, label: t('Nicht erreichbar', 'Unreachable')},
                    ],
                    {placeholder: t('z. B. 192.168.1.42', 'e.g. 192.168.1.42')},
                ),
            ],
            transitions: [
                onOutcomeV2('device-ip', 'ok', onboardingV2Target.success()),
                onOutcomeV2('device-ip', 'unreachable', onboardingV2Target.step('prepare')),
            ],
        },
    ],
});

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
    onboardingGuide: manualSetupGuide,
});
