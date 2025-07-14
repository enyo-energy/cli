#!/usr/bin/env node
import {program} from 'commander';
import {execSync} from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';

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
});`

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
        execSync(`npm install -D @rsbuild/core @types/node typescript`); // FIXME: install connect ems api package from npm
    });

program.command('release')
    .description('Create a new release for your Connect EMS app and upload to the connect EMS store.')
    .requiredOption('--api-key <apiKey>', 'Your Developer Org API Key')
    .requiredOption('--package <packageName>', 'The Package Name of your Connect EMS app')
    .action(async (options) => {
        // Build Bundle
        execSync(`npx rsbuild build && mv dist/index.js dist/main.js && tar -czf bundle.tar.gz dist`);
        const bundlePath = path.join(__dirname, 'bundle.tar.gz');
        if (!fs.existsSync(bundlePath)) {
            console.error(`Error: Bundle not found at ${bundlePath}`);
            process.exit(1);
        }
        await createRelease(bundlePath, options.packageName, options.apiKey);
    });

program.parse(process.argv);


const createRelease = (bundlePath, packageName, apiKey) => {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({packageName});

        const options = {
            hostname: 'api.connect-ems.com',
            path: '/api/package-registry/create-release',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                Authorization: `Bearer ${apiKey}`,
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 201) {
                    const response = JSON.parse(data);
                    if (response && response.uploadUrl) {
                        uploadBundle(bundlePath, apiKey, response.uploadUrl, response.releaseId).then(() => resolve()).catch((error) => reject(error));
                    } else {
                        console.error('Error: Could not get upload URL from response.');
                        reject(new Error('No upload URL in response'));
                    }
                } else {
                    console.error(`Error creating release: ${res.statusCode}`);
                    console.error(data);
                    reject(new Error(`Failed to create release: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            reject(new Error(`Request error: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
};

const finishRelease = (releaseId, apiKey) => {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({releaseId});

        const options = {
            hostname: 'api.connect-ems.com',
            path: '/api/internal/package-registry/finish-release',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                Authorization: `Bearer ${apiKey}`,
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 201) {
                    console.log('Finished release successfully.');
                    resolve();
                } else {
                    console.error(`Error finishing release: ${res.statusCode}`);
                    console.error(data);
                    reject(new Error(`Failed to finish release: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Problem with request: ${e.message}`);
            reject(new Error(`Problem with request: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
};

const uploadBundle = (bundlePath, apiKey, uploadUrl, releaseId) => {
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
                        finishRelease(releaseId, apiKey).then(() => resolve()).catch((error) => reject(error))
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