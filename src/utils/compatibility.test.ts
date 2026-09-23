import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {EnergyAppPackageCompatibilityStatus} from '@enyo-energy/energy-app-sdk';
import type {EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {buildCreateReleasePayload} from '../commands/release.js';
import {hashReleaseDefinition} from './fingerprint.js';

/**
 * `status` is carried, not interpreted: the CLI never reads it, so what these
 * tests guard is that it reaches the registry at all and that changing it is a
 * release rather than a duplicate.
 */
const definitionWith = (
    compatibility: EnergyAppPackageDefinition['compatibility']
): EnergyAppPackageDefinition => ({
    version: '1',
    packageName: 'test-package',
    sdkVersion: '1.22.0',
    permissions: [],
    categories: [],
    storeEntry: [],
    compatibility
} as unknown as EnergyAppPackageDefinition);

const compatibility = (
    vendorStatus?: EnergyAppPackageCompatibilityStatus,
    modelStatus?: EnergyAppPackageCompatibilityStatus
): EnergyAppPackageDefinition['compatibility'] => [
    {
        vendorName: 'Acme',
        ...(vendorStatus ? {status: vendorStatus} : {}),
        models: [
            {
                modelName: 'AC-22-Pro',
                features: [],
                ...(modelStatus ? {status: modelStatus} : {})
            }
        ]
    }
] as unknown as EnergyAppPackageDefinition['compatibility'];

describe('compatibility status', () => {
    test('vendor and model status reach the create-release payload', () => {
        const definition = definitionWith(
            compatibility(
                EnergyAppPackageCompatibilityStatus.Compatible,
                EnergyAppPackageCompatibilityStatus.NotCompatible
            )
        );

        const payload = buildCreateReleasePayload(definition, undefined, 'production', []);
        const published = payload.compatibility as EnergyAppPackageDefinition['compatibility'];

        assert.equal(published[0].status, EnergyAppPackageCompatibilityStatus.Compatible);
        assert.equal(published[0].models[0].status, EnergyAppPackageCompatibilityStatus.NotCompatible);
    });

    test('omitted status stays omitted rather than being defaulted', () => {
        const payload = buildCreateReleasePayload(definitionWith(compatibility()), undefined, 'production', []);
        const published = payload.compatibility as EnergyAppPackageDefinition['compatibility'];

        assert.equal(published[0].status, undefined);
        assert.equal(published[0].models[0].status, undefined);
    });

    test('flipping a model to not-compatible is a new release, not a duplicate', () => {
        const before = hashReleaseDefinition(
            buildCreateReleasePayload(definitionWith(compatibility()), undefined, 'production', [])
        );
        const after = hashReleaseDefinition(
            buildCreateReleasePayload(
                definitionWith(compatibility(undefined, EnergyAppPackageCompatibilityStatus.NotCompatible)),
                undefined,
                'production',
                []
            )
        );

        assert.notEqual(before, after);
    });
});
