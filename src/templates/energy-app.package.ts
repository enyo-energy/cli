import { defineEnergyAppPackage } from "@enyo-energy/energy-app-sdk";

export default defineEnergyAppPackage({
    version: '1',
    packageName: 'example-package',
    permissions: [
        'RestrictedInternetAccess'
    ],
    options: {
        restrictedInternetAccess: {
            origins: ['localhost:6020']
        }
    },
    // Optional: a static manual setup guide for pre-app onboarding. Manual setup
    // only — no scans, device pickers, device tests or dynamic blocks. `enyo release` validates it and aborts on errors;
    // `enyo onboarding-sim` lets you walk it. Image blocks reference `files` by name.
    // Needs defineOnboardingGuideV2, EnyoOnboardingV2StartVariant, onboardingV2Block,
    // onboardingV2Target and onContinueV2 imported from the SDK.
    //
    // onboardingGuide: defineOnboardingGuideV2({
    //     title: [{language: 'en', value: 'Set up the device manually'}],
    //     startVariant: EnyoOnboardingV2StartVariant.ManualSetup,
    //     requiresNetworkScan: false,
    //     startStepId: 'prepare',
    //     steps: [
    //         {
    //             id: 'prepare',
    //             name: 'enable-modbus',
    //             title: [{language: 'en', value: 'Enable Modbus TCP'}],
    //             blocks: [
    //                 onboardingV2Block.text('intro', [{language: 'en', value: 'Enable Modbus TCP in the device web interface.'}]),
    //             ],
    //             transitions: [onContinueV2(onboardingV2Target.success())],
    //         },
    //     ],
    // }),
    // Optional: paid plans enyo sells for this app (offer screen, checkout,
    // renewals). Prices are net — customers see gross. Plans require the
    // Subscriptions permission; `enyo release` validates them and aborts on errors.
    // Needs EnergyAppPermissionTypeEnum, EnyoSubscriptionPaymentIntervalEnum,
    // EnyoSubscriptionPricingModelEnum, EnyoCurrencyEnum, EnyoSubscriptionPlanHighlightEnum
    // and EnyoSubscriptionOfferIconEnum imported from the SDK.
    //
    // permissions: [EnergyAppPermissionTypeEnum.Subscriptions, ...],
    // subscriptionPlans: [{
    //     planKey: 'premium',
    //     paymentInterval: EnyoSubscriptionPaymentIntervalEnum.Yearly,
    //     pricingModel: EnyoSubscriptionPricingModelEnum.PerPackage, // or PerUnit (billed per reported vehicle/device)
    //     prices: [{amountWithoutTax: 83.19, currency: EnyoCurrencyEnum.EUR}],
    //     trialDays: 30,
    //     storeEntry: [
    //         {language: 'de', title: 'Premium', shortDescription: '…', benefits: ['…']},
    //         {language: 'en', title: 'Premium', shortDescription: '…', benefits: ['…']},
    //     ],
    //     includedFeatures: ['price-optimisation'], // keys of subscriptionFeatures
    //     highlight: EnyoSubscriptionPlanHighlightEnum.Recommended, // at most one plan
    // }],
    //
    // Optional (SDK ≥ 1.45): how enyo presents the plans. Declare each feature
    // once, describe the free tier (subscriptionMode 'optional' only) and build
    // the offer screen from blocks: hero, features, comparison, hint, plans.
    // subscriptionFeatures: [{
    //     featureKey: 'price-optimisation',
    //     icon: EnyoSubscriptionOfferIconEnum.PiggyBank,
    //     storeEntry: [
    //         {language: 'de', title: 'Optimierung nach dynamischen Preisen'},
    //         {language: 'en', title: 'Dynamic price optimisation'},
    //     ],
    // }],
    // subscriptionFreeTier: {
    //     storeEntry: [{language: 'de', title: 'Basis'}, {language: 'en', title: 'Basic'}],
    //     includedFeatures: [],
    // },
    // subscriptionOfferScreen: {
    //     blocks: [
    //         {type: 'hero', icon: 'piggy-bank', storeEntry: [
    //             {language: 'de', title: 'Günstiger laden'},
    //             {language: 'en', title: 'Charge for less'},
    //         ]},
    //         {type: 'comparison'},
    //         {type: 'hint', kind: 'pricing-reason', storeEntry: [
    //             {language: 'de', text: 'Die Fahrzeughersteller berechnen uns jedes verbundene Fahrzeug.'},
    //             {language: 'en', text: 'The car vendors charge us for every connected vehicle.'},
    //         ]},
    //         {type: 'plans'},
    //     ],
    // },
    //
    // Optional (SDK ≥ 1.80): consents a person agrees to — declared once here,
    // asked for by key in a guide's `consent` block or an additional-setup
    // block's `consentKeys`, and read by the app through useConsent(). Bump
    // `version` whenever the meaning of the text changes: earlier answers then
    // stop counting. `enyo release` validates them and aborts on errors.
    // Needs EnyoConsentGrantorEnum imported from the SDK.
    //
    // consents: [{
    //     consentKey: 'backup-and-developer-mode',
    //     version: '1',
    //     required: true,
    //     grantableBy: [EnyoConsentGrantorEnum.Customer, EnyoConsentGrantorEnum.Installer],
    //     label: [
    //         {language: 'de', value: 'Ich erlaube enyo, ein Backup zu erstellen und den Entwicklermodus einzuschalten.'},
    //         {language: 'en', value: 'I allow enyo to create a backup and switch on developer mode.'},
    //     ],
    //     title: [
    //         {language: 'de', value: 'Backup und Entwicklermodus'},
    //         {language: 'en', value: 'Backup and developer mode'},
    //     ],
    //     legalText: {
    //         sections: [{
    //             heading: [{language: 'de', value: '1. Backup'}, {language: 'en', value: '1. Backup'}],
    //             content: [{language: 'de', value: '…'}, {language: 'en', value: '…'}],
    //         }],
    //         urls: [{language: 'de', url: 'https://example.com/agb'}], // optional
    //     },
    // }],
})
