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
    }
})
