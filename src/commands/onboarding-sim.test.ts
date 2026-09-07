import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {fileURLToPath} from 'url';
import {resolveApp} from './onboarding-sim.js';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = path.join(cliRoot, 'example/onboarding-sim-fixture');

describe('resolveApp', () => {
    it('roots the app at the config\'s directory, not at the current one', async () => {
        const app = await resolveApp(path.join(fixtureDir, 'energy-app.package.ts'));

        // The point of --file is a config in another project: resolving the
        // bundle against the current directory would load whatever `dist` sits
        // there — the CLI's own, when standing in this repo.
        assert.equal(app.root, fixtureDir);
        assert.equal(app.config?.packageName, 'onboarding-sim-fixture');
    });

    it('falls back to the current directory when no config is named or found', async () => {
        const app = await resolveApp();
        assert.equal(app.root, process.cwd());
        assert.equal(app.config, undefined);
    });

    it('says which config file is missing rather than quietly running without one', async () => {
        await assert.rejects(
            () => resolveApp(path.join(fixtureDir, 'not-here.package.ts')),
            /Specified config file not found/
        );
    });
});
