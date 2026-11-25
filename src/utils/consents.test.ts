import {test, describe, mock, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {EnyoConsentGrantorEnum} from '@enyo-energy/energy-app-sdk';
import type {EnergyAppPackageConsent, EnergyAppPackageDefinition} from '@enyo-energy/energy-app-sdk';
import {CLIError} from './error-handler.js';
import {describeConsent, describeConsents, validateConsentsDeclaration} from './consents.js';
import {hashReleaseDefinition} from './fingerprint.js';
import {buildCreateReleasePayload} from '../commands/release.js';

afterEach(() => {
    mock.restoreAll();
});

const t = (de: string, en: string) => [
    {language: 'de' as const, value: de},
    {language: 'en' as const, value: en},
];

/** A valid consent, both languages, one legal-text section. */
const backupConsent = (overrides: Partial<EnergyAppPackageConsent> = {}): EnergyAppPackageConsent => ({
    consentKey: 'backup-and-developer-mode',
    version: '1',
    required: true,
    grantableBy: [EnyoConsentGrantorEnum.Customer, EnyoConsentGrantorEnum.Installer],
    label: t('Ich erlaube das Backup.', 'I allow the backup.'),
    title: t('Backup', 'Backup'),
    legalText: {sections: [{heading: t('1. Backup', '1. Backup'), content: t('Text', 'Text')}]},
    ...overrides,
});

const definitionWith = (consents: EnergyAppPackageConsent[] | undefined): EnergyAppPackageDefinition => ({
    version: '1',
    packageName: 'test-package',
    sdkVersion: '1.80.0',
    permissions: [],
    categories: [],
    storeEntry: [],
    compatibility: [],
    ...(consents ? {consents} : {}),
} as unknown as EnergyAppPackageDefinition);

const silenceConsole = () => ({
    log: mock.method(console, 'log', () => {}),
    error: mock.method(console, 'error', () => {}),
});

describe('validateConsentsDeclaration', () => {
    test('passes a package without consents', () => {
        assert.doesNotThrow(() => validateConsentsDeclaration(definitionWith(undefined)));
    });

    test('passes a valid consent', () => {
        assert.doesNotThrow(() => validateConsentsDeclaration(definitionWith([backupConsent()])));
    });

    test('aborts on a missing translation and prints every error', () => {
        const {error} = silenceConsole();
        assert.throws(
            () => validateConsentsDeclaration(definitionWith([
                backupConsent({label: [{language: 'de', value: 'Nur deutsch'}]}),
            ])),
            CLIError
        );
        assert.ok(error.mock.callCount() >= 2);
    });

    test('aborts on duplicate keys', () => {
        silenceConsole();
        assert.throws(
            () => validateConsentsDeclaration(definitionWith([backupConsent(), backupConsent()])),
            CLIError
        );
    });

    test('prints the warning for a required consent only the installer may give, without aborting', () => {
        const {log} = silenceConsole();
        assert.doesNotThrow(() => validateConsentsDeclaration(definitionWith([
            backupConsent({grantableBy: [EnyoConsentGrantorEnum.Installer]}),
        ])));
        assert.ok(log.mock.calls.some(call => String(call.arguments[0]).startsWith('⚠️ Consents:')));
    });

    test('uses the injected validator', () => {
        silenceConsole();
        assert.throws(
            () => validateConsentsDeclaration(definitionWith(undefined), () => ({ok: false, errors: ['boom'], warnings: []})),
            /Consents declaration is invalid/
        );
    });
});

describe('describing consents', () => {
    test('summarises one consent', () => {
        assert.equal(describeConsent(backupConsent()), 'backup-and-developer-mode v1 (required, customer+installer)');
        assert.equal(
            describeConsent(backupConsent({consentKey: 'share-usage-data', required: false, grantableBy: [EnyoConsentGrantorEnum.Customer]})),
            'share-usage-data v1 (voluntary, customer)'
        );
    });

    test('summarises the whole declaration, or nothing', () => {
        assert.equal(describeConsents(definitionWith(undefined)), undefined);
        assert.equal(
            describeConsents(definitionWith([backupConsent()])),
            '1 consent(s): backup-and-developer-mode v1 (required, customer+installer)'
        );
    });
});

describe('consents in the release', () => {
    test('travel in the create-release payload unchanged', () => {
        const consents = [backupConsent()];
        const payload = buildCreateReleasePayload(definitionWith(consents), undefined, 'production', []);
        assert.deepEqual(payload.consents, consents);
    });

    test('change the definition hash when only a consent version changes', () => {
        const hashWith = (version: string) =>
            hashReleaseDefinition(buildCreateReleasePayload(
                definitionWith([backupConsent({version})]), undefined, 'production', []
            ));
        assert.notEqual(hashWith('1'), hashWith('2'));
    });

    test('change the definition hash when a consent is added', () => {
        const hashOf = (consents: EnergyAppPackageConsent[] | undefined) =>
            hashReleaseDefinition(buildCreateReleasePayload(definitionWith(consents), undefined, 'production', []));
        assert.notEqual(hashOf(undefined), hashOf([backupConsent()]));
    });
});
