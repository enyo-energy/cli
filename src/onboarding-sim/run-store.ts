/**
 * The simulated runs: one walk of one guide, in one start variant.
 *
 * The host owns this state on a real device (`onboarding-state.entity`); here it
 * lives in memory for as long as the CLI runs. What it keeps is deliberately the
 * same shape: the answers picked so far, replayed through the walker on every
 * render, so going back is dropping an answer rather than unwinding a stack.
 *
 * Everything the host would resolve against real hardware — a scan result, a
 * device test, an OCPP connection — is instead picked by whoever is driving the
 * browser. That is what makes the variants walkable: the flow branches the way
 * the installer says the world behaved, without the world.
 */
import {randomUUID} from 'node:crypto';
import {
    ENYO_ONBOARDING_V2_SETUP_DEFAULT_DURATION_MS,
    ENYO_ONBOARDING_V2_SETUP_FAILED_OUTCOME,
    ENYO_ONBOARDING_V2_SETUP_MAX_DURATION_MS,
    EnyoConsentGrantorEnum,
    EnyoOnboardingV2BlockType,
    EnyoOnboardingV2ConsentOutcome,
    EnyoOnboardingV2DeviceSelectOutcome,
    EnyoOnboardingV2DynamicKind,
    EnyoOnboardingV2EebusPairOutcome,
    EnyoOnboardingV2InputValueType,
    EnyoOnboardingV2StartVariant,
    EnyoOnboardingV2SubscriptionOfferOutcome,
    EnyoOnboardingV2TargetType,
    EnyoOnboardingV2TransitionSourceKind,
    EnyoOnboardingV2ZigbeePairOutcome,
    validateOnboardingV2SetupProgress,
} from '@enyo-energy/energy-app-sdk';
import type {
    EnyoConsentState,
    EnyoOnboardingTranslatedContent,
    EnyoOnboardingV2AdditionalSetupBlock,
    EnyoOnboardingV2DeviceSelectBlock,
    EnyoOnboardingV2EebusDeviceSelectBlock,
    EnyoOnboardingV2EebusPeer,
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2ProgressPhase,
    EnyoOnboardingV2SetupFieldValue,
    EnyoOnboardingV2SetupProgress,
    EnyoOnboardingV2Step,
    EnyoOnboardingV2Target,
    EnyoOnboardingV2TransitionSource,
    EnyoOnboardingV2ZigbeePairingBlock,
} from '@enyo-energy/energy-app-sdk';
import type {AppLogLine, GuideValidation, LoadedApp} from './app-loader.js';
import {
    clearAnswersAfter,
    continueKey,
    decisionBlock,
    decidedAnswerKeys,
    simulate,
    skipAnswer,
    stepByName,
    stepsToTerminal,
    type Answers,
} from './flow-walker.js';
import {defaultOutcomeId, isValidInput} from './input-rules.js';
import {buildRenderModel, type RenderModel} from './render-model.js';
import {
    SIMULATED_NETWORK_DEVICE,
    simulatedDevicesFor,
    simulatedEebusPeersFor,
    simulatedOcppUrl,
    simulatedZigbeeDevicesFor,
} from './simulated-world.js';

/**
 * The budget the host gives an app to fill a dynamic block, matching the
 * runtime: an installer is looking at the screen this fills.
 */
const DYNAMIC_TIMEOUT_MS = 5_000;
/**
 * The budget for one additional setup: the block's `maxDurationMs`, else the
 * SDK's default, never more than the SDK's ceiling. Running out is a `failed`
 * verdict like any other, and progress reports do not extend it.
 */
export const setupBudgetMs = (block: Pick<EnyoOnboardingV2AdditionalSetupBlock, 'maxDurationMs'>): number =>
    typeof block.maxDurationMs === 'number' && block.maxDurationMs > 0
        ? Math.min(block.maxDurationMs, ENYO_ONBOARDING_V2_SETUP_MAX_DURATION_MS)
        : ENYO_ONBOARDING_V2_SETUP_DEFAULT_DURATION_MS;
/**
 * The budget the host gives the input validation handler. Running out is
 * acceptance, exactly like having no handler.
 */
const INPUT_VALIDATION_TIMEOUT_MS = 5_000;
/**
 * The budget for one picker request.
 *
 * Between the two: an installer is waiting on the screen, but the handler is
 * creating appliances — and for an EEBUS peer it may be reading a feature or two
 * off a device that was trusted a second ago. Running out is not a branch: the
 * host stops waiting and continues as if no appliance had been produced, so the
 * run still takes the positive outcome, unbound.
 */
const PICK_TIMEOUT_MS = 30_000;

/** The world the run pretends to start in. One per start variant. */
export interface RunContext {
    variant: EnyoOnboardingV2StartVariant;
    /** The device the host would have found, when the variant has one. */
    networkDeviceId?: string;
    deviceIp?: string;
    deviceName?: string;
    /** The SKI an EEBUS picker paired the run to. */
    eebusSki?: string;
    /** The IEEE addresses a Zigbee pairing confirmed. */
    zigbeeIeeeAddresses?: string[];
    /**
     * The appliance the run is bound to — named by the guide on the two
     * appliance-bound variants, and otherwise produced by a picker's handler.
     */
    applianceId?: string;
}

/** What the app answered for one dynamic block. */
export interface DynamicResolution {
    blockId: string;
    value: string | null;
    detail?: string;
    /**
     * Who produced the value: the `app` (its answer wins), the `host` (the app
     * said nothing and the cloud resolved it itself), or nobody — `unresolved`,
     * which renders the step without the value.
     */
    source: 'app' | 'host' | 'unresolved' | 'no-handler';
    /** Why it is unresolved, when that is interesting (a rejection, a timeout). */
    note?: string;
    /** Complaints from the SDK's own validator about the app's answer. */
    errors?: string[];
}

/** What the app answered for one additional-setup block. */
export interface SetupResolution {
    blockId: string;
    setupKey: string;
    /** The block outcome the verdict routed to — always one the block declares. */
    outcomeId: string;
    /** The raw `outcome` string the app returned, before it was matched. */
    rawOutcome?: string;
    message?: { language: string; value: string }[];
    detail?: string;
    /** Set when the verdict is the reserved `failed` branch rather than a match. */
    fellBackToFailed: boolean;
    note?: string;
    /** What the request carried in `consents` — the answers for the block's `consentKeys`. */
    consents?: EnyoConsentState[];
    /** The budget the handler got, in milliseconds. */
    timeoutMs?: number;
}

/** One `reportSetupProgress()` call, with the SDK validator's verdict on it. */
export interface SetupProgressReport {
    at: number;
    progress: EnyoOnboardingV2SetupProgress;
    errors: string[];
    warnings: string[];
}

/**
 * What the installer sees under the CTA while a setup runs: the phase list in
 * force and where the app says it is. Built from the reports the host would
 * keep — a report the validator rejects does not move it.
 */
export interface SetupProgressView {
    blockId: string;
    requestId: string;
    phases: EnyoOnboardingV2ProgressPhase[];
    phaseKey?: string;
    percent?: number;
    message?: EnyoOnboardingTranslatedContent[];
    /** The handler resolved: the host marks every phase done. */
    finished: boolean;
    reports: SetupProgressReport[];
}

/** Which of the pickers a resolution belongs to. */
export type PickKind = 'device-select' | 'eebus-device-select' | 'zigbee-pairing';

/** One entry on a picker screen, in the shape the browser renders it. */
export interface PickCandidate {
    /** What the browser sends back: a network device id, or a peer's SKI. */
    key: string;
    title: string;
    subtitle?: string;
    /** The channels a device was detected through, or the type a peer announced. */
    badges: string[];
}

/** What came of one picker block: what was picked, and what the app made of it. */
export interface PickResolution {
    blockId: string;
    kind: PickKind;
    /** The device id, SKI or (first) IEEE address the run is now bound to. */
    key: string;
    /** Every confirmed entry — more than one only on a Zigbee pairing with `maxDevices` above 1. */
    keys: string[];
    /** The candidate's title, for the event log and the badge. */
    label: string;
    /**
     * `true` when the installer confirmed the candidate the app highlighted for
     * them — the lone match of a block that left `autoSelectSingleMatch` on —
     * rather than picking one themselves.
     */
    autoSelected: boolean;
    /**
     * The appliances the app answered with. Empty is a valid answer and does not
     * re-route the run: the pick stands, the run is simply unbound.
     */
    applianceIds: string[];
    /** Who answered, or why nobody did. */
    source: 'app' | 'no-handler' | 'timeout' | 'rejected';
    /** Untranslated technical detail the app attached. */
    detail?: string;
    /** Why there are no appliance ids, when that is interesting. */
    note?: string;
}

/** A picker block as the browser needs it: the list, and what came of it. */
export interface PickerView {
    blockId: string;
    kind: PickKind;
    candidates: PickCandidate[];
    /**
     * The candidate the app highlights on entry: the lone match of a block that
     * left `autoSelectSingleMatch` on. Highlighted, never committed — the app
     * still draws the step and the installer still confirms it, so they can see
     * which box the run is about to bind.
     */
    preselectedKey?: string;
    /** Every highlighted entry — a Zigbee pairing highlights `maxDevices` of them. */
    preselectedKeys?: string[];
    /** How many entries may be confirmed: 1, except on a Zigbee pairing. */
    maxDevices: number;
    resolution?: PickResolution;
}

/** What came of pressing a consent CTA. */
export interface ConsentResolution {
    blockId: string;
    /** Every required consent is in force, so the block's `given` outcome fired. */
    given: boolean;
    /** Required consents still missing — the run waits on the step for them. */
    missing: string[];
    /** Answers the acting role was not allowed to give, and so were not recorded. */
    refused: string[];
    states: EnyoConsentState[];
    note?: string;
}

export interface SimRun {
    id: string;
    guideIndex: number;
    context: RunContext;
    answers: Answers;
    /** Values typed into input blocks, kept so the step can show them again. */
    inputs: Record<string, string>;
    dynamic: Record<string, DynamicResolution>;
    setups: Record<string, SetupResolution>;
    /** What each picker block came away with, by block id. */
    picks: Record<string, PickResolution>;
    /** The progress of each additional setup that reported any, by block id. */
    progress: Record<string, SetupProgressView>;
    /** The app's rejection of a validated input's value, by block id. */
    inputErrors: Record<string, EnyoOnboardingTranslatedContent[] | string | undefined>;
    /** Plan keys bought on a subscription-offer step during this run. */
    subscriptions: string[];
    /** Every decision, newest last — the run's own audit trail. */
    events: { at: number; message: string }[];
}

export interface GuideSummary {
    index: number;
    name: string;
    startVariant: EnyoOnboardingV2StartVariant;
    title: EnyoOnboardingV2Guide['title'];
    summary?: EnyoOnboardingV2Guide['summary'];
    iconKey?: EnyoOnboardingV2Guide['iconKey'];
    requiresNetworkScan: boolean;
    applianceId?: string;
    vendorId?: string;
    modelIds?: string[];
    stepCount: number;
    validation?: GuideValidation;
}

export interface RunView {
    runId: string;
    guide: GuideSummary;
    context: RunContext;
    status: 'await' | 'terminal' | 'dead-end' | 'loop';
    step?: EnyoOnboardingV2Step;
    /** The step's decision block id, when it has one. */
    decisionBlockId?: string;
    /** The handle the simulator suggests for the decision block. */
    suggestedHandleId?: string;
    terminal?: EnyoOnboardingV2Target;
    /**
     * The guide this run hands off to, when the terminal is a `start-variant`
     * target and the app ships a guide for that variant.
     */
    handoffGuideIndex?: number;
    visited: string[];
    stepsRemaining: number;
    canGoBack: boolean;
    inputs: Record<string, string>;
    dynamic: Record<string, DynamicResolution>;
    setups: Record<string, SetupResolution>;
    /** The picker blocks of the current step, keyed by block id. */
    pickers: Record<string, PickerView>;
    progress: Record<string, SetupProgressView>;
    /** What enyo holds for every consent the package declares. */
    consentStates: EnyoConsentState[];
    subscriptions: string[];
    events: { at: number; message: string }[];
    /** The step exactly as the enyo app is handed it — what the preview renders. */
    renderModel: RenderModel;
}

/**
 * The run index of the package's static manual setup guide. It sits outside
 * `app.guides` on purpose: the host never offers it, so it must never be found
 * by a hand-off or listed among the app's runtime guides.
 */
export const PACKAGE_GUIDE_INDEX = -1;

/** The five start variants, in the order the UI lists them. */
export const START_VARIANTS: EnyoOnboardingV2StartVariant[] = [
    EnyoOnboardingV2StartVariant.DeviceNotFound,
    EnyoOnboardingV2StartVariant.DeviceFoundConfig,
    EnyoOnboardingV2StartVariant.ManualSetup,
    EnyoOnboardingV2StartVariant.Maintenance,
    EnyoOnboardingV2StartVariant.OfflineReconnect,
];

/**
 * The fake world each variant starts in.
 *
 * `device-found-config` is the only installation variant that carries a device,
 * because it is the only one that starts from a successful scan; `maintenance`
 * and `offline-reconnect` carry the appliance the guide is bound to, which is an
 * input to the run rather than something it produces.
 */
export const defaultContextFor = (
    variant: EnyoOnboardingV2StartVariant,
    guide?: EnyoOnboardingV2Guide
): RunContext => {
    switch (variant) {
        case EnyoOnboardingV2StartVariant.DeviceFoundConfig:
            // The same device the mock SDK serves, so an app that looks up the
            // id the host handed it finds something.
            return {
                variant,
                networkDeviceId: SIMULATED_NETWORK_DEVICE.id,
                deviceIp: SIMULATED_NETWORK_DEVICE.ipAddress,
                deviceName: SIMULATED_NETWORK_DEVICE.hostname,
            };
        case EnyoOnboardingV2StartVariant.Maintenance:
        case EnyoOnboardingV2StartVariant.OfflineReconnect:
            // Both variants start from an appliance that already exists, and the
            // guide is required to name it. A reconnect run carries no device:
            // finding one again is the flow's job, and its picker is handed this
            // appliance id so it re-binds rather than creating a second one.
            return {
                variant,
                applianceId: guide?.applianceId ?? 'sim-appliance',
            };
        default:
            return {variant};
    }
};

type PickerBlock =
    | EnyoOnboardingV2DeviceSelectBlock
    | EnyoOnboardingV2EebusDeviceSelectBlock
    | EnyoOnboardingV2ZigbeePairingBlock;

/** Whether a block is one of the pickers — the blocks that own their step. */
const isPickerBlock = (block: {type: EnyoOnboardingV2BlockType}): block is PickerBlock =>
    block.type === EnyoOnboardingV2BlockType.DeviceSelect ||
    block.type === EnyoOnboardingV2BlockType.EebusDeviceSelect ||
    block.type === EnyoOnboardingV2BlockType.ZigbeePairing;

const pickKindOf = (block: {type: EnyoOnboardingV2BlockType}): PickKind =>
    block.type === EnyoOnboardingV2BlockType.DeviceSelect
        ? 'device-select'
        : block.type === EnyoOnboardingV2BlockType.ZigbeePairing
          ? 'zigbee-pairing'
          : 'eebus-device-select';

/** How many entries a picker confirms at once. */
const maxDevicesOf = (block: PickerBlock): number =>
    block.type === EnyoOnboardingV2BlockType.ZigbeePairing && typeof block.maxDevices === 'number' && block.maxDevices >= 1
        ? Math.floor(block.maxDevices)
        : 1;

/** Reject after `timeoutMs`, the way the host gives up on a slow handler. */
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> => {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<'timeout'>(resolve => {
                timer = setTimeout(() => resolve('timeout'), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

const summarize = (
    guide: EnyoOnboardingV2Guide,
    index: number,
    name: string,
    validation: GuideValidation | undefined
): GuideSummary => ({
    index,
    name,
    startVariant: guide.startVariant,
    title: guide.title,
    summary: guide.summary,
    iconKey: guide.iconKey,
    // Defaults to true — the historic behaviour, and the right one for a
    // LAN device.
    requiresNetworkScan: guide.requiresNetworkScan !== false,
    applianceId: guide.applianceId,
    vendorId: guide.vendorId,
    modelIds: guide.modelIds,
    stepCount: guide.steps.length,
    validation,
});

export class RunStore {
    private readonly runs = new Map<string, SimRun>();
    private readonly startedAt = Date.now();

    /**
     * @param app - The booted app.
     * @param onEvent - Where lines worth printing go as they happen — progress
     *   reports arrive while a setup request is still open, so they cannot wait
     *   for the run view the request returns.
     */
    constructor(
        private app: LoadedApp,
        private readonly onEvent?: (message: string, level?: 'info' | 'warn' | 'error') => void
    ) {}

    /** Point the store at a freshly pulled guide set; open runs are dropped with it. */
    replaceApp(app: LoadedApp): void {
        this.app = app;
        this.runs.clear();
    }

    get loadedApp(): LoadedApp {
        return this.app;
    }

    guideAt(index: number): EnyoOnboardingV2Guide | undefined {
        return index === PACKAGE_GUIDE_INDEX ? this.app.packageGuide?.guide : this.app.guides[index];
    }

    /** Every guide the app ships, described for the library screen. */
    summaries(): GuideSummary[] {
        return this.app.guides.map((guide, index) =>
            summarize(guide, index, guide.name ?? `guide-${index + 1}`, this.app.validation.guides[index])
        );
    }

    /** The package's static manual setup guide, when it declares one. */
    packageGuideSummary(): GuideSummary | undefined {
        const declared = this.app.packageGuide;
        if (!declared) {
            return undefined;
        }
        // `name` has no meaning on the static guide, so it is usually absent.
        return summarize(declared.guide, PACKAGE_GUIDE_INDEX, declared.guide.name ?? 'pre-app-onboarding', {
            guideName: declared.guide.name ?? 'pre-app-onboarding',
            ...declared.validation,
        });
    }

    private summaryAt(index: number): GuideSummary {
        const summary = index === PACKAGE_GUIDE_INDEX ? this.packageGuideSummary() : this.summaries()[index];
        if (!summary) {
            throw new Error(`No guide at index ${index}`);
        }
        return summary;
    }

    createRun(guideIndex: number, context?: Partial<RunContext>): SimRun {
        const guide = this.guideAt(guideIndex);
        if (!guide) {
            throw new Error(`No guide at index ${guideIndex}`);
        }

        const run: SimRun = {
            id: randomUUID(),
            guideIndex,
            context: {...defaultContextFor(guide.startVariant, guide), ...context, variant: guide.startVariant},
            answers: {},
            inputs: {},
            dynamic: {},
            setups: {},
            picks: {},
            progress: {},
            inputErrors: {},
            subscriptions: [],
            events: [],
        };
        this.record(run, `Run started — ${guide.startVariant}`);
        this.runs.set(run.id, run);
        return run;
    }

    run(runId: string): SimRun {
        const run = this.runs.get(runId);
        if (!run) {
            throw new Error(`No run ${runId}`);
        }
        return run;
    }

    reset(runId: string): SimRun {
        const run = this.run(runId);
        run.answers = {};
        run.inputs = {};
        run.dynamic = {};
        run.setups = {};
        run.picks = {};
        run.progress = {};
        run.inputErrors = {};
        run.subscriptions = [];
        run.events = [];
        this.record(run, 'Run reset');
        return run;
    }

    /** Drop the last recorded answer, re-arming the step it belongs to. */
    back(runId: string): SimRun {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const keys = decidedAnswerKeys(guide, run.answers);
        const last = keys[keys.length - 1];
        if (last) {
            delete run.answers[last];
            this.record(run, 'Went back one step');
        }
        return run;
    }

    /**
     * Record the installer's pick on the current step and let the walk continue.
     *
     * Answers of steps walked *after* this one are cleared first: the walk
     * replays every answer from the start, so a step the flow returns to would
     * otherwise resolve instantly with the answer from its first visit.
     */
    answer(runId: string, source: EnyoOnboardingV2TransitionSource, label?: string): SimRun {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const walk = simulate(guide, run.answers);
        const step = stepByName(guide, walk.currentStepName);
        if (!step) {
            throw new Error('The run is not on a step that can be answered');
        }

        this.forgetPicksAfter(guide, run, step.name);
        clearAnswersAfter(guide, run.answers, step.name);

        if (source.kind === EnyoOnboardingV2TransitionSourceKind.Continue) {
            run.answers[continueKey(step)] = 'continue';
            this.record(run, `${step.name}: continued`);
            return run;
        }

        const decision = decisionBlock(step);
        if (!decision || decision.id !== source.blockId) {
            throw new Error(`Block ${source.blockId} is not the decision block of step ${step.name}`);
        }

        if (source.kind === EnyoOnboardingV2TransitionSourceKind.Choice) {
            run.answers[decision.id] = source.optionId;
            this.record(run, `${step.name}: chose ${label ?? source.optionId}`);
        } else if (source.kind === EnyoOnboardingV2TransitionSourceKind.Skip) {
            run.answers[decision.id] = skipAnswer(source.skipId);
            this.record(run, `${step.name}: skipped ${label ?? source.skipId}`);
        } else {
            run.answers[decision.id] = source.outcomeId;
            this.record(run, `${step.name}: outcome ${label ?? source.outcomeId}`);
        }
        return run;
    }

    /** Keep the value typed into an input block, so the step can show it again. */
    recordInput(runId: string, blockId: string, value: string): SimRun {
        const run = this.run(runId);
        run.inputs[blockId] = value;
        return run;
    }

    /**
     * Whether a typed value passes the block's own check.
     *
     * The host checks it again on a device, which is why the same rules are
     * ported here rather than left to the browser.
     */
    validateInput(runId: string, blockId: string, value: string): { valid: boolean } {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        for (const step of guide.steps) {
            const block = step.blocks.find(candidate => candidate.id === blockId);
            if (block?.type === EnyoOnboardingV2BlockType.Input) {
                return {valid: isValidInput(block.valueType, value)};
            }
        }
        return {valid: value.trim().length > 0};
    }

    /**
     * Record the answers to a step's consent checkboxes, as enyo does when the
     * CTA is pressed: each answer with the declared version and the role of the
     * person, and the app's listeners hear about every change.
     *
     * The declaration decides who may agree. An answer the acting role may not
     * give is not recorded — the host shows that role the text but no
     * checkbox — and is reported back as `refused`.
     */
    private recordConsentAnswers(
        run: SimRun,
        stepName: string,
        consentKeys: string[],
        answers: Record<string, boolean>,
        role: EnyoConsentGrantorEnum
    ): { missing: string[]; refused: string[]; states: EnyoConsentState[] } {
        const refused: string[] = [];
        for (const key of consentKeys) {
            const declared = this.app.consents.find(consent => consent.consentKey === key);
            if (!declared || answers[key] === undefined) {
                continue;
            }
            const current = this.app.mock.state.consentStates.find(state => state.consentKey === key);
            const inForce = current?.granted === true && current.version === declared.version;
            if (answers[key] === inForce) {
                continue;
            }
            if (!declared.grantableBy.includes(role)) {
                refused.push(key);
                continue;
            }
            this.app.mock.setConsent(key, answers[key], role);
            this.record(run, `${stepName}: consent '${key}' v${declared.version} ${answers[key] ? 'given' : 'withdrawn'} by the ${role}`);
        }

        const states = consentKeys
            .map(key => this.app.mock.state.consentStates.find(state => state.consentKey === key))
            .filter((state): state is EnyoConsentState => Boolean(state))
            .map(state => ({...state}));
        const missing = consentKeys.filter(key => {
            const declared = this.app.consents.find(consent => consent.consentKey === key);
            // An undeclared key is a validation error, and nothing anyone ticks can satisfy it.
            if (!declared) {
                return true;
            }
            const state = states.find(entry => entry.consentKey === key);
            return declared.required && !(state?.granted && state.version === declared.version);
        });
        return {missing, refused, states};
    }

    /**
     * Tick or untick one declared consent outside any step — the inspector's
     * toggle, standing in for the customer answering in their own enyo app.
     */
    setConsent(consentKey: string, granted: boolean, role: EnyoConsentGrantorEnum): EnyoConsentState {
        const state = this.app.mock.setConsent(consentKey, granted, role);
        if (!state) {
            throw new Error(`The package declares no consent '${consentKey}'`);
        }
        this.onEvent?.(`Consent '${consentKey}' ${granted ? 'given' : 'withdrawn'} by the ${role} (outside the guide)`);
        return state;
    }

    /**
     * Press the CTA of a consent block.
     *
     * Mirrors the host: the answers are recorded first, and `given` fires only
     * once every required consent of the block is in force. A required consent
     * the acting role may not give keeps the run waiting on the step — on a
     * device until the customer agrees in their own app.
     */
    giveConsents(
        runId: string,
        blockId: string,
        answers: Record<string, boolean>,
        role: EnyoConsentGrantorEnum
    ): ConsentResolution {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const step = stepByName(guide, simulate(guide, run.answers).currentStepName);
        const block = step?.blocks.find(candidate => candidate.id === blockId);
        if (!step || !block || block.type !== EnyoOnboardingV2BlockType.Consent) {
            throw new Error(`Block ${blockId} is not a consent block on the current step`);
        }

        const {missing, refused, states} = this.recordConsentAnswers(run, step.name, block.consentKeys, answers, role);
        const resolution: ConsentResolution = {blockId, given: missing.length === 0, missing, refused, states};
        if (!resolution.given) {
            resolution.note =
                `Still missing: ${missing.join(', ')}. The run waits on this step until ` +
                'someone allowed to give them agrees.';
            this.record(run, `${step.name}: consent CTA — waiting for ${missing.join(', ')}`);
            return resolution;
        }

        // Compared as a string: a block's outcome `value` is the plain string the author wrote.
        const givenValue: string = EnyoOnboardingV2ConsentOutcome.Given;
        const outcome = block.outcomes.find(candidate => candidate.value === givenValue);
        if (!outcome) {
            resolution.note = `The block declares no '${EnyoOnboardingV2ConsentOutcome.Given}' outcome, so the run has nowhere to go.`;
            return resolution;
        }
        this.answer(
            runId,
            {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId, outcomeId: outcome.id},
            EnyoOnboardingV2ConsentOutcome.Given
        );
        return resolution;
    }

    /**
     * Buy a plan on a subscription-offer step. There is no checkout here: the
     * purchase always succeeds, and the block's `subscribed` outcome fires the
     * way it does once enyo holds the subscription.
     */
    subscribe(runId: string, blockId: string, planKey: string): void {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const step = stepByName(guide, simulate(guide, run.answers).currentStepName);
        const block = step?.blocks.find(candidate => candidate.id === blockId);
        if (!step || !block || block.type !== EnyoOnboardingV2BlockType.SubscriptionOffer) {
            throw new Error(`Block ${blockId} is not a subscription-offer block on the current step`);
        }
        const declared = this.app.definition?.subscriptionPlans ?? [];
        const offered = block.planKeys ? declared.filter(plan => block.planKeys!.includes(plan.planKey)) : declared;
        if (!offered.some(plan => plan.planKey === planKey)) {
            throw new Error(`Plan '${planKey}' is not offered on ${blockId}`);
        }
        const subscribedValue: string = EnyoOnboardingV2SubscriptionOfferOutcome.Subscribed;
        const outcome = block.outcomes.find(candidate => candidate.value === subscribedValue);
        if (!outcome) {
            throw new Error(`Block ${blockId} declares no '${EnyoOnboardingV2SubscriptionOfferOutcome.Subscribed}' outcome`);
        }
        if (!run.subscriptions.includes(planKey)) {
            run.subscriptions.push(planKey);
        }
        this.record(run, `${step.name}: subscribed to '${planKey}' (simulated checkout)`);
        this.answer(
            runId,
            {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId, outcomeId: outcome.id},
            EnyoOnboardingV2SubscriptionOfferOutcome.Subscribed
        );
    }

    /**
     * Hand a value typed into a `validated` input block to the app's input
     * validation handler.
     *
     * Not a branch: a rejection keeps the installer on the step with the app's
     * message. No handler, a timeout and a throwing handler all accept, as on a
     * device. An IP-address input is never sent — its device test is the check.
     */
    async checkInputWithApp(runId: string, blockId: string, value: string): Promise<{ valid: boolean; note?: string }> {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const step = stepByName(guide, simulate(guide, run.answers).currentStepName);
        const block = step?.blocks.find(candidate => candidate.id === blockId);
        delete run.inputErrors[blockId];
        if (
            !step ||
            block?.type !== EnyoOnboardingV2BlockType.Input ||
            block.validated !== true ||
            block.valueType === EnyoOnboardingV2InputValueType.IpAddress
        ) {
            return {valid: true};
        }

        const handler = this.app.mock.state.inputValidationHandler;
        if (!handler) {
            this.record(run, `${step.name}: no input validation handler — the value is accepted unchecked`);
            return {valid: true, note: 'no-handler'};
        }
        try {
            const answer = await withTimeout(
                handler({
                    requestId: randomUUID(),
                    blockId,
                    stepName: step.name,
                    valueType: block.valueType,
                    value,
                    networkDeviceId: run.context.networkDeviceId,
                    applianceId: run.context.applianceId,
                    timeoutMs: INPUT_VALIDATION_TIMEOUT_MS,
                }),
                INPUT_VALIDATION_TIMEOUT_MS
            );
            if (answer === 'timeout') {
                this.record(run, `${step.name}: input validation timed out after ${INPUT_VALIDATION_TIMEOUT_MS} ms — accepted`);
                return {valid: true, note: 'timeout'};
            }
            if (answer.valid) {
                this.record(run, `${step.name}: the app accepted the value`);
                return {valid: true};
            }
            run.inputErrors[blockId] = answer.errorMessage ?? 'Der Wert wurde nicht akzeptiert.';
            this.record(run, `${step.name}: the app rejected the value — the installer stays on the step`);
            return {valid: false};
        } catch (error) {
            this.record(
                run,
                `${step.name}: input validation handler rejected (${error instanceof Error ? error.message : String(error)}) — accepted`
            );
            return {valid: true, note: 'rejected'};
        }
    }

    /**
     * Take one `reportSetupProgress()` call for the running request: check it
     * with the SDK's validator against the phase list in force and the previous
     * report, keep it, and move the progress only where the host would.
     */
    private takeProgress(run: SimRun, stepName: string, view: SetupProgressView, progress: EnyoOnboardingV2SetupProgress): void {
        const previous = view.reports.length > 0 ? view.reports[view.reports.length - 1].progress : undefined;
        const {errors, warnings} = validateOnboardingV2SetupProgress(progress, {
            phases: view.phases.length > 0 ? view.phases : undefined,
            previous,
        });
        view.reports.push({at: Date.now() - this.startedAt, progress, errors, warnings});

        // The host keeps what it can use and the last good value of the rest.
        if (errors.length === 0) {
            if (progress.phases) {
                view.phases = progress.phases;
            }
            if (progress.phaseKey !== undefined) {
                view.phaseKey = progress.phaseKey;
            }
            if (progress.percent !== undefined) {
                view.percent = progress.percent;
            }
            if (progress.message !== undefined) {
                view.message = progress.message;
            }
        }

        const parts = [
            progress.phaseKey ? `phase ${progress.phaseKey}` : undefined,
            progress.percent !== undefined ? `${progress.percent} %` : undefined,
            progress.phases ? `${progress.phases.length} phases` : undefined,
        ].filter(Boolean);
        const line = `${stepName}: progress ${parts.join(', ') || '(empty report)'}`;
        this.record(run, line + (errors.length ? ' — dropped' : ''));
        this.onEvent?.(`Setup progress · ${line}`, errors.length ? 'error' : warnings.length ? 'warn' : 'info');
        for (const error of errors) {
            this.onEvent?.(`Setup progress · ${stepName}: ${error}`, 'error');
        }
        for (const warning of warnings) {
            this.onEvent?.(`Setup progress · ${stepName}: ${warning}`, 'warn');
        }
    }

    /** The progress of a run's setups, for the browser to poll while a request is open. */
    progressOf(runId: string): Record<string, SetupProgressView> {
        return this.run(runId).progress;
    }

    /**
     * Run an `additional-setup` block: hand the collected fields to the app and
     * turn its verdict into the outcome the guide branches on.
     *
     * Mirrors `additional-setup.runner.ts`: the app's `outcome` string is matched
     * against the block's declared outcome *values*, and everything else — no
     * handler, a rejection, a timeout, an undeclared outcome — falls back to the
     * reserved `failed` branch. The installer always gets a branch.
     *
     * A block with `consentKeys` records the ticked consents first and refuses
     * to run while a required one is missing — the CTA is disabled on a device.
     * The budget is the block's `maxDurationMs`, and progress reports arriving
     * while the handler runs are validated and kept.
     *
     * The collected values may be credentials, so nothing here logs one: only the
     * setup key, the field names and the resulting outcome.
     */
    async runAdditionalSetup(
        runId: string,
        blockId: string,
        values: EnyoOnboardingV2SetupFieldValue[],
        consentAnswers: Record<string, boolean> = {},
        role: EnyoConsentGrantorEnum = EnyoConsentGrantorEnum.Installer
    ): Promise<SetupResolution> {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const walk = simulate(guide, run.answers);
        const step = stepByName(guide, walk.currentStepName);
        const block = step?.blocks.find(candidate => candidate.id === blockId);
        if (!step || !block || block.type !== EnyoOnboardingV2BlockType.AdditionalSetup) {
            throw new Error(`Block ${blockId} is not an additional-setup block on the current step`);
        }

        const setupBlock: EnyoOnboardingV2AdditionalSetupBlock = block;
        let consents: EnyoConsentState[] | undefined;
        if (setupBlock.consentKeys?.length) {
            const recorded = this.recordConsentAnswers(run, step.name, setupBlock.consentKeys, consentAnswers, role);
            if (recorded.missing.length > 0) {
                throw new Error(
                    `Required consent(s) not given: ${recorded.missing.join(', ')} — the CTA stays disabled until ` +
                    'someone allowed to give them agrees.'
                );
            }
            consents = recorded.states;
        }

        const handler = this.app.mock.state.additionalSetupHandler;
        const timeoutMs = setupBudgetMs(setupBlock);
        const fieldNames = values.map(value => value.name).join(', ');
        this.record(run, `${step.name}: setup '${setupBlock.setupKey}' with fields [${fieldNames}], budget ${timeoutMs} ms`);

        const failed = (note: string, extra: Partial<SetupResolution> = {}): SetupResolution => ({
            blockId,
            setupKey: setupBlock.setupKey,
            outcomeId:
                setupBlock.outcomes.find(outcome => outcome.value === ENYO_ONBOARDING_V2_SETUP_FAILED_OUTCOME)?.id ?? '',
            fellBackToFailed: true,
            note,
            consents,
            timeoutMs,
            ...extra,
        });

        let resolution: SetupResolution;
        if (!handler) {
            resolution = failed('The app registered no additional-setup handler, so every setup block fails.');
        } else {
            const requestId = randomUUID();
            const progress: SetupProgressView = {
                blockId,
                requestId,
                phases: setupBlock.progressPhases ? [...setupBlock.progressPhases] : [],
                finished: false,
                reports: [],
            };
            run.progress[blockId] = progress;
            // Reports for any other request — an earlier one, or one that has
            // already been answered — are dropped, as the host drops them.
            this.app.mock.state.onSetupProgress = (reportedId, report) => {
                if (reportedId === requestId && !progress.finished) {
                    this.takeProgress(run, step.name, progress, report);
                } else {
                    this.onEvent?.(
                        `Setup progress for request ${reportedId} ignored — it is not the running request.`,
                        'warn'
                    );
                }
            };
            try {
                const answer = await withTimeout(
                    handler({
                        requestId,
                        setupKey: setupBlock.setupKey,
                        blockId,
                        stepName: step.name,
                        values,
                        networkDeviceId: run.context.networkDeviceId,
                        applianceId: run.context.applianceId,
                        consents,
                        timeoutMs,
                    }),
                    timeoutMs
                );

                if (answer === 'timeout') {
                    resolution = failed(`The app did not answer within ${timeoutMs} ms.`);
                } else {
                    const matched = setupBlock.outcomes.find(outcome => outcome.value === answer.outcome);
                    resolution = matched
                        ? {
                              blockId,
                              setupKey: setupBlock.setupKey,
                              outcomeId: matched.id,
                              rawOutcome: answer.outcome,
                              message: answer.message,
                              detail: answer.detail,
                              fellBackToFailed: false,
                              consents,
                              timeoutMs,
                          }
                        : failed(
                              `The app answered '${answer.outcome}', which this block does not declare ` +
                                  `([${setupBlock.outcomes.map(outcome => outcome.value).join(', ')}]).`,
                              {rawOutcome: answer.outcome, message: answer.message, detail: answer.detail}
                          );
                }
            } catch (error) {
                resolution = failed(
                    `The app's handler rejected: ${error instanceof Error ? error.message : String(error)}`
                );
            } finally {
                // The promise settling is the end: every phase counts as done.
                progress.finished = true;
                if (this.app.mock.state.onSetupProgress) {
                    this.app.mock.state.onSetupProgress = undefined;
                }
            }
        }

        run.setups[blockId] = resolution;
        this.record(
            run,
            `${step.name}: setup '${setupBlock.setupKey}' → ${resolution.rawOutcome ?? ENYO_ONBOARDING_V2_SETUP_FAILED_OUTCOME}` +
                (resolution.fellBackToFailed ? ' (failed branch)' : '')
        );

        if (!resolution.outcomeId) {
            // An authoring gap: the block declares no `failed` outcome, so there
            // is nowhere to route. Say so rather than answering arbitrarily.
            return resolution;
        }

        this.answer(
            runId,
            {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId, outcomeId: resolution.outcomeId},
            resolution.rawOutcome ?? ENYO_ONBOARDING_V2_SETUP_FAILED_OUTCOME
        );
        return resolution;
    }

    /**
     * What the host puts behind a dynamic block when the app does not answer.
     *
     * Mirrors `DynamicResolverService`: the OCPP URL is built from the hub and
     * app slugs, and `device-ip` is the last address known for the run's device
     * — so a run that carries no device (every variant but
     * `device-found-config`) genuinely has nothing to show, exactly as on a
     * device where the scan found nothing.
     */
    private hostResolved(
        run: SimRun,
        blockId: string,
        kind: EnyoOnboardingV2DynamicKind,
        reason: string
    ): DynamicResolution {
        const value =
            kind === EnyoOnboardingV2DynamicKind.OcppUrl ? simulatedOcppUrl() : run.context.deviceIp ?? null;
        return {
            blockId,
            value,
            source: value ? 'host' : 'unresolved',
            note: value
                ? `${reason}, so this is the host's own resolution.`
                : `${reason}, and the host has no value either — the step renders without it.`,
        };
    }

    /**
     * Fill the dynamic blocks of a step by asking the app, once per run and
     * block.
     *
     * `null` is a normal answer: the block is passive content with no routing
     * handle, so an unresolved value never strands a run — on a device the host
     * falls back to its own resolution, and failing that renders the step
     * without the value. The simulator shows which of the two happened.
     */
    private async resolveDynamicBlocks(run: SimRun, step: EnyoOnboardingV2Step): Promise<void> {
        const handler = this.app.mock.state.dynamicHandler;
        for (const block of step.blocks) {
            if (block.type !== EnyoOnboardingV2BlockType.Dynamic || run.dynamic[block.id]) {
                continue;
            }

            if (!handler) {
                run.dynamic[block.id] = this.hostResolved(
                    run,
                    block.id,
                    block.kind,
                    'The app registered no dynamic value handler'
                );
                continue;
            }

            const requestId = randomUUID();
            try {
                const answer = await withTimeout(
                    handler({
                        requestId,
                        kind: block.kind,
                        blockId: block.id,
                        stepName: step.name,
                        networkDeviceId: run.context.networkDeviceId,
                        applianceId: run.context.applianceId,
                        timeoutMs: DYNAMIC_TIMEOUT_MS,
                    }),
                    DYNAMIC_TIMEOUT_MS
                );

                if (answer === 'timeout') {
                    run.dynamic[block.id] = this.hostResolved(
                        run,
                        block.id,
                        block.kind,
                        `The app did not answer within ${DYNAMIC_TIMEOUT_MS} ms`
                    );
                } else if (answer === null) {
                    run.dynamic[block.id] = this.hostResolved(
                        run,
                        block.id,
                        block.kind,
                        'The app answered null — a normal answer meaning "not available"'
                    );
                } else {
                    run.dynamic[block.id] = {
                        blockId: block.id,
                        value: answer.value,
                        detail: answer.detail,
                        source: 'app',
                        errors:
                            answer.kind === block.kind
                                ? undefined
                                : [`The app answered for kind '${answer.kind}' but the block asks for '${block.kind}'.`],
                    };
                }
            } catch (error) {
                run.dynamic[block.id] = this.hostResolved(
                    run,
                    block.id,
                    block.kind,
                    `The app's handler rejected (${error instanceof Error ? error.message : String(error)})`
                );
            }
        }
    }


    // ---- pickers ----------------------------------------------------------

    /**
     * The candidates a picker block offers, after its own filter.
     *
     * The list is discovery's, not the block's: a `device-select` sees what the
     * scan turned up, an `eebus-device-select` sees what announced itself over
     * SHIP, and a `zigbee-pairing` sees what joined the network it opened. The
     * filter only narrows it, which is why a filter that matches nothing leaves
     * an empty screen rather than the unfiltered list.
     */
    candidatesFor(block: PickerBlock): PickCandidate[] {
        if (block.type === EnyoOnboardingV2BlockType.DeviceSelect) {
            return simulatedDevicesFor(block.detectedAt).map(device => ({
                key: device.id,
                title: device.hostname,
                subtitle: device.ipAddress,
                badges: device.detectedAt ?? [],
            }));
        }
        if (block.type === EnyoOnboardingV2BlockType.ZigbeePairing) {
            return simulatedZigbeeDevicesFor(block.manufacturerNames, block.modelIds).map(device => ({
                key: device.ieeeAddress,
                title: device.name ?? device.modelId ?? device.ieeeAddress,
                subtitle: [device.manufacturerName ?? 'no manufacturer name', device.modelId, device.ieeeAddress]
                    .filter(Boolean)
                    .join(' · '),
                badges: [device.interviewState, device.powerSource].filter((badge): badge is NonNullable<typeof badge> =>
                    Boolean(badge)
                ),
            }));
        }
        return simulatedEebusPeersFor(block.deviceTypes).map(peer => ({
            key: peer.ski,
            title: peer.deviceName ?? peer.ski,
            subtitle: [peer.deviceModel, peer.host ? `${peer.host}:${peer.port ?? ''}` : undefined]
                .filter(Boolean)
                .join(' · '),
            // A peer that announced nothing says so: it is what a `deviceTypes`
            // filter excludes, and the first thing to check when it is missing.
            badges: [peer.deviceType ?? 'no announced type'],
        }));
    }

    /**
     * What the app highlights on entry: the lone match of a block that left
     * `autoSelectSingleMatch` on — for a Zigbee pairing, exactly `maxDevices`
     * matching devices.
     */
    private preselectionFor(block: PickerBlock, candidates: PickCandidate[]): string[] {
        if (block.autoSelectSingleMatch === false || candidates.length === 0) {
            return [];
        }
        return candidates.length === maxDevicesOf(block) ? candidates.map(candidate => candidate.key) : [];
    }

    /** The picker blocks of a step, with their lists and whatever came of them. */
    private pickerViews(run: SimRun, step: EnyoOnboardingV2Step): Record<string, PickerView> {
        const views: Record<string, PickerView> = {};
        for (const block of step.blocks) {
            if (!isPickerBlock(block)) {
                continue;
            }
            const candidates = this.candidatesFor(block);
            const preselected = this.preselectionFor(block, candidates);
            views[block.id] = {
                blockId: block.id,
                kind: pickKindOf(block),
                candidates,
                preselectedKey: preselected.length === 1 ? preselected[0] : undefined,
                preselectedKeys: preselected.length > 0 ? preselected : undefined,
                maxDevices: maxDevicesOf(block),
                resolution: run.picks[block.id],
            };
        }
        return views;
    }

    /**
     * Record the installer's pick on the current step's picker block.
     *
     * The positive branch only: a run that came away with nothing takes
     * `not-found` (or, for a handshake that did not come up, `failure`), and
     * those are ordinary outcome answers with no handler behind them.
     *
     * `keys` is one entry, or up to `maxDevices` on a Zigbee pairing.
     * `autoSelected` is what the browser says: the installer confirmed what the
     * app highlighted rather than picking themselves. It is only believed for
     * exactly the highlighted set.
     */
    async pick(runId: string, blockId: string, keys: string | string[], autoSelected = false): Promise<PickResolution> {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const walk = simulate(guide, run.answers);
        const step = stepByName(guide, walk.currentStepName);
        const block = step?.blocks.find(candidate => candidate.id === blockId);
        if (!step || !block || !isPickerBlock(block)) {
            throw new Error(`Block ${blockId} is not a picker block on the current step`);
        }

        const wanted = [...new Set(Array.isArray(keys) ? keys : [keys])];
        const max = maxDevicesOf(block);
        if (wanted.length === 0 || wanted.length > max) {
            throw new Error(`Pick between 1 and ${max} entr${max === 1 ? 'y' : 'ies'} on ${blockId}`);
        }
        const list = this.candidatesFor(block);
        const picked = wanted.map(key => {
            const candidate = list.find(entry => entry.key === key);
            if (!candidate) {
                throw new Error(`'${key}' is not on ${blockId}'s list — its filter leaves it out`);
            }
            return candidate;
        });
        const preselected = this.preselectionFor(block, list);
        const isPreselected =
            preselected.length === wanted.length && wanted.every(key => preselected.includes(key));
        return this.resolvePick(run, step, block, picked, autoSelected && isPreselected);
    }

    /**
     * Hand the pick to the app, bind the run to what comes back, and take the
     * block's positive branch.
     *
     * Mirrors the host in the two places it matters. The handler is optional:
     * without one the block still works, the run stays bound to the device, the
     * SKI or the joined Zigbee devices, and no appliance is created. And nothing
     * the handler does re-routes the flow — a rejection, a timeout and an empty
     * answer are all the positive outcome with no appliance, because a guide that
     * must branch on "we could not use it" needs a device test, whose verdict is
     * a routing handle.
     */
    private async resolvePick(
        run: SimRun,
        step: EnyoOnboardingV2Step,
        block: PickerBlock,
        picked: PickCandidate[],
        autoSelected: boolean
    ): Promise<PickResolution> {
        const kind = pickKindOf(block);
        const keys = picked.map(candidate => candidate.key);
        const base = {
            blockId: block.id,
            kind,
            key: keys[0],
            keys,
            label: picked.map(candidate => candidate.title).join(', '),
            autoSelected,
        };
        this.record(
            run,
            `${step.name}: ${kind} ${autoSelected ? 'auto-selected' : 'picked'} ${base.label} (${keys.join(', ')})`
        );

        const requestId = randomUUID();
        const common = {
            requestId,
            blockId: block.id,
            stepName: step.name,
            applianceId: run.context.applianceId,
            timeoutMs: PICK_TIMEOUT_MS,
            autoSelected: autoSelected || undefined,
        };
        const deviceHandler = this.app.mock.state.deviceSelectHandler;
        const eebusHandler = this.app.mock.state.eebusDeviceSelectHandler;
        const zigbeeHandler = this.app.mock.state.zigbeePairingHandler;
        // Bound to its own handler here so the requests — a network device with
        // an address, a peer with a SKI, joined Zigbee devices — stay apart,
        // which is the reason the SDK keeps them apart in the first place.
        let ask: (() => Promise<{ applianceIds?: string[]; detail?: string }>) | undefined;
        if (block.type === EnyoOnboardingV2BlockType.DeviceSelect) {
            ask = deviceHandler && (() =>
                deviceHandler({
                    ...common,
                    devices: simulatedDevicesFor(block.detectedAt).filter(device => keys.includes(device.id)),
                }));
        } else if (block.type === EnyoOnboardingV2BlockType.ZigbeePairing) {
            ask = zigbeeHandler && (() =>
                zigbeeHandler({
                    ...common,
                    devices: simulatedZigbeeDevicesFor(block.manufacturerNames, block.modelIds).filter(device =>
                        keys.includes(device.ieeeAddress)
                    ),
                }));
        } else {
            ask = eebusHandler && (() => eebusHandler({...common, peer: this.peerFor(keys[0])}));
        }

        let resolution: PickResolution;
        if (!ask) {
            resolution = {
                ...base,
                applianceIds: [],
                source: 'no-handler',
                note:
                    `The app registered no ${kind} handler, so the pick binds the run but creates ` +
                    'no appliance — the flow is unaffected.',
            };
        } else {
            try {
                const answer = await withTimeout(ask(), PICK_TIMEOUT_MS);

                resolution =
                    answer === 'timeout'
                        ? {
                              ...base,
                              applianceIds: [],
                              source: 'timeout',
                              note: `The app did not answer within ${PICK_TIMEOUT_MS} ms — the host stops waiting and continues unbound.`,
                          }
                        : {
                              ...base,
                              applianceIds: answer.applianceIds ?? [],
                              detail: answer.detail,
                              source: 'app',
                              note:
                                  (answer.applianceIds ?? []).length === 0
                                      ? 'The app made no appliance of it — a valid answer that leaves the run unbound.'
                                      : undefined,
                          };
            } catch (error) {
                resolution = {
                    ...base,
                    applianceIds: [],
                    source: 'rejected',
                    note: `The app's handler rejected: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }

        run.picks[block.id] = resolution;

        // The pick binds the run whatever the app answered: an address (or a
        // SKI, or IEEE addresses) is what later steps resolve against —
        // `device-ip` on a dynamic block, `current` on a device test.
        if (kind === 'device-select') {
            const device = simulatedDevicesFor().find(entry => entry.id === keys[0]);
            run.context.networkDeviceId = keys[0];
            run.context.deviceIp = device?.ipAddress;
            run.context.deviceName = device?.hostname;
        } else if (kind === 'zigbee-pairing') {
            run.context.zigbeeIeeeAddresses = keys;
        } else {
            run.context.eebusSki = keys[0];
        }
        if (resolution.applianceIds.length > 0) {
            // A reconnect handler answers with the id it came in with, which is
            // the point: the run stays on the appliance the customer already has.
            run.context.applianceId = resolution.applianceIds[0];
        }
        this.record(
            run,
            `${step.name}: ${kind} → ` +
                (resolution.applianceIds.length > 0
                    ? `appliance(s) ${resolution.applianceIds.join(', ')}`
                    : 'no appliance')
        );

        // The one outcome a pick can produce. Compared as a string because the
        // pickers name it in enums of their own, and a block's outcome `value`
        // is the plain string the author wrote.
        const positive: string =
            kind === 'device-select'
                ? EnyoOnboardingV2DeviceSelectOutcome.Selected
                : kind === 'zigbee-pairing'
                  ? EnyoOnboardingV2ZigbeePairOutcome.Paired
                  : EnyoOnboardingV2EebusPairOutcome.Paired;
        const outcome = block.outcomes.find(candidateOutcome => candidateOutcome.value === positive);
        if (!outcome) {
            // An authoring gap the validator warns about: the pick succeeded and
            // there is nowhere to route it. Say so rather than answering with
            // some other branch.
            resolution.note = `The block declares no '${positive}' outcome, so the run has nowhere to go from here.`;
            return resolution;
        }

        this.answer(
            run.id,
            {kind: EnyoOnboardingV2TransitionSourceKind.Outcome, blockId: block.id, outcomeId: outcome.id},
            positive
        );
        return resolution;
    }

    /** The peer behind a SKI, as the host knew it at pairing time. */
    private peerFor(ski: string): EnyoOnboardingV2EebusPeer {
        const peer = simulatedEebusPeersFor().find(candidate => candidate.ski === ski);
        if (!peer) {
            throw new Error(`No simulated EEBUS peer with SKI ${ski}`);
        }
        return peer;
    }

    /**
     * Forget the picks of every step walked after `stepName`.
     *
     * The counterpart of `clearAnswersAfter`: a step the flow returns to is
     * re-asked, so the picker ahead of it must be re-offered — and re-skipped,
     * when a single candidate matches — rather than showing what a previous walk
     * came away with.
     */
    private forgetPicksAfter(guide: EnyoOnboardingV2Guide, run: SimRun, stepName: string): void {
        const {visited} = simulate(guide, run.answers);
        const index = visited.indexOf(stepName);
        if (index < 0) {
            return;
        }
        for (const name of visited.slice(index + 1)) {
            for (const block of stepByName(guide, name)?.blocks ?? []) {
                delete run.picks[block.id];
                delete run.progress[block.id];
                delete run.inputErrors[block.id];
            }
        }
    }

    /** The run as the browser sees it, with the current step already resolved. */
    async view(runId: string): Promise<RunView> {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const walk = simulate(guide, run.answers);
        const step = stepByName(guide, walk.currentStepName);

        if (step && walk.status === 'await') {
            await this.resolveDynamicBlocks(run, step);
        }

        const handoffVariant =
            walk.terminal?.type === EnyoOnboardingV2TargetType.StartVariant ? walk.terminal.variant : undefined;
        const decision = step ? decisionBlock(step) : undefined;
        const suggested =
            decision && 'outcomes' in decision && Array.isArray(decision.outcomes)
                ? defaultOutcomeId(decision.outcomes as { id: string; value: string }[])
                : undefined;

        const isTerminal = walk.status === 'terminal';
        const canGoBack = decidedAnswerKeys(guide, run.answers).length > 0;
        const renderModel = buildRenderModel({
            guide,
            step,
            visited: walk.visited,
            isTerminal,
            terminal: walk.terminal,
            canGoBack,
            inputs: run.inputs,
            setupMessages: Object.fromEntries(
                Object.values(run.setups).map(setup => [setup.blockId, setup.message])
            ),
            dynamicValues: Object.fromEntries(
                Object.values(run.dynamic).map(resolution => [resolution.blockId, resolution.value])
            ),
            fileUrl: name =>
                this.app.files.some(file => file.name === name) ? `/api/files/${encodeURIComponent(name)}` : undefined,
            consents: this.app.consents,
            consentStates: this.app.mock.state.consentStates,
            inputErrors: run.inputErrors,
            subscriptionOffer: this.app.definition,
        });

        return {
            runId: run.id,
            guide: this.summaryAt(run.guideIndex),
            context: run.context,
            status: walk.status,
            step: walk.status === 'terminal' ? undefined : step,
            decisionBlockId: walk.status === 'terminal' ? undefined : decision?.id,
            suggestedHandleId: suggested,
            terminal: walk.terminal,
            // The static guide never hands off to a runtime guide.
            handoffGuideIndex: handoffVariant && run.guideIndex !== PACKAGE_GUIDE_INDEX
                ? this.app.guides.findIndex(candidate => candidate.startVariant === handoffVariant)
                : undefined,
            visited: walk.visited,
            stepsRemaining: step ? stepsToTerminal(guide, step.name) : 0,
            canGoBack,
            inputs: run.inputs,
            dynamic: run.dynamic,
            setups: run.setups,
            pickers: step && walk.status !== 'terminal' ? this.pickerViews(run, step) : {},
            progress: run.progress,
            consentStates: this.app.mock.state.consentStates.map(state => ({...state})),
            subscriptions: run.subscriptions,
            events: run.events,
            renderModel,
        };
    }

    private guideOf(run: SimRun): EnyoOnboardingV2Guide {
        const guide = this.guideAt(run.guideIndex);
        if (!guide) {
            throw new Error(`The guide of run ${run.id} is gone — the app was reloaded`);
        }
        return guide;
    }

    private record(run: SimRun, message: string): void {
        run.events.push({at: Date.now() - this.startedAt, message});
    }
}

/** Re-exported so the server can type its log stream without reaching into the loader. */
export type {AppLogLine};
