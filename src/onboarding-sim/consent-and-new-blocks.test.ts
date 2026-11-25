/**
 * The blocks and SDK surfaces added with SDK 1.80: consents (the `consent`
 * block, an additional setup's `consentKeys`, `useConsent()`), setup progress
 * and `maxDurationMs`, Zigbee pairing, the subscription offer, and validated
 * inputs. Each test builds its own small guide against an in-memory app, so a
 * failure points at one behaviour rather than at the fixture bundle.
 */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    EnyoConsentGrantorEnum,
    EnyoCurrencyEnum,
    EnyoOnboardingV2BlockType,
    EnyoOnboardingV2InputValueType,
    EnyoOnboardingV2StartVariant,
    EnyoOnboardingV2TargetType,
    EnyoOnboardingV2TransitionSourceKind,
    EnyoSubscriptionModeEnum,
    EnyoSubscriptionPaymentIntervalEnum,
    EnyoSubscriptionPricingModelEnum,
} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageConsent,
    EnergyAppPackageDefinition,
    EnyoConsentState,
    EnyoOnboardingV2AdditionalSetupRequest,
    EnyoOnboardingV2Block,
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2ZigbeePairingRequest,
} from '@enyo-energy/energy-app-sdk';
import {createMockSdk} from './mock-sdk.js';
import {loadEnergyApp, type LoadedApp} from './app-loader.js';
import {RunStore, setupBudgetMs} from './run-store.js';
import {consentRowsOf} from './render-model.js';
import {SIMULATED_ZIGBEE_DEVICES, simulatedZigbeeDevicesFor} from './simulated-world.js';

const t = (de: string, en = de) => [
    {language: 'de' as const, value: de},
    {language: 'en' as const, value: en},
];

const consent = (consentKey: string, overrides: Partial<EnergyAppPackageConsent> = {}): EnergyAppPackageConsent => ({
    consentKey,
    version: '1',
    required: true,
    grantableBy: [EnyoConsentGrantorEnum.Customer, EnyoConsentGrantorEnum.Installer],
    label: t(`Ich stimme ${consentKey} zu`),
    title: t(consentKey),
    legalText: {sections: [{heading: t('1.'), content: t('Text')}]},
    ...overrides,
});

/**
 * A guide whose first step holds `block`, leaving through each of the given
 * outcomes to a step of its own — so a test can tell where a run went by the
 * step it lands on (`after-<outcomeId>`).
 */
const guideAround = (block: EnyoOnboardingV2Block, outcomeIds: string[], skipId?: string): EnyoOnboardingV2Guide => {
    const exits = [...outcomeIds, ...(skipId ? [skipId] : [])];
    return {
        title: t('Test'),
        startVariant: EnyoOnboardingV2StartVariant.ManualSetup,
        requiresNetworkScan: false,
        startStepId: 'ask',
        steps: [
            {
                id: 'ask',
                name: 'ask',
                title: t('Frage'),
                blocks: [block],
                transitions: exits.map(id => ({
                    id: `t-${id}`,
                    source: id === skipId
                        ? {kind: EnyoOnboardingV2TransitionSourceKind.Skip, blockId: block.id, skipId: id}
                        : {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId: block.id, outcomeId: id},
                    target: {type: EnyoOnboardingV2TargetType.Step, stepId: `after-${id}`},
                })),
            },
            ...exits.map(id => ({
                id: `after-${id}`,
                name: `after-${id}`,
                title: t(id),
                blocks: [{id: `text-${id}`, type: EnyoOnboardingV2BlockType.Text, text: t(id)}] as EnyoOnboardingV2Block[],
                transitions: [{
                    id: `done-${id}`,
                    source: {kind: EnyoOnboardingV2TransitionSourceKind.Continue} as const,
                    target: {type: EnyoOnboardingV2TargetType.Success} as const,
                }],
            })),
        ],
    } as EnyoOnboardingV2Guide;
};

const appFor = (
    guide: EnyoOnboardingV2Guide,
    options: {consents?: EnergyAppPackageConsent[]; definition?: Partial<EnergyAppPackageDefinition>} = {}
): LoadedApp => {
    const consents = options.consents ?? [];
    return {
        packageName: 'test',
        cwd: process.cwd(),
        entryPath: 'dist/index.js',
        files: [],
        consents,
        definition: options.definition as EnergyAppPackageDefinition | undefined,
        mock: createMockSdk({consents}),
        guides: [guide],
        answer: 'guides',
        validation: {result: {ok: true, errors: [], warnings: []}, guides: []},
        logs: [],
        reload: async () => undefined,
    };
};

const startOn = (app: LoadedApp, onEvent?: (message: string, level?: string) => void) => {
    const store = new RunStore(app, onEvent);
    const run = store.createRun(0);
    return {store, runId: run.id};
};

const currentStep = async (store: RunStore, runId: string) => (await store.view(runId)).step?.name;

const consentBlock = (keys: string[]): EnyoOnboardingV2Block => ({
    id: 'consent',
    type: EnyoOnboardingV2BlockType.Consent,
    consentKeys: keys,
    cta: t('Zustimmen und weiter'),
    outcomes: [
        {id: 'given', value: 'given', label: t('Zugestimmt')},
        {id: 'declined', value: 'declined', label: t('Abgelehnt')},
    ],
});

describe('useConsent() in the mock SDK', () => {
    it('answers one ungranted state per declared consent, in declaration order', async () => {
        const mock = createMockSdk({consents: [consent('a'), consent('b')]});
        const api = mock.instance.useConsent();
        assert.deepEqual(await api.getConsents(), [
            {consentKey: 'a', granted: false},
            {consentKey: 'b', granted: false},
        ]);
        assert.equal(await api.getConsent('unknown'), null);
    });

    it('tells the app\'s listeners when the simulator gives or withdraws one', async () => {
        const mock = createMockSdk({consents: [consent('a', {version: '3'})]});
        const heard: EnyoConsentState[] = [];
        const id = mock.instance.useConsent().listenForConsentChanges(state => {
            heard.push(state);
        });

        mock.setConsent('a', true, EnyoConsentGrantorEnum.Customer);
        mock.setConsent('a', false);
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(heard.length, 2);
        assert.equal(heard[0].granted, true);
        assert.equal(heard[0].version, '3');
        assert.equal(heard[0].grantedBy, EnyoConsentGrantorEnum.Customer);
        assert.equal(heard[1].granted, false);
        assert.ok(heard[1].revokedAtIso);

        mock.instance.useConsent().removeListener(id);
        mock.setConsent('a', true, EnyoConsentGrantorEnum.Customer);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(heard.length, 2);
        assert.equal(mock.setConsent('unknown', true), null);
    });

    it('offers the SDK 1.80 accessors, and reports no Zigbee radio', async () => {
        const mock = createMockSdk();
        assert.equal(await mock.instance.isZigbeeSupported(), false);
        assert.equal(await mock.instance.isMatterSupported(), false);
        assert.ok(mock.instance.useZigbee());
        assert.ok(mock.instance.useAuthenticationV2());
    });
});

describe('consent block', () => {
    const consents = [
        consent('terms', {grantableBy: [EnyoConsentGrantorEnum.Customer]}),
        consent('share-usage-data', {required: false}),
    ];

    it('keeps the run on the step while a required consent the role may not give is missing', async () => {
        const {store, runId} = startOn(appFor(guideAround(consentBlock(['terms', 'share-usage-data']), ['given', 'declined']), {consents}));

        const resolution = store.giveConsents(runId, 'consent', {terms: true, 'share-usage-data': true}, EnyoConsentGrantorEnum.Installer);

        assert.equal(resolution.given, false);
        assert.deepEqual(resolution.missing, ['terms']);
        assert.deepEqual(resolution.refused, ['terms']);
        assert.equal(await currentStep(store, runId), 'ask');
        // The voluntary one the installer may give is recorded anyway.
        assert.equal(resolution.states.find(state => state.consentKey === 'share-usage-data')?.granted, true);
    });

    it('fires `given` once the customer agrees', async () => {
        const app = appFor(guideAround(consentBlock(['terms', 'share-usage-data']), ['given', 'declined']), {consents});
        const {store, runId} = startOn(app);

        const resolution = store.giveConsents(runId, 'consent', {terms: true}, EnyoConsentGrantorEnum.Customer);

        assert.equal(resolution.given, true);
        assert.equal(await currentStep(store, runId), 'after-given');
        const states = await app.mock.instance.useConsent().getConsents();
        assert.equal(states[0].granted, true);
        assert.equal(states[0].grantedBy, EnyoConsentGrantorEnum.Customer);
        assert.equal(states[1].granted, false);
    });

    it('takes `given` straight away when the consents are already in force', async () => {
        const app = appFor(guideAround(consentBlock(['terms']), ['given']), {consents});
        const {store, runId} = startOn(app);
        store.setConsent('terms', true, EnyoConsentGrantorEnum.Customer);

        assert.equal(store.giveConsents(runId, 'consent', {}, EnyoConsentGrantorEnum.Installer).given, true);
    });

    it('renders one row per key, with an undeclared key flagged and an old version unticked', async () => {
        const rows = consentRowsOf(['terms', 'nope'], consents, [
            {consentKey: 'terms', version: '0', granted: true, grantedBy: EnyoConsentGrantorEnum.Customer},
        ]);
        assert.equal(rows[0].declared, true);
        assert.equal(rows[0].granted, false);
        assert.equal(rows[1].declared, false);

        const {store, runId} = startOn(appFor(guideAround(consentBlock(['terms']), ['given']), {consents}));
        const input = (await store.view(runId)).renderModel.input;
        assert.equal(input.kind, 'consent');
        assert.equal(input.kind === 'consent' && input.consents[0].consentKey, 'terms');
    });
});

describe('additional setup: consents, progress and maxDurationMs', () => {
    const phases = [
        {key: 'backup', label: t('Backup')},
        {key: 'developer-mode', label: t('Entwicklermodus')},
    ];
    const setupBlock = (overrides: Record<string, unknown> = {}): EnyoOnboardingV2Block => ({
        id: 'setup',
        type: EnyoOnboardingV2BlockType.AdditionalSetup,
        setupKey: 'connect-hcu',
        cta: t('Verbinden'),
        description: t('Verbindet die HCU'),
        outcomes: [
            {id: 'ok', value: 'connected', label: t('Verbunden')},
            {id: 'failed', value: 'failed', label: t('Fehlgeschlagen')},
        ],
        consentKeys: ['backup'],
        progressPhases: phases,
        ...overrides,
    } as EnyoOnboardingV2Block);

    it('refuses to run while a required consent is unticked', async () => {
        const app = appFor(guideAround(setupBlock(), ['ok', 'failed']), {consents: [consent('backup')]});
        const {store, runId} = startOn(app);
        await assert.rejects(() => store.runAdditionalSetup(runId, 'setup', [], {}), /Required consent/);
    });

    it('passes the answers in request.consents and checks every progress report', async () => {
        const app = appFor(guideAround(setupBlock({maxDurationMs: 120_000}), ['ok', 'failed']), {consents: [consent('backup')]});
        let request: EnyoOnboardingV2AdditionalSetupRequest | undefined;
        const onboarding = app.mock.instance.useOnboardingV2();
        await onboarding.registerAdditionalSetupHandler(async received => {
            request = received;
            await onboarding.reportSetupProgress(received.requestId, {phaseKey: 'backup', percent: 10});
            await onboarding.reportSetupProgress(received.requestId, {phaseKey: 'no-such-phase'});
            await onboarding.reportSetupProgress(received.requestId, {phaseKey: 'developer-mode', percent: 60});
            return {requestId: received.requestId, outcome: 'connected'};
        });
        const printed: string[] = [];
        const {store, runId} = startOn(app, message => printed.push(message));

        const resolution = await store.runAdditionalSetup(runId, 'setup', [], {backup: true}, EnyoConsentGrantorEnum.Installer);

        assert.equal(resolution.outcomeId, 'ok');
        assert.equal(request?.timeoutMs, 120_000);
        assert.equal(request?.consents?.[0].consentKey, 'backup');
        assert.equal(request?.consents?.[0].granted, true);

        const progress = store.progressOf(runId).setup;
        assert.equal(progress.reports.length, 3);
        assert.deepEqual(progress.reports[0].errors, []);
        assert.ok(progress.reports[1].errors.length > 0, 'an unknown phase key is an error');
        // The rejected report does not move the progress; the next good one does.
        assert.equal(progress.phaseKey, 'developer-mode');
        assert.equal(progress.percent, 60);
        assert.equal(progress.finished, true);
        assert.ok(printed.some(line => line.includes('Setup progress')));
        assert.equal(await currentStep(store, runId), 'after-ok');
    });

    it('uses the block\'s maxDurationMs as the budget, and fails when it runs out', async () => {
        assert.equal(setupBudgetMs({}), 60_000);
        assert.equal(setupBudgetMs({maxDurationMs: 10 * 60_000}), 10 * 60_000);
        assert.equal(setupBudgetMs({maxDurationMs: 60 * 60_000}), 15 * 60_000);

        const app = appFor(guideAround(setupBlock({maxDurationMs: 20, consentKeys: undefined}), ['ok', 'failed']));
        await app.mock.instance.useOnboardingV2().registerAdditionalSetupHandler(
            () => new Promise(resolve => setTimeout(() => resolve({requestId: 'late', outcome: 'connected'}), 200))
        );
        const {store, runId} = startOn(app);

        const resolution = await store.runAdditionalSetup(runId, 'setup', []);

        assert.equal(resolution.fellBackToFailed, true);
        assert.match(resolution.note ?? '', /20 ms/);
        assert.equal(await currentStep(store, runId), 'after-failed');
    });

    it('renders the consents and phases with the setup', async () => {
        const app = appFor(guideAround(setupBlock(), ['ok', 'failed']), {consents: [consent('backup')]});
        const {store, runId} = startOn(app);
        const input = (await store.view(runId)).renderModel.input;
        assert.equal(input.kind, 'additional-setup');
        if (input.kind === 'additional-setup') {
            assert.equal(input.consents.length, 1);
            assert.deepEqual(input.progressPhases?.map(phase => phase.key), ['backup', 'developer-mode']);
        }
    });
});

describe('zigbee pairing', () => {
    const zigbeeBlock = (overrides: Record<string, unknown> = {}): EnyoOnboardingV2Block => ({
        id: 'pair',
        type: EnyoOnboardingV2BlockType.ZigbeePairing,
        outcomes: [
            {id: 'paired', value: 'paired', label: t('Gekoppelt')},
            {id: 'not-found', value: 'not-found', label: t('Nicht gefunden')},
        ],
        ...overrides,
    } as EnyoOnboardingV2Block);

    it('filters case-insensitively and trimmed, conjunctively, and excludes a device without a name', () => {
        assert.equal(simulatedZigbeeDevicesFor().length, SIMULATED_ZIGBEE_DEVICES.length);
        assert.equal(simulatedZigbeeDevicesFor([' simtherm ']).length, 2);
        assert.equal(simulatedZigbeeDevicesFor(['SimTherm'], ['sp-200']).length, 1);
        assert.equal(simulatedZigbeeDevicesFor(['Other']).length, 0);
    });

    it('confirms up to maxDevices devices in one request and takes `paired`', async () => {
        const app = appFor(guideAround(zigbeeBlock({manufacturerNames: ['SimTherm'], maxDevices: 2}), ['paired', 'not-found']));
        let request: EnyoOnboardingV2ZigbeePairingRequest | undefined;
        await app.mock.instance.useOnboardingV2().registerZigbeePairingHandler(async received => {
            request = received;
            return {requestId: received.requestId, applianceIds: ['zigbee-appliance']};
        });
        const {store, runId} = startOn(app);

        const view = await store.view(runId);
        const picker = view.pickers.pair;
        assert.equal(picker.kind, 'zigbee-pairing');
        assert.equal(picker.maxDevices, 2);
        // Exactly maxDevices matching devices joined: the app highlights them all.
        assert.equal(picker.preselectedKeys?.length, 2);

        const keys = picker.candidates.map(candidate => candidate.key);
        const resolution = await store.pick(runId, 'pair', keys, true);

        assert.equal(request?.devices.length, 2);
        assert.equal(request?.autoSelected, true);
        assert.deepEqual(resolution.applianceIds, ['zigbee-appliance']);
        const after = await store.view(runId);
        assert.equal(after.step?.name, 'after-paired');
        assert.deepEqual(after.context.zigbeeIeeeAddresses, keys);
        assert.equal(after.context.applianceId, 'zigbee-appliance');
    });

    it('refuses more devices than maxDevices', async () => {
        const app = appFor(guideAround(zigbeeBlock(), ['paired', 'not-found']));
        const {store, runId} = startOn(app);
        const keys = SIMULATED_ZIGBEE_DEVICES.slice(0, 2).map(device => device.ieeeAddress);
        await assert.rejects(() => store.pick(runId, 'pair', keys), /between 1 and 1/);
    });

    it('still pairs without a handler, unbound', async () => {
        const app = appFor(guideAround(zigbeeBlock(), ['paired', 'not-found']));
        const {store, runId} = startOn(app);
        const resolution = await store.pick(runId, 'pair', SIMULATED_ZIGBEE_DEVICES[0].ieeeAddress);
        assert.equal(resolution.source, 'no-handler');
        assert.equal(await currentStep(store, runId), 'after-paired');
    });
});

describe('subscription offer', () => {
    const plan = (planKey: string) => ({
        planKey,
        paymentInterval: EnyoSubscriptionPaymentIntervalEnum.Yearly,
        pricingModel: EnyoSubscriptionPricingModelEnum.PerPackage,
        prices: [{amountWithoutTax: 83.19, currency: EnyoCurrencyEnum.EUR}],
        storeEntry: [{language: 'de' as const, title: planKey}, {language: 'en' as const, title: planKey}],
    });
    const offerBlock: EnyoOnboardingV2Block = {
        id: 'offer',
        type: EnyoOnboardingV2BlockType.SubscriptionOffer,
        planKeys: ['premium', 'ghost'],
        outcomes: [
            {id: 'subscribed', value: 'subscribed', label: t('Gebucht')},
            {id: 'declined', value: 'declined', label: t('Ohne Abo')},
        ],
    } as EnyoOnboardingV2Block;
    const definition = {
        subscriptionPlans: [plan('premium'), plan('basic')],
        subscriptionMode: EnyoSubscriptionModeEnum.Optional,
    } as unknown as Partial<EnergyAppPackageDefinition>;

    it('renders only the offered plans, names the undeclared ones, and follows the package mode', async () => {
        const {store, runId} = startOn(appFor(guideAround(offerBlock, ['subscribed', 'declined']), {definition}));
        const input = (await store.view(runId)).renderModel.input;
        assert.equal(input.kind, 'subscription-offer');
        if (input.kind === 'subscription-offer') {
            assert.deepEqual(input.plans.map(entry => entry.planKey), ['premium']);
            assert.deepEqual(input.unknownPlanKeys, ['ghost']);
            assert.equal(input.mode, 'optional');
        }
    });

    it('fires `subscribed` on a simulated purchase, and only for an offered plan', async () => {
        const {store, runId} = startOn(appFor(guideAround(offerBlock, ['subscribed', 'declined']), {definition}));
        assert.throws(() => store.subscribe(runId, 'offer', 'basic'), /not offered/);
        store.subscribe(runId, 'offer', 'premium');
        const view = await store.view(runId);
        assert.equal(view.step?.name, 'after-subscribed');
        assert.deepEqual(view.subscriptions, ['premium']);
    });
});

describe('validated input', () => {
    const inputBlock: EnyoOnboardingV2Block = {
        id: 'serial',
        type: EnyoOnboardingV2BlockType.Input,
        valueType: EnyoOnboardingV2InputValueType.Text,
        label: t('Seriennummer'),
        submitLabel: t('Prüfen'),
        validated: true,
        outcomes: [
            {id: 'ok', value: 'reachable', label: t('OK')},
            {id: 'no', value: 'unreachable', label: t('Nein')},
        ],
    } as EnyoOnboardingV2Block;

    it('keeps the installer on the step with the app\'s message when the app rejects the value', async () => {
        const app = appFor(guideAround(inputBlock, ['ok', 'no']));
        await app.mock.instance.useOnboardingV2().registerInputValidationHandler(async request => ({
            requestId: request.requestId,
            valid: request.value === 'SN-1',
            errorMessage: t('Unbekannte Seriennummer'),
        }));
        const {store, runId} = startOn(app);

        assert.equal((await store.checkInputWithApp(runId, 'serial', 'wrong')).valid, false);
        const rejected = (await store.view(runId)).renderModel.input;
        assert.equal(rejected.kind === 'input' && rejected.validated, true);
        assert.deepEqual(rejected.kind === 'input' && rejected.validationError, t('Unbekannte Seriennummer'));

        assert.equal((await store.checkInputWithApp(runId, 'serial', 'SN-1')).valid, true);
        const accepted = (await store.view(runId)).renderModel.input;
        assert.equal(accepted.kind === 'input' && accepted.validationError, undefined);
    });

    it('accepts every value without a handler', async () => {
        const {store, runId} = startOn(appFor(guideAround(inputBlock, ['ok', 'no'])));
        assert.deepEqual(await store.checkInputWithApp(runId, 'serial', 'anything'), {valid: true, note: 'no-handler'});
    });
});

describe('guide validation against the declared consents', () => {
    /** A bundle whose guides handler answers with one consent-block guide. */
    const writeBundle = (): string => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-sim-consent-'));
        fs.mkdirSync(path.join(dir, 'dist'));
        const guide = guideAround(consentBlock(['terms']), ['given']);
        fs.writeFileSync(
            path.join(dir, 'dist/index.js'),
            `energyAppSdkInstance.register(async () => {
                await energyAppSdkInstance.useOnboardingV2().registerOnboardingGuidesHandler(async request => ({
                    requestId: request.requestId,
                    guides: [${JSON.stringify(guide)}],
                }));
            });`
        );
        return dir;
    };

    it('counts an undeclared consentKey as an error, and a declared one as fine', async () => {
        const dir = writeBundle();
        try {
            const base = {packageName: 'test', version: '1'} as unknown as EnergyAppPackageDefinition;
            const undeclared = await loadEnergyApp({cwd: dir, config: {...base, consents: [consent('other')]}});
            const declared = await loadEnergyApp({cwd: dir, config: {...base, consents: [consent('terms')]}});

            const mentionsTerms = (errors: string[]) => errors.some(error => error.includes('terms'));
            assert.ok(mentionsTerms(undeclared.validation.guides[0].errors), undeclared.validation.guides[0].errors.join('\n'));
            assert.ok(mentionsTerms(undeclared.validation.result.errors));
            assert.ok(!mentionsTerms(declared.validation.guides[0].errors), declared.validation.guides[0].errors.join('\n'));
            // The declared consents also reach useConsent().
            assert.equal(declared.mock.state.consentStates[0].consentKey, 'terms');
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
