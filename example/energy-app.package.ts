import {defineConnectEmsPackage} from "../../connect-ems-api";

export default defineConnectEmsPackage({
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