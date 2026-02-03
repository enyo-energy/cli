import {defineEnergyAppPackage, EnergyAppPackageCategory} from "@enyo-energy/energy-app-sdk";

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
    logo: undefined,
    storeEntry: [
        {
            language: 'en',
            title: 'My Energy App',
            description: 'My Energy App Description',
            shortDescription: 'My Energy App Description'
        }
    ],
    categories: [EnergyAppPackageCategory.Meter]
})