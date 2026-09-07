/**
 * A hand-written energy app bundle, in the shape rsbuild's node target produces:
 * CommonJS, and reaching the SDK through the `energyAppSdkInstance` global that
 * the runtime — and the simulator — puts in scope.
 *
 * It exists so the simulator can be tested end to end without building a real
 * app, and it doubles as a worked example: one guide per start variant, and one
 * of them exercising every interactive block type.
 */
const {
    EnergyApp,
    EnyoOnboardingV2ChoiceLayout,
    EnyoOnboardingV2DeviceSelection,
    EnyoOnboardingV2DynamicKind,
    EnyoOnboardingV2HintVariant,
    EnyoOnboardingV2InputValueType,
    EnyoOnboardingV2PauseReason,
    EnyoOnboardingV2SetupFieldType,
    EnyoOnboardingV2StartVariant,
    defineOnboardingGuideV2,
    onboardingV2Block,
    onboardingV2Target,
    onContinueV2,
    onOptionV2,
    onOutcomeV2,
    onSkipV2,
} = require('@enyo-energy/energy-app-sdk/dist/cjs/index.cjs');

const app = new EnergyApp();

/** de/en for one string, so the language switch in the UI has something to switch. */
const t = (de, en) => [
    {language: 'de', value: de},
    {language: 'en', value: en},
];

/** The variant with everything in it: every interactive block, and three exits. */
const wallboxGuide = defineOnboardingGuideV2({
    name: 'sim-wallbox-not-found',
    vendorId: 'sim-vendor',
    modelIds: ['sim-model'],
    title: t('Wallbox verbinden', 'Connect the wallbox'),
    startVariant: EnyoOnboardingV2StartVariant.DeviceNotFound,
    summary: t('Wallbox über OCPP anbinden.', 'Bring the wallbox in over OCPP.'),
    prerequisites: [t('Die Wallbox ist am Strom.', 'The wallbox has power.')],
    tools: [t('Smartphone', 'A phone')],
    requiresNetworkScan: false,
    startStepId: 'intro',
    steps: [
        {
            id: 'intro',
            name: 'intro',
            title: t('Los geht\'s', 'Getting started'),
            blocks: [
                onboardingV2Block.headline('intro-headline', t('Wallbox anschließen', 'Hook up the wallbox')),
                onboardingV2Block.text('intro-text', t(
                    'Wir verbinden die Wallbox über OCPP mit dem Energiemanager.',
                    'We are connecting the wallbox to the energy manager over OCPP.'
                )),
                onboardingV2Block.bullets('intro-bullets', [
                    t('Wallbox eingeschaltet', 'Wallbox switched on'),
                    t('Zugang zum Konfigurationsportal', 'Access to its configuration portal'),
                ]),
                onboardingV2Block.hint('intro-hint', EnyoOnboardingV2HintVariant.Info, t(
                    'Das dauert etwa fünf Minuten.',
                    'This takes about five minutes.'
                )),
            ],
            transitions: [onContinueV2(onboardingV2Target.step('pick-connection'))],
        },
        {
            id: 'pick-connection',
            name: 'pick-connection',
            title: t('Wie ist die Wallbox angebunden?', 'How is the wallbox connected?'),
            blocks: [
                onboardingV2Block.choice(
                    'connection-choice',
                    [
                        {id: 'lan', label: t('Per LAN-Kabel', 'By LAN cable')},
                        {id: 'wifi', label: t('Per WLAN', 'Over Wi-Fi')},
                        {id: 'unknown', label: t('Weiß ich nicht', 'I do not know')},
                    ],
                    {prompt: t('Wähle die Verbindung.', 'Pick the connection.'), layout: EnyoOnboardingV2ChoiceLayout.List}
                ),
            ],
            transitions: [
                onOptionV2('connection-choice', 'lan', onboardingV2Target.step('enter-address')),
                onOptionV2('connection-choice', 'wifi', onboardingV2Target.step('enter-address')),
                onOptionV2('connection-choice', 'unknown', onboardingV2Target.support('connection-unknown')),
            ],
        },
        {
            id: 'enter-address',
            name: 'enter-address',
            title: t('IP-Adresse eingeben', 'Enter the IP address'),
            blocks: [
                onboardingV2Block.dynamic('device-ip', EnyoOnboardingV2DynamicKind.DeviceIp),
                onboardingV2Block.input(
                    'address-input',
                    EnyoOnboardingV2InputValueType.IpAddress,
                    t('IP-Adresse der Wallbox', 'The wallbox\'s IP address'),
                    t('Prüfen', 'Check'),
                    [
                        {id: 'reachable', value: 'reachable', label: t('Erreichbar', 'Reachable')},
                        {id: 'unreachable', value: 'unreachable', label: t('Nicht erreichbar', 'Not reachable')},
                    ],
                    {placeholder: t('192.168.1.50', '192.168.1.50')}
                ),
            ],
            transitions: [
                onOutcomeV2('address-input', 'reachable', onboardingV2Target.step('vendor-token')),
                onOutcomeV2('address-input', 'unreachable', onboardingV2Target.step('address-failed')),
            ],
        },
        {
            id: 'address-failed',
            name: 'address-failed',
            title: t('Nicht erreichbar', 'Not reachable'),
            blocks: [
                onboardingV2Block.hint('failed-hint', EnyoOnboardingV2HintVariant.Warning, t(
                    'Prüfe die Adresse und versuche es erneut.',
                    'Check the address and try again.'
                )),
            ],
            transitions: [onContinueV2(onboardingV2Target.step('enter-address'))],
        },
        {
            id: 'vendor-token',
            name: 'vendor-token',
            title: t('Hersteller-Zugang', 'Vendor access'),
            blocks: [
                onboardingV2Block.additionalSetup('vendor-setup', 'vendor-api-token', {
                    cta: t('Verbinden', 'Connect'),
                    description: t(
                        'Trage den API-Token aus dem Herstellerportal ein.',
                        'Enter the API token from the vendor portal.'
                    ),
                    fields: [
                        {
                            name: 'token',
                            type: EnyoOnboardingV2SetupFieldType.Token,
                            label: t('API-Token', 'API token'),
                            required: true,
                            help: t('Im Fixture ist "good-token" gültig.', 'In the fixture "good-token" is the valid one.'),
                        },
                    ],
                    outcomes: [
                        {id: 'connected', value: 'connected', label: t('Verbunden', 'Connected')},
                        {id: 'failed', value: 'failed', label: t('Fehlgeschlagen', 'Failed')},
                    ],
                    skip: {id: 'later', label: t('Später erledigen', 'Do it later')},
                }),
            ],
            transitions: [
                onOutcomeV2('vendor-setup', 'connected', onboardingV2Target.step('pair')),
                onOutcomeV2('vendor-setup', 'failed', onboardingV2Target.support('vendor-token-rejected')),
                onSkipV2('vendor-setup', 'later', onboardingV2Target.pause(
                    EnyoOnboardingV2PauseReason.General,
                    'vendor-token'
                )),
            ],
        },
        {
            id: 'pair',
            name: 'pair',
            title: t('Wallbox koppeln', 'Pair the wallbox'),
            blocks: [
                onboardingV2Block.text('pair-text', t(
                    'Trage diese Adresse in der Wallbox als OCPP-Backend ein.',
                    'Enter this address in the wallbox as its OCPP backend.'
                )),
                // The app answers nothing for this kind, so the host's own
                // resolution fills it — the usual case for an OCPP URL.
                onboardingV2Block.dynamic('ocpp-url', EnyoOnboardingV2DynamicKind.OcppUrl),
                onboardingV2Block.ocppConnect('ocpp-connect', t('Verbindung prüfen', 'Check the connection'), [
                    {id: 'connected', value: 'connected', label: t('Verbunden', 'Connected')},
                    {id: 'timeout', value: 'timeout', label: t('Zeitüberschreitung', 'Timed out')},
                ]),
            ],
            transitions: [
                onOutcomeV2('ocpp-connect', 'connected', onboardingV2Target.success()),
                onOutcomeV2('ocpp-connect', 'timeout', onboardingV2Target.support('ocpp-timeout')),
            ],
        },
    ],
});

/** The scan found something: confirm it is ours, then hand over to manual setup. */
const foundGuide = defineOnboardingGuideV2({
    name: 'sim-device-found',
    vendorId: 'sim-vendor',
    modelIds: ['sim-model'],
    title: t('Gefundenes Gerät einrichten', 'Set up the device we found'),
    startVariant: EnyoOnboardingV2StartVariant.DeviceFoundConfig,
    startStepId: 'confirm',
    steps: [
        {
            id: 'confirm',
            name: 'confirm',
            title: t('Ist das dein Gerät?', 'Is this your device?'),
            blocks: [
                onboardingV2Block.dynamic('found-ip', EnyoOnboardingV2DynamicKind.DeviceIp),
                onboardingV2Block.deviceTest('device-test', t('Gerät testen', 'Test the device'), [
                    {id: 'created', value: 'appliances-created', label: t('Gerät eingerichtet', 'Device set up')},
                    {id: 'existed', value: 'appliances-already-existed', label: t('Schon vorhanden', 'Already there')},
                    {id: 'no-appliance', value: 'device-confirmed-no-appliance', label: t('Gerät bestätigt', 'Device confirmed')},
                    {id: 'unsupported', value: 'not-supported', label: t('Nicht unterstützt', 'Not supported')},
                    {id: 'unreachable', value: 'unreachable', label: t('Nicht erreichbar', 'Not reachable')},
                    {id: 'auth', value: 'authentication-required', label: t('Anmeldung nötig', 'Sign-in needed')},
                    {id: 'no-access', value: 'access-not-granted', label: t('Kein Zugriff', 'Access not granted')},
                    {id: 'user-action', value: 'user-action-required', label: t('Aktion am Gerät nötig', 'Action needed on the device')},
                    {id: 'failed', value: 'failed', label: t('Fehlgeschlagen', 'Failed')},
                ], EnyoOnboardingV2DeviceSelection.Detected),
            ],
            transitions: [
                onOutcomeV2('device-test', 'created', onboardingV2Target.success()),
                onOutcomeV2('device-test', 'existed', onboardingV2Target.success()),
                onOutcomeV2('device-test', 'no-appliance', onboardingV2Target.success()),
                onOutcomeV2('device-test', 'unsupported', onboardingV2Target.support('model-not-supported')),
                onOutcomeV2('device-test', 'unreachable', onboardingV2Target.variant(EnyoOnboardingV2StartVariant.ManualSetup)),
                onOutcomeV2('device-test', 'auth', onboardingV2Target.support('authentication-required')),
                onOutcomeV2('device-test', 'no-access', onboardingV2Target.support('access-not-granted')),
                onOutcomeV2('device-test', 'user-action', onboardingV2Target.support('user-action-required')),
                onOutcomeV2('device-test', 'failed', onboardingV2Target.support('device-test-failed')),
            ],
        },
    ],
});

/** Nothing was found and nothing is known: type it in by hand. */
const manualGuide = defineOnboardingGuideV2({
    name: 'sim-manual-setup',
    vendorId: 'sim-vendor',
    modelIds: ['sim-model'],
    title: t('Manuell einrichten', 'Set up by hand'),
    startVariant: EnyoOnboardingV2StartVariant.ManualSetup,
    startStepId: 'manual-intro',
    steps: [
        {
            id: 'manual-intro',
            name: 'manual-intro',
            title: t('Manuelle Einrichtung', 'Manual setup'),
            blocks: [
                onboardingV2Block.text('manual-text', t(
                    'Trage die Daten aus dem Typenschild ein.',
                    'Enter what the type plate says.'
                )),
                onboardingV2Block.auth('manual-auth', t('Beim Hersteller anmelden', 'Sign in with the vendor'), {
                    id: 'signed-in',
                    label: t('Anmelden', 'Sign in'),
                }, {requiresWebAuthentication: true}),
            ],
            transitions: [onOutcomeV2('manual-auth', 'signed-in', onboardingV2Target.success())],
        },
    ],
});

/** Maintenance: bound to an appliance that already exists. */
const maintenanceGuide = defineOnboardingGuideV2({
    name: 'sim-firmware-service',
    vendorId: 'sim-vendor',
    modelIds: ['sim-model'],
    title: t('Wallbox warten', 'Service the wallbox'),
    startVariant: EnyoOnboardingV2StartVariant.Maintenance,
    applianceId: 'sim-appliance',
    notifyUser: true,
    startStepId: 'service-intro',
    steps: [
        {
            id: 'service-intro',
            name: 'service-intro',
            title: t('Wartung', 'Maintenance'),
            blocks: [
                onboardingV2Block.text('service-text', t(
                    'Die Wallbox ist während der Wartung kurz offline.',
                    'The wallbox goes offline for a moment during this.'
                )),
            ],
            transitions: [onContinueV2(onboardingV2Target.success())],
        },
    ],
});

app.register(async (packageName, version, channel, deviceId) => {
    console.log(`fixture app registered: ${packageName} v${version} on ${channel} (${deviceId})`);

    await app.useOnboardingV2().registerOnboardingGuidesHandler(async request => ({
        requestId: request.requestId,
        guides: [wallboxGuide, foundGuide, manualGuide, maintenanceGuide],
        detail: 'onboarding-sim fixture',
    }));

    await app.useOnboardingV2().registerDynamicValueHandler(async request => {
        if (request.kind !== EnyoOnboardingV2DynamicKind.DeviceIp || !request.networkDeviceId) {
            // "Not available" is a normal answer — the host falls back or omits.
            return null;
        }
        return {requestId: request.requestId, kind: request.kind, value: '192.168.178.42'};
    });

    await app.useOnboardingV2().registerAdditionalSetupHandler(async request => {
        const token = request.values.find(value => value.name === 'token')?.value;
        // Never log the value itself — only whether it was accepted.
        console.log(`setup '${request.setupKey}': token ${token ? 'provided' : 'missing'}`);
        return {
            requestId: request.requestId,
            outcome: token === 'good-token' ? 'connected' : 'failed',
            message: token === 'good-token' ? t('Verbunden.', 'Connected.') : t('Token abgelehnt.', 'Token rejected.'),
        };
    });
});
