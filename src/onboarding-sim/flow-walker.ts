/**
 * Graph walker for onboarding v2 guides — the simulator's "what's next".
 *
 * A port of `connect-core/api/src/onboarding-runtime/flow-walker.ts`, which is
 * itself a port of the frontend walker. That file is the source of truth: the
 * semantics here are deliberately identical so a flow that reaches `success` in
 * the simulator reaches `success` on a real device. Its spec cases are ported
 * alongside in `flow-walker.test.ts` so a divergence shows up as a failing test
 * rather than as a guide that only works in the preview.
 *
 * The only change from the original is the typing: core walks opaque JSON
 * (`RtBlock`, `RtStep`), the CLI walks the SDK types the app itself authored, so
 * an SDK upgrade that changes a block or transition shape breaks the build here.
 */
import {
    EnyoOnboardingV2BlockType,
    EnyoOnboardingV2TargetType,
    EnyoOnboardingV2TransitionSourceKind,
} from '@enyo-energy/energy-app-sdk';
import type {
    EnyoOnboardingV2Block,
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2InteractiveBlock,
    EnyoOnboardingV2Step,
    EnyoOnboardingV2Target,
    EnyoOnboardingV2Transition,
    EnyoOnboardingV2TransitionSource,
} from '@enyo-energy/energy-app-sdk';

/** Block id → the handle the installer picked on it (option, outcome or `skip:<id>`). */
export type Answers = Record<string, string>;

// ---- lookups ---------------------------------------------------------------

export const stepById = (guide: EnyoOnboardingV2Guide, id: string): EnyoOnboardingV2Step | undefined =>
    guide.steps.find(step => step.id === id);

export const stepByName = (guide: EnyoOnboardingV2Guide, name: string): EnyoOnboardingV2Step | undefined =>
    guide.steps.find(step => step.name === name);

const INTERACTIVE_TYPES: EnyoOnboardingV2BlockType[] = [
    EnyoOnboardingV2BlockType.Choice,
    EnyoOnboardingV2BlockType.Action,
    EnyoOnboardingV2BlockType.Input,
    EnyoOnboardingV2BlockType.Auth,
    EnyoOnboardingV2BlockType.AdditionalSetup,
    // The two picker blocks own the step they sit on: each is a screen with its
    // own outcomes, so each is the step's decision point. The guide validator
    // rejects a second decision block beside one, which is what keeps
    // `decisionBlock` — "the first interactive block" — unambiguous here.
    EnyoOnboardingV2BlockType.DeviceSelect,
    EnyoOnboardingV2BlockType.EebusDeviceSelect,
];

export const isInteractiveBlock = (block: EnyoOnboardingV2Block): block is EnyoOnboardingV2InteractiveBlock =>
    INTERACTIVE_TYPES.includes(block.type);

/** The first interactive block of a step — its decision point. */
export const decisionBlock = (step: EnyoOnboardingV2Step): EnyoOnboardingV2InteractiveBlock | undefined =>
    step.blocks.find(isInteractiveBlock);

/**
 * The recorded answer for a skipped `additional-setup` block.
 *
 * Prefixed so a skip handle can never be mistaken for an outcome: both are ids
 * on the same block, and the transition they select is a different kind.
 */
export const skipAnswer = (skipId: string): string => `skip:${skipId}`;

/** The skip id behind a recorded answer, or undefined when it is an outcome. */
export const skipIdOf = (answer: string): string | undefined =>
    answer.startsWith('skip:') ? answer.slice('skip:'.length) : undefined;

/**
 * The answer key for a step's plain "continue" button.
 *
 * A content-only step has no block to key on, but it is still a stop: the
 * installer reads it and presses Weiter. Without recording that, `simulate()`
 * would walk straight through every such step — collapsing a guide whose steps
 * are all content into its terminal before anyone saw a word of it.
 */
export const continueKey = (step: EnyoOnboardingV2Step): string => `continue:${step.id}`;

export const sourceKey = (source: EnyoOnboardingV2TransitionSource): string => {
    switch (source.kind) {
        case EnyoOnboardingV2TransitionSourceKind.Continue:
            return 'continue';
        case EnyoOnboardingV2TransitionSourceKind.Choice:
            return `choice:${source.blockId}:${source.optionId}`;
        case EnyoOnboardingV2TransitionSourceKind.Skip:
            return `skip:${source.blockId}:${source.skipId}`;
        default:
            return `outcome:${source.blockId}:${source.outcomeId}`;
    }
};

export const findTransition = (
    step: EnyoOnboardingV2Step,
    source: EnyoOnboardingV2TransitionSource
): EnyoOnboardingV2Transition | undefined => {
    const key = sourceKey(source);
    return step.transitions.find(transition => sourceKey(transition.source) === key);
};

// ---- single-step resolution ------------------------------------------------

export type StepResolution =
    | { kind: 'target'; target: EnyoOnboardingV2Target }
    | { kind: 'await' }
    | { kind: 'dead-end' };

/**
 * Given a step and the answers so far (block id → chosen handle id), resolve the
 * next target. A step with a decision block needs its answer; a content-only step
 * follows its `continue` transition.
 */
export const resolveStep = (step: EnyoOnboardingV2Step, answers: Answers = {}): StepResolution => {
    const decision = decisionBlock(step);
    if (!decision) {
        const transition = findTransition(step, {kind: EnyoOnboardingV2TransitionSourceKind.Continue});
        // No way out at all is an authoring gap, and reporting it as `await` would
        // strand the installer on a step with no button.
        if (!transition) {
            return {kind: 'dead-end'};
        }
        return answers[continueKey(step)]
            ? {kind: 'target', target: transition.target}
            : {kind: 'await'};
    }

    const picked = answers[decision.id];
    if (!picked) {
        return {kind: 'await'};
    }

    const skipId = skipIdOf(picked);
    let source: EnyoOnboardingV2TransitionSource;
    if (decision.type === EnyoOnboardingV2BlockType.Choice) {
        source = {kind: EnyoOnboardingV2TransitionSourceKind.Choice, blockId: decision.id, optionId: picked};
    } else if (skipId) {
        source = {kind: EnyoOnboardingV2TransitionSourceKind.Skip, blockId: decision.id, skipId};
    } else {
        source = {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId: decision.id, outcomeId: picked};
    }

    const transition = findTransition(step, source);
    return transition ? {kind: 'target', target: transition.target} : {kind: 'dead-end'};
};

// ---- full walk -------------------------------------------------------------

export interface SimResult {
    /** Step names walked, in order. */
    visited: string[];
    /** The awaiting step, or the last resolved one. */
    currentStepName: string;
    status: 'await' | 'terminal' | 'dead-end' | 'loop';
    terminal?: EnyoOnboardingV2Target;
}

/**
 * Walk the graph from `fromStepName` (defaults to the guide's start step) using
 * `answers`, auto-advancing through resolved steps until it needs input
 * (`await`), reaches an exit (`terminal`), hits an authoring gap (`dead-end`), or
 * revisits a step (`loop`).
 */
export const simulate = (
    guide: EnyoOnboardingV2Guide,
    answers: Answers = {},
    fromStepName?: string
): SimResult => {
    const visited: string[] = [];
    const seen = new Set<string>();
    let current = fromStepName ? stepByName(guide, fromStepName) : stepById(guide, guide.startStepId);

    if (!current) {
        return {visited, currentStepName: fromStepName ?? '', status: 'dead-end'};
    }

    for (; ;) {
        if (seen.has(current.name)) {
            return {visited, currentStepName: current.name, status: 'loop'};
        }
        seen.add(current.name);
        visited.push(current.name);

        const resolution = resolveStep(current, answers);
        if (resolution.kind === 'await') {
            return {visited, currentStepName: current.name, status: 'await'};
        }
        if (resolution.kind === 'dead-end') {
            return {visited, currentStepName: current.name, status: 'dead-end'};
        }

        if (resolution.target.type === EnyoOnboardingV2TargetType.Step) {
            const next = stepById(guide, resolution.target.stepId);
            if (!next) {
                return {visited, currentStepName: current.name, status: 'dead-end'};
            }
            current = next;
            continue;
        }

        // Any non-step target ends the run.
        return {
            visited,
            currentStepName: current.name,
            status: 'terminal',
            terminal: resolution.target,
        };
    }
};

/**
 * How many more steps the shortest way out of `stepName` takes — the step itself
 * counted, a terminal counted as nothing.
 *
 * A guide is a graph, not a list, so "step 3 of 7" has no fixed answer. The
 * shortest remaining path is the honest estimate: it shrinks as the walk
 * advances and never promises a longer flow than the one actually ahead.
 */
export const stepsToTerminal = (guide: EnyoOnboardingV2Guide, stepName: string): number => {
    const start = stepByName(guide, stepName);
    if (!start) {
        return 1;
    }

    const queue: { step: EnyoOnboardingV2Step; depth: number }[] = [{step: start, depth: 1}];
    const seen = new Set<string>([start.id]);
    while (queue.length > 0) {
        const {step, depth} = queue.shift()!;
        // A step with no way on is an exit as far as the walk is concerned.
        if (step.transitions.length === 0) {
            return depth;
        }
        for (const transition of step.transitions) {
            if (transition.target.type !== EnyoOnboardingV2TargetType.Step) {
                return depth;
            }
            const next = stepById(guide, transition.target.stepId);
            if (!next || seen.has(next.id)) {
                continue;
            }
            seen.add(next.id);
            queue.push({step: next, depth: depth + 1});
        }
    }
    return 1;
};

/**
 * Drop the recorded answers of every step walked AFTER `stepName`.
 *
 * The walk replays all answers from the start on every render, so a step the
 * flow returns to still carries the answer from its first visit. A retry loop
 * („Adresse erneut eingeben" → back to the input step) would then resolve the
 * failure step instantly on the second failure. Clearing the tail is what makes
 * a step re-askable.
 */
export const clearAnswersAfter = (guide: EnyoOnboardingV2Guide, answers: Answers, stepName: string): void => {
    const {visited} = simulate(guide, answers);
    const index = visited.indexOf(stepName);
    if (index < 0) {
        return;
    }
    for (const name of visited.slice(index + 1)) {
        const step = stepByName(guide, name);
        if (!step) {
            continue;
        }
        const decision = decisionBlock(step);
        if (decision) {
            delete answers[decision.id];
        } else {
            delete answers[continueKey(step)];
        }
    }
};

/**
 * Answer keys already recorded along the walked path, in order (for "back").
 * Includes the `continue:` keys of content-only steps, so going back from a step
 * that was merely read re-arms it instead of skipping past it.
 */
export const decidedAnswerKeys = (guide: EnyoOnboardingV2Guide, answers: Answers = {}): string[] => {
    const {visited} = simulate(guide, answers);
    const keys: string[] = [];
    for (const name of visited) {
        const step = stepByName(guide, name);
        if (!step) {
            continue;
        }
        const decision = decisionBlock(step);
        if (decision) {
            if (answers[decision.id]) {
                keys.push(decision.id);
            }
        } else if (answers[continueKey(step)]) {
            keys.push(continueKey(step));
        }
    }
    return keys;
};
