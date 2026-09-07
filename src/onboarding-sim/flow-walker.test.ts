/**
 * The walker's cases, ported from `flow-walker.spec.ts` in core.
 *
 * They are here to catch drift: the simulator and the device must agree on where
 * a guide goes next, and the only way that stays true is if the same graphs
 * resolve the same way in both.
 */
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
    EnyoOnboardingV2BlockType,
    EnyoOnboardingV2ChoiceLayout,
    EnyoOnboardingV2StartVariant,
    EnyoOnboardingV2TargetType,
    EnyoOnboardingV2TransitionSourceKind,
} from '@enyo-energy/energy-app-sdk';
import type {
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2Step,
} from '@enyo-energy/energy-app-sdk';
import {
    clearAnswersAfter,
    continueKey,
    decidedAnswerKeys,
    decisionBlock,
    resolveStep,
    simulate,
    skipAnswer,
    stepsToTerminal,
} from './flow-walker.js';

const label = (value: string) => [{language: 'de' as const, value}];

const guideOf = (steps: EnyoOnboardingV2Step[]): EnyoOnboardingV2Guide => ({
    title: label('Test'),
    startVariant: EnyoOnboardingV2StartVariant.DeviceNotFound,
    startStepId: steps[0].id,
    steps,
});

const contentStep = (id: string, target: EnyoOnboardingV2Step['transitions'][number]['target']): EnyoOnboardingV2Step => ({
    id,
    name: id,
    title: label(id),
    blocks: [{id: `${id}-text`, type: EnyoOnboardingV2BlockType.Text, text: label('hello')}],
    transitions: [
        {
            id: `${id}-continue`,
            source: {kind: EnyoOnboardingV2TransitionSourceKind.Continue},
            target,
        },
    ],
});

const choiceStep = (id: string, options: {optionId: string; target: EnyoOnboardingV2Step['transitions'][number]['target']}[]): EnyoOnboardingV2Step => ({
    id,
    name: id,
    title: label(id),
    blocks: [
        {
            id: `${id}-choice`,
            type: EnyoOnboardingV2BlockType.Choice,
            layout: EnyoOnboardingV2ChoiceLayout.Buttons,
            options: options.map(option => ({id: option.optionId, label: label(option.optionId)})),
        },
    ],
    transitions: options.map(option => ({
        id: `${id}-${option.optionId}`,
        source: {
            kind: EnyoOnboardingV2TransitionSourceKind.Choice as const,
            blockId: `${id}-choice`,
            optionId: option.optionId,
        },
        target: option.target,
    })),
});

const success = {type: EnyoOnboardingV2TargetType.Success} as const;
const step = (stepId: string) => ({type: EnyoOnboardingV2TargetType.Step, stepId} as const);

describe('resolveStep', () => {
    it('waits for the continue press on a content-only step', () => {
        const only = contentStep('intro', success);
        assert.deepEqual(resolveStep(only, {}), {kind: 'await'});
        assert.deepEqual(resolveStep(only, {[continueKey(only)]: 'continue'}), {
            kind: 'target',
            target: success,
        });
    });

    it('reports a content step with no way out as a dead end, not as awaiting', () => {
        const stranded: EnyoOnboardingV2Step = {...contentStep('intro', success), transitions: []};
        assert.deepEqual(resolveStep(stranded, {}), {kind: 'dead-end'});
    });

    it('routes a choice by the option picked', () => {
        const fork = choiceStep('fork', [
            {optionId: 'yes', target: success},
            {optionId: 'no', target: step('other')},
        ]);
        assert.deepEqual(resolveStep(fork, {'fork-choice': 'yes'}), {kind: 'target', target: success});
        assert.deepEqual(resolveStep(fork, {'fork-choice': 'no'}), {kind: 'target', target: step('other')});
    });

    it('tells a skip apart from an outcome on the same block', () => {
        const setup: EnyoOnboardingV2Step = {
            id: 'setup',
            name: 'setup',
            title: label('setup'),
            blocks: [
                {
                    id: 'setup-block',
                    type: EnyoOnboardingV2BlockType.AdditionalSetup,
                    setupKey: 'vendor',
                    cta: label('go'),
                    description: label('why'),
                    outcomes: [
                        {id: 'later', value: 'connected', label: label('connected')},
                        {id: 'failed', value: 'failed', label: label('failed')},
                    ],
                    skip: {id: 'later', label: label('later')},
                },
            ],
            transitions: [
                {
                    id: 'to-success',
                    source: {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId: 'setup-block', outcomeId: 'later'},
                    target: success,
                },
                {
                    id: 'to-other',
                    source: {kind: EnyoOnboardingV2TransitionSourceKind.Skip, blockId: 'setup-block', skipId: 'later'},
                    target: step('other'),
                },
            ],
        };

        // Same id on both handles: only the prefix keeps them apart.
        assert.deepEqual(resolveStep(setup, {'setup-block': 'later'}), {kind: 'target', target: success});
        assert.deepEqual(resolveStep(setup, {'setup-block': skipAnswer('later')}), {
            kind: 'target',
            target: step('other'),
        });
    });

    it('finds the first interactive block as the decision', () => {
        const fork = choiceStep('fork', [{optionId: 'yes', target: success}]);
        assert.equal(decisionBlock(fork)?.id, 'fork-choice');
        assert.equal(decisionBlock(contentStep('intro', success)), undefined);
    });
});

describe('simulate', () => {
    it('auto-advances through answered steps and stops at the first unanswered one', () => {
        const guide = guideOf([
            contentStep('intro', step('fork')),
            choiceStep('fork', [{optionId: 'yes', target: success}]),
        ]);

        const walk = simulate(guide, {[continueKey(guide.steps[0])]: 'continue'});
        assert.equal(walk.status, 'await');
        assert.equal(walk.currentStepName, 'fork');
        assert.deepEqual(walk.visited, ['intro', 'fork']);
    });

    it('stops at a terminal and reports it', () => {
        const guide = guideOf([contentStep('intro', success)]);
        const walk = simulate(guide, {[continueKey(guide.steps[0])]: 'continue'});
        assert.equal(walk.status, 'terminal');
        assert.deepEqual(walk.terminal, success);
    });

    it('reports a cycle rather than spinning', () => {
        const guide = guideOf([contentStep('a', step('b')), contentStep('b', step('a'))]);
        const walk = simulate(guide, {
            [continueKey(guide.steps[0])]: 'continue',
            [continueKey(guide.steps[1])]: 'continue',
        });
        assert.equal(walk.status, 'loop');
    });

    it('reports a transition pointing at a missing step as a dead end', () => {
        const guide = guideOf([contentStep('intro', step('nowhere'))]);
        const walk = simulate(guide, {[continueKey(guide.steps[0])]: 'continue'});
        assert.equal(walk.status, 'dead-end');
    });
});

describe('clearAnswersAfter', () => {
    it('makes a step the flow returns to askable again', () => {
        const guide = guideOf([
            choiceStep('address', [
                {optionId: 'ok', target: success},
                {optionId: 'fail', target: step('retry')},
            ]),
            contentStep('retry', step('address')),
        ]);

        const answers: Record<string, string> = {
            'address-choice': 'fail',
            [continueKey(guide.steps[1])]: 'continue',
        };

        // Re-answering the address step must drop the retry step's press;
        // otherwise the second failure walks straight through it.
        clearAnswersAfter(guide, answers, 'address');
        assert.deepEqual(Object.keys(answers), ['address-choice']);
    });
});

describe('stepsToTerminal', () => {
    it('counts the shortest way out, the step itself included', () => {
        const guide = guideOf([
            contentStep('a', step('b')),
            choiceStep('b', [
                {optionId: 'short', target: success},
                {optionId: 'long', target: step('c')},
            ]),
            contentStep('c', success),
        ]);

        assert.equal(stepsToTerminal(guide, 'a'), 2);
        assert.equal(stepsToTerminal(guide, 'b'), 1);
        // An unknown step still counts as one remaining, so progress never
        // claims to be finished.
        assert.equal(stepsToTerminal(guide, 'gone'), 1);
    });
});

describe('decidedAnswerKeys', () => {
    it('lists the answers along the walked path, content steps included', () => {
        const guide = guideOf([
            contentStep('intro', step('fork')),
            choiceStep('fork', [{optionId: 'yes', target: success}]),
        ]);
        const answers = {[continueKey(guide.steps[0])]: 'continue', 'fork-choice': 'yes'};
        assert.deepEqual(decidedAnswerKeys(guide, answers), [continueKey(guide.steps[0]), 'fork-choice']);
    });
});
