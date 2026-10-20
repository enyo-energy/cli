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
    // EnyoSubscriptionPricingModelEnum and EnyoCurrencyEnum imported from the SDK.
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
    // }],
})
