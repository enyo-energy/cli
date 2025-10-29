export const RS_BUILD_CONFIG = `import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  output: {
    target: 'node',
  },
});
`;

export const TS_CONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "ESNext",
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "moduleResolution": "bundler",
    "useDefineForClassFields": true
  },
  "include": ["src"]
}
`;

export const EXAMPLE_INDEX_FILE = `import {EnergyApp} from "../../connect-ems-api";

const client = new EnergyApp();

client.register((packageName: string, version: number) => {
    // The packageName and version number is provided by the released package in the HEMS one Marketplace. You can use that information for whatever you want.
    console.log(\`network state is \${client.isOnline() ? 'online' : 'offline'}. Package \${packageName} version \${version} is registered.\`);
    // This starts you application, do all the things in here!
    client.shutdown(async () => {
        console.log('Shutting down gracefully...');
        // this is called before planned system shutdown (e.g. update installation).
    })
});`;

export const EXAMPLE_PACKAGE_FILE = `import {defineEnergyAppPackage} from "../../connect-ems-api";

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
})`;