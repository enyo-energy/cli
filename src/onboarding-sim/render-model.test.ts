/**
 * The render model's cases, against what `render-model.builder.ts` in core hands
 * the app: the preview draws only this, so a drift here is a preview that shows
 * the installer something the app would not.
 */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {EnyoOnboardingV2StartVariant, EnyoOnboardingV2TargetType} from '@enyo-energy/energy-app-sdk';
import type {EnyoOnboardingV2Guide, EnyoOnboardingV2Step} from '@enyo-energy/energy-app-sdk';
import {buildRenderModel, inputSpecOf, type RenderModelSource} from './render-model.js';

const label = (value: string) => [{language: 'de' as const, value}];

const stepOf = (id: string, blocks: Record<string, unknown>[], next?: string): EnyoOnboardingV2Step =>
    ({
        id,
        name: id,
        title: label(id),
        blocks,
        transitions: [
            {
                id: `${id}-continue`,
                source: {kind: 'continue'},
                target: next ? {type: EnyoOnboardingV2TargetType.Step, stepId: next} : {type: EnyoOnboardingV2TargetType.Success},
            },
        ],
    }) as unknown as EnyoOnboardingV2Step;

const guideOf = (steps: EnyoOnboardingV2Step[]): EnyoOnboardingV2Guide => ({
    title: label('Test'),
    startVariant: EnyoOnboardingV2StartVariant.DeviceNotFound,
    startStepId: steps[0].id,
    steps,
});

const sourceFor = (step: EnyoOnboardingV2Step, overrides: Partial<RenderModelSource> = {}): RenderModelSource => ({
    guide: guideOf([step]),
    step,
    visited: [step.name],
    isTerminal: false,
    canGoBack: false,
    inputs: {},
    setupMessages: {},
    dynamicValues: {},
    fileUrl: () => undefined,
    ...overrides,
});

const outcomes = [
    {id: 'ok', value: 'success', label: label('ok')},
    {id: 'bad', value: 'failure', label: label('bad')},
];

describe('inputSpecOf', () => {
    it('is continue on a step without a decision block', () => {
        const step = stepOf('intro', [{id: 't', type: 'text', text: label('hi')}]);
        assert.deepEqual(inputSpecOf(sourceFor(step)), {kind: 'continue'});
    });

    it('is terminal once the walk has ended', () => {
        const step = stepOf('intro', [{id: 't', type: 'text', text: label('hi')}]);
        assert.deepEqual(inputSpecOf(sourceFor(step, {isTerminal: true})), {kind: 'terminal'});
    });

    it('reshapes an auth block the way the guide mapper does', () => {
        const step = stepOf('login', [
            {
                id: 'auth',
                type: 'auth',
                label: label('Bei Solarweb anmelden'),
                help: label('Mit dem Konto des Kunden'),
                requiresWebAuthentication: true,
                redirectUrlFilter: {webOnly: false},
                outcome: {id: 'done', label: label('Angemeldet')},
            },
        ]);
        const spec = inputSpecOf(sourceFor(step));
        assert.equal(spec.kind, 'auth');
        assert.ok(spec.kind === 'auth');
        assert.deepEqual(spec.provider, label('Bei Solarweb anmelden'));
        assert.deepEqual(spec.description, label('Mit dem Konto des Kunden'));
        assert.equal(spec.successOutcomeId, 'done');
        // The filter wins over the deprecated flag.
        assert.equal(spec.requiresWebAuthentication, false);
    });

    it('defaults an input block and never hands a password back', () => {
        const input = (valueType: string) =>
            stepOf('ip', [{id: 'in', type: 'input', valueType, label: label('IP'), outcomes}]);
        const text = inputSpecOf(sourceFor(input('ip-address'), {inputs: {in: '10.0.0.2'}}));
        assert.ok(text.kind === 'input');
        assert.equal(text.value, '10.0.0.2');
        assert.equal(text.submitLabel, 'Prüfen');

        const secret = inputSpecOf(sourceFor(input('password'), {inputs: {in: 'hunter2'}}));
        assert.ok(secret.kind === 'input');
        assert.equal(secret.value, undefined);
    });

    it('marks setup fields required unless they say otherwise, and carries the last message', () => {
        const step = stepOf('setup', [
            {
                id: 'setup',
                type: 'additional-setup',
                setupKey: 'portal',
                description: label('why'),
                fields: [
                    {name: 'token', type: 'token', label: label('Token')},
                    {name: 'site', type: 'text', label: label('Site'), required: false},
                ],
                outcomes,
            },
        ]);
        const spec = inputSpecOf(sourceFor(step, {setupMessages: {setup: label('Token abgelehnt')}}));
        assert.ok(spec.kind === 'additional-setup');
        assert.equal(spec.cta, 'Einrichten');
        assert.deepEqual(spec.fields.map(field => field.required), [true, false]);
        assert.deepEqual(spec.message, label('Token abgelehnt'));
    });

    it('normalises both picker shapes into one picker input', () => {
        const block = inputSpecOf(
            sourceFor(stepOf('pick', [{id: 'p', type: 'device-select', headline: label('Wähle'), outcomes}]))
        );
        assert.ok(block.kind === 'picker');
        assert.equal(block.picker, 'device-select');
        assert.equal(block.autoSelectSingleMatch, true);
        assert.deepEqual(block.headline, label('Wähle'));

        const legacy = inputSpecOf(
            sourceFor(stepOf('pair', [{id: 'a', type: 'action', action: 'eebus-pair', headline: label('x'), outcomes}]))
        );
        assert.ok(legacy.kind === 'picker');
        assert.equal(legacy.picker, 'eebus-device-select');
        // A legacy EEBUS pick never paired on its own, and had no headline.
        assert.equal(legacy.autoSelectSingleMatch, false);
        assert.equal(legacy.headline, undefined);
    });

    it('falls back to a network scan for an unknown action kind', () => {
        const spec = inputSpecOf(sourceFor(stepOf('scan', [{id: 'a', type: 'action', action: 'teleport', outcomes}])));
        assert.ok(spec.kind === 'action');
        assert.equal(spec.action, 'network-scan');
    });

    it('defaults a choice layout to buttons', () => {
        const spec = inputSpecOf(
            sourceFor(stepOf('fork', [{id: 'c', type: 'choice', options: [{id: 'y', label: label('Ja')}]}]))
        );
        assert.ok(spec.kind === 'choice');
        assert.equal(spec.layout, 'buttons');
    });
});

describe('buildRenderModel', () => {
    it('resolves image, select and dynamic blocks the way the host does', () => {
        const step = stepOf('content', [
            {id: 'img', type: 'image', file: 'wiring.png'},
            {id: 'gone', type: 'image', file: 'missing.png'},
            {id: 'sel', type: 'select', label: label('Modell'), options: []},
            {id: 'ocpp', type: 'dynamic', kind: 'ocpp-url'},
            {id: 'ip', type: 'dynamic', kind: 'device-ip'},
        ]);
        const model = buildRenderModel(
            sourceFor(step, {
                inputs: {sel: 'gen24'},
                dynamicValues: {ocpp: 'ws://hub/ocpp/x', ip: null},
                fileUrl: name => (name === 'wiring.png' ? '/api/files/wiring.png' : undefined),
            })
        );
        const blocks = Object.fromEntries((model.step?.blocks ?? []).map(block => [block.id, block]));
        assert.equal(blocks.img.url, '/api/files/wiring.png');
        assert.equal(blocks.gone.url, undefined);
        assert.equal(blocks.sel.value, 'gen24');
        assert.equal(blocks.ocpp.resolved, true);
        assert.equal(blocks.ocpp.value, 'ws://hub/ocpp/x');
        assert.equal(blocks.ip.resolved, false);
        assert.equal(blocks.ip.placeholder, 'wird zur Laufzeit gesetzt (IP-Adresse / Link)');
    });

    it('counts progress as walked plus the shortest way ahead', () => {
        const steps = [
            stepOf('a', [], 'b'),
            stepOf('b', [], 'c'),
            stepOf('c', []),
        ];
        const guide = guideOf(steps);
        const atB = buildRenderModel({...sourceFor(steps[1]), guide, visited: ['a', 'b']});
        assert.deepEqual(atB.progress, {position: 2, visited: ['a', 'b'], total: 3});

        const done = buildRenderModel({
            ...sourceFor(steps[2]),
            guide,
            visited: ['a', 'b', 'c'],
            isTerminal: true,
            terminal: {type: EnyoOnboardingV2TargetType.Success},
        });
        assert.equal(done.step, null);
        assert.deepEqual(done.input, {kind: 'terminal'});
        assert.equal(done.progress.total, 3);
    });
});
