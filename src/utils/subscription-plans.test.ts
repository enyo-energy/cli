import {test, describe, mock, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import {
    EnergyAppPermissionTypeEnum,
    EnyoCurrencyEnum,
    EnyoSubscriptionModeEnum,
    EnyoSubscriptionPaymentIntervalEnum,
    EnyoSubscriptionPricingModelEnum
} from '@enyo-energy/energy-app-sdk';
import type {EnergyAppPackageDefinition, EnergyAppPackageSubscriptionPlan} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {
    describeSubscriptionOffer,
    describeSubscriptionPlan,
    validateSubscriptionPlansDeclaration
} from './subscription-plans.js';
import {hashReleaseDefinition} from './fingerprint.js';
import {buildCreateReleasePayload, prepareRelease} from '../commands/release.js';

afterEach(() => {
    mock.restoreAll();
});

/** A sellable plan: yearly, one EUR price, a trial, both required languages. */
const premiumPlan = (amountWithoutTax = 83.19): EnergyAppPackageSubscriptionPlan => ({
    planKey: 'premium',
    paymentInterval: EnyoSubscriptionPaymentIntervalEnum.Yearly,
    pricingModel: EnyoSubscriptionPricingModelEnum.PerPackage,
    prices: [{amountWithoutTax, currency: EnyoCurrencyEnum.EUR}],
    trialDays: 30,
    storeEntry: [
        {language: 'de', title: 'Premium', shortDescription: 'Optimiert deine Wärmepumpe.'},
        {language: 'en', title: 'Premium', shortDescription: 'Optimises your heat pump.'}
    ]
});

/** A minimal definition with the Subscriptions permission, plus the given plans. */
const definitionWith = (
    subscriptionPlans: EnergyAppPackageSubscriptionPlan[] | undefined,
    overrides: Partial<EnergyAppPackageDefinition> = {}
): EnergyAppPackageDefinition => ({
    version: '1',
    packageName: 'test-package',
    sdkVersion: '0.0.195',
    permissions: [EnergyAppPermissionTypeEnum.Subscriptions],
    categories: [],
    storeEntry: [],
    compatibility: [],
    // Plans need a declared mode since SDK 1.38.
    ...(subscriptionPlans ? {subscriptionPlans, subscriptionMode: EnyoSubscriptionModeEnum.Required} : {}),
    ...overrides
} as unknown as EnergyAppPackageDefinition);

/** Silences the validator's console output and returns the error-line spy. */
const silenceConsole = () => {
    mock.method(console, 'log', () => {});
    return mock.method(console, 'error', () => {});
};

describe('validateSubscriptionPlansDeclaration', () => {
    test('passes a package declaring no plans', () => {
        assert.doesNotThrow(() => validateSubscriptionPlansDeclaration(definitionWith(undefined, {permissions: []})));
    });

    test('passes valid plans', () => {
        assert.doesNotThrow(() => validateSubscriptionPlansDeclaration(definitionWith([premiumPlan()])));
    });

    test('rejects plans without the Subscriptions permission', () => {
        const errors = silenceConsole();
        assert.throws(
            () => validateSubscriptionPlansDeclaration(definitionWith([premiumPlan()], {permissions: []})),
            CLIError
        );
        assert.ok(errors.mock.calls.some((call) => /Subscriptions` permission/.test(String(call.arguments[0]))));
    });

    test('rejects a plan without an en store entry', () => {
        silenceConsole();
        const plan = premiumPlan();
        plan.storeEntry = plan.storeEntry.filter((entry) => entry.language !== 'en');
        assert.throws(() => validateSubscriptionPlansDeclaration(definitionWith([plan])), CLIError);
    });

    test('rejects a trial on a one-time plan', () => {
        silenceConsole();
        const plan = {...premiumPlan(), paymentInterval: EnyoSubscriptionPaymentIntervalEnum.OneTime};
        assert.throws(() => validateSubscriptionPlansDeclaration(definitionWith([plan])), CLIError);
    });

    test('prints warnings and never blocks on them', () => {
        const log = mock.method(console, 'log', () => {});
        assert.doesNotThrow(() =>
            validateSubscriptionPlansDeclaration(definitionWith([premiumPlan()]), () => ({
                ok: true,
                errors: [],
                warnings: ['premium: consider a monthly plan too.']
            }))
        );
        assert.deepEqual(log.mock.calls.map((call) => call.arguments[0]), [
            '⚠️ Subscription plans: premium: consider a monthly plan too.'
        ]);
    });
});

describe('describeSubscriptionPlan', () => {
    test('says the price is net and names the trial', () => {
        assert.equal(describeSubscriptionPlan(premiumPlan()), 'premium — yearly, 83.19 EUR net, 30 days trial');
    });

    test('marks per-unit plans and omits a missing trial', () => {
        const {trialDays: _trial, ...plan} = premiumPlan(4.5);
        assert.equal(
            describeSubscriptionPlan({...plan, pricingModel: EnyoSubscriptionPricingModelEnum.PerUnit}),
            'premium — yearly, 4.50 EUR net per unit'
        );
    });
});

describe('prepareRelease with subscription plans', () => {
    test('throws for invalid plans before any network call', async () => {
        silenceConsole();
        const request = mock.method(https, 'request', () => {
            throw new Error('no network in this test');
        });

        await assert.rejects(
            prepareRelease(definitionWith([premiumPlan()], {permissions: []}), 'production'),
            (error: unknown) =>
                error instanceof CLIError && /Subscription plans declaration is invalid/.test(error.message)
        );
        assert.equal(request.mock.callCount(), 0);
    });
});

describe('buildCreateReleasePayload with subscription plans', () => {
    test('carries the plans verbatim', () => {
        const plans = [premiumPlan()];
        const payload = buildCreateReleasePayload(definitionWith(plans), undefined, 'production', []);
        assert.equal(payload.subscriptionPlans, plans);
    });

    test('changes the definition hash when only a price changes', () => {
        const hashOf = (amount: number) =>
            hashReleaseDefinition(
                buildCreateReleasePayload(definitionWith([premiumPlan(amount)]), undefined, 'production', [])
            );

        assert.equal(hashOf(83.19), hashOf(83.19));
        assert.notEqual(hashOf(83.19), hashOf(91.6));
    });
});

/** SDK 1.45: a feature catalog, a free tier and an offer screen built from blocks. */
const offerDeclaration = (): Partial<EnergyAppPackageDefinition> => ({
    subscriptionMode: EnyoSubscriptionModeEnum.Optional,
    subscriptionFeatures: [{
        featureKey: 'price-optimisation',
        icon: 'piggy-bank',
        storeEntry: [
            {language: 'de', title: 'Optimierung nach dynamischen Preisen'},
            {language: 'en', title: 'Dynamic price optimisation'}
        ]
    }],
    subscriptionFreeTier: {
        storeEntry: [{language: 'de', title: 'Basis'}, {language: 'en', title: 'Basic'}],
        includedFeatures: []
    },
    subscriptionOfferScreen: {
        blocks: [
            {type: 'hero', storeEntry: [{language: 'de', title: 'Günstiger laden'}, {language: 'en', title: 'Charge for less'}]},
            {type: 'comparison'},
            {type: 'plans'}
        ]
    }
});
const featuredPlan = (): EnergyAppPackageSubscriptionPlan => ({
    ...premiumPlan(),
    includedFeatures: ['price-optimisation'],
    highlight: 'recommended'
});

describe('subscription offer screen (SDK 1.45)', () => {
    test('passes a valid offer declaration', () => {
        assert.doesNotThrow(() =>
            validateSubscriptionPlansDeclaration(definitionWith([featuredPlan()], offerDeclaration())));
    });

    test('rejects a free tier on an app that requires a plan', () => {
        silenceConsole();
        assert.throws(
            () => validateSubscriptionPlansDeclaration(definitionWith([featuredPlan()], {
                ...offerDeclaration(),
                subscriptionMode: EnyoSubscriptionModeEnum.Required
            })),
            CLIError
        );
    });

    test('rejects a plan including a feature that is not declared', () => {
        silenceConsole();
        assert.throws(
            () => validateSubscriptionPlansDeclaration(definitionWith(
                [{...featuredPlan(), includedFeatures: ['unknown-feature']}],
                offerDeclaration()
            )),
            CLIError
        );
    });

    test('carries the offer declaration in the create-release payload', () => {
        const offer = offerDeclaration();
        const payload = buildCreateReleasePayload(definitionWith([featuredPlan()], offer), undefined, 'production', []);
        assert.equal(payload.subscriptionFeatures, offer.subscriptionFeatures);
        assert.equal(payload.subscriptionFreeTier, offer.subscriptionFreeTier);
        assert.equal(payload.subscriptionOfferScreen, offer.subscriptionOfferScreen);
        assert.deepEqual((payload.subscriptionPlans as EnergyAppPackageSubscriptionPlan[])[0].highlight, 'recommended');
    });

    test('changes the definition hash when only the offer screen changes', () => {
        const hashWith = (blocks: NonNullable<EnergyAppPackageDefinition['subscriptionOfferScreen']>['blocks']) =>
            hashReleaseDefinition(buildCreateReleasePayload(
                definitionWith([featuredPlan()], {...offerDeclaration(), subscriptionOfferScreen: {blocks}}),
                undefined,
                'production',
                []
            ));

        assert.notEqual(hashWith([{type: 'plans'}]), hashWith([{type: 'comparison'}, {type: 'plans'}]));
    });

    test('summarises the offer and the plan highlight', () => {
        assert.equal(
            describeSubscriptionOffer(definitionWith([featuredPlan()], offerDeclaration())),
            '1 feature, free tier, blocks: hero → comparison → plans'
        );
        assert.equal(describeSubscriptionOffer(definitionWith([premiumPlan()])), undefined);
        assert.equal(describeSubscriptionPlan(featuredPlan()), 'premium — yearly, 83.19 EUR net, 30 days trial, recommended');
    });
});
