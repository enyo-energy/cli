#!/usr/bin/env node
import {program} from 'commander';
import {execSync} from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';
import {createJiti} from 'jiti';
import {runPackageInVM} from './run.js';
import {installDevPackage} from './dev-package-installer.js';
import type {ConnectPackageDefinition} from "../../connect-ems-api";

const readConnectEmsPackageConfig = async (filePath = 'connect-ems.package.ts') => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`connect-ems.package.ts file not found at ${filePath}`);
        }
        const jiti = createJiti(path.resolve(`./${filePath}`), {
            interopDefault: true,
            transformOptions: {
                // @ts-expect-error that is correct
                typescript: true
            }
        });

        return (await jiti(path.resolve(filePath))).default as ConnectPackageDefinition;
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error reading connect-ems.package.ts:', error.message);
        } else {
            console.error('Unknown error reading connect-ems.package.ts:', error);
        }
        throw error;
    }
};

const rsBuildFile = `import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  output: {
    target: 'node',
  },
});
`;

const tsConfigFile = `{
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

const exampleIndexFile = `import {ConnectEmsPackageClient} from "../../connect-ems-api";

const client = new ConnectEmsPackageClient();

client.register((packageName: string, version: number) => {
    // The packageName and version number is provided by the released package in the Connect EMS Marketplace. You can use that information for whatever you want.
    console.log(\`network state is \${client.isOnline() ? 'online' : 'offline'}. Package \${packageName} version \${version} is registered.\`);
    // This starts you application, do all the things in here!
    client.shutdown(async () => {
        console.log('Shutting down gracefully...');
        // this is called before planned system shutdown (e.g. update installation).
    })
});`;

const examplePackageFile = `import {defineConnectEmsPackage} from "../../connect-ems-api";

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
})`

program.version('0.0.1', '-v, --version', 'output the current version');

program.command('init')
    .description('Create a new Connect EMS Package')
    .action(() => {
        if (!fs.existsSync('package.json')) {
            throw new Error(`You need to create a npm project first. Run 'npm init' to create a package.json file.`);
        }
        if (!fs.existsSync('rsbuild.config.ts')) {
            fs.writeFileSync('rsbuild.config.ts', rsBuildFile);
        }
        if (!fs.existsSync('tsconfig.json')) {
            fs.writeFileSync('tsconfig.json', tsConfigFile);
        }
        if (!fs.existsSync('src')) {
            fs.mkdirSync('src');
        }
        if (!fs.existsSync('src/index.ts')) {
            fs.writeFileSync('src/index.ts', exampleIndexFile);
        }
        if (!fs.existsSync('connect-ems.package.ts')) {
            fs.writeFileSync('connect-ems.package.ts', examplePackageFile);
        }
        execSync(`npm install -D @rsbuild/core @types/node typescript`); // FIXME: install connect ems api package from npm
    });

program.command('run')
    .description('Run the package locally for testing in a mocked VM environment')
    .action(async () => {
        try {
            if (!fs.existsSync('connect-ems.package.ts')) {
                throw new Error('connect-ems.package.ts not found in current directory');
            }

            console.log('Reading package configuration...');
            const config = await readConnectEmsPackageConfig('connect-ems.package.ts');
            console.log(`Loaded package: ${config.packageName} v${config.version}`);

            const distPath = path.join(process.cwd(), 'dist', 'index.js');
            if (!fs.existsSync(distPath)) {
                throw new Error('dist/index.js not found. Please build the package first.');
            }

            console.log('Starting package in VM...');
            runPackageInVM(config, distPath);

        } catch (error) {
            if (error instanceof Error) {
                console.error('Error running package:', error.message);
            } else {
                console.error('Unknown error running package:', error);
            }
            process.exit(1);
        }
    });

program.command('install')
    .description('Build and install the package on a local Connect EMS device for development')
    .option('--host <host>', 'Device IP address or hostname', 'localhost')
    .option('--port <port>', 'Device port number', '6021')
    .requiredOption('--token <token>', 'Debug token from the Connect EMS device')
    .action(async (options) => {
        try {
            if (!fs.existsSync('connect-ems.package.ts')) {
                throw new Error('connect-ems.package.ts not found in current directory');
            }

            console.log('Reading package configuration...');
            const config = await readConnectEmsPackageConfig('connect-ems.package.ts');
            console.log(`Loaded package: ${config.packageName} v${config.version}`);

            const deviceHost = options.host;
            const devicePort = parseInt(options.port, 10);

            if (isNaN(devicePort) || devicePort <= 0 || devicePort > 65535) {
                throw new Error(`Invalid port number: ${options.port}`);
            }

            await installDevPackage(deviceHost, devicePort, options.token, config);

        } catch (error) {
            if (error instanceof Error) {
                console.error('Error installing package:', error.message);
            } else {
                console.error('Unknown error installing package:', error);
            }
            process.exit(1);
        }
    });

program.command('release')
    .description('Create a new release for your Connect EMS app and upload to the connect EMS store.')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .option('--registry <registry>', 'Connect EMS Package Registry URL', 'https://api.connect-ems.com')
    .action(async (options) => {
        // Build Bundle
        const config = await readConnectEmsPackageConfig();
        execSync(`tar -czf bundle.tar.gz dist`); // FIXME: move manifest from definition + images for the store in the bundle as well
        const bundlePath = path.join(process.cwd(), 'bundle.tar.gz');
        if (!fs.existsSync(bundlePath)) {
            console.error(`Error: Bundle not found at ${bundlePath}`);
            process.exit(1);
        }
        await createRelease(bundlePath, config, options.apiKey, options.registry);
    });

program.parse(process.argv);


const createRelease = async (bundlePath: string, config: ConnectPackageDefinition, apiKey: string, registry: string) => {
    try {
        const response = await fetch(`${registry}/api/package-registry/create-release`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({...config})
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error creating release: ${response.status}`);
            console.error(errorText);
            throw new Error(`Failed to create release: ${response.status}`);
        }

        // @ts-expect-error this is fine
        const data: { uploadUrl: string, releaseId: string } = await response.json();

        if (!data || !data.uploadUrl) {
            console.error('Error: Could not get upload URL from response.');
            throw new Error('No upload URL in response');
        }

        await uploadBundle(bundlePath, apiKey, registry, data.uploadUrl, data.releaseId);
    } catch (error) {
        if (error instanceof Error) {
            console.error(`Problem with request: ${error.message}`);
            throw new Error(`Request error: ${error.message}`);
        }
        throw error;
    }
};

const finishRelease = async (releaseId: string, apiKey: string, registry: string) => {
    try {
        const response = await fetch(`${registry}/api/package-registry/finish-release`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({releaseId})
        });

        if (response.status === 201) {
            console.log('Finished release successfully.');
            return {};
        } else {
            const errorText = await response.text();
            console.error(`Error finishing release: ${response.status}`);
            console.error(errorText);
            throw new Error(`Failed to finish release: ${response.status}`);
        }
    } catch (error) {
        if (error instanceof Error) {
            console.error(`Problem with request: ${error.message}`);
            throw new Error(`Problem with request: ${error.message}`);
        }
        throw error;
    }
};

const uploadBundle = (bundlePath: string, apiKey: string, registry: string, uploadUrl: string, releaseId: string) => {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(bundlePath);
        const stats = fs.statSync(bundlePath);

        const options = new URL(uploadUrl);

        console.log(
            `upload to https://${options.hostname}${options.pathname}${options.search}`,
        );
        const req = https.request(
            {
                hostname: options.hostname,
                path: options.pathname + options.search,
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/gzip',
                    'Content-Length': stats.size,
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        console.log('Bundle uploaded successfully.');
                        finishRelease(releaseId, apiKey, registry).then(() => resolve({})).catch((error: Error) => reject(error))
                    } else {
                        console.error(`Error uploading bundle: ${res.statusCode}`);
                        console.error(data);
                        reject(new Error(`Failed to upload bundle: ${res.statusCode}`));
                    }
                });
            },
        );

        req.on('error', (e) => {
            console.error(`Problem with upload request: ${e.message}`);
            reject(new Error(`Problem with upload request: ${e.message}`));
        });

        fileStream.pipe(req);
    });
};