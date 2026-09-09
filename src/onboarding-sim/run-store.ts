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
    ENYO_ONBOARDING_V2_SETUP_FAILED_OUTCOME,
    EnyoOnboardingV2BlockType,
    EnyoOnboardingV2DeviceSelectOutcome,
    EnyoOnboardingV2DynamicKind,
    EnyoOnboardingV2EebusPairOutcome,
    EnyoOnboardingV2StartVariant,
    EnyoOnboardingV2TargetType,
    EnyoOnboardingV2TransitionSourceKind,
} from '@enyo-energy/energy-app-sdk';
import type {
    EnyoOnboardingV2AdditionalSetupBlock,
    EnyoOnboardingV2DeviceSelectBlock,
    EnyoOnboardingV2EebusDeviceSelectBlock,
    EnyoOnboardingV2EebusPeer,
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2SetupFieldValue,
    EnyoOnboardingV2Step,
    EnyoOnboardingV2Target,
    EnyoOnboardingV2TransitionSource,
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
import {
    SIMULATED_NETWORK_DEVICE,
    simulatedDevicesFor,
    simulatedEebusPeersFor,
    simulatedOcppUrl,
} from './simulated-world.js';

/**
 * The budget the host gives an app to fill a dynamic block, matching the
 * runtime: an installer is looking at the screen this fills.
 */
const DYNAMIC_TIMEOUT_MS = 5_000;
/**
 * The budget for one additional setup, matching
 * `additional-setup.runner.ts` — generous, because the app may be calling a
 * vendor portal, but running out is a `failed` verdict like any other.
 */
const SETUP_TIMEOUT_MS = 45_000;
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
}

/** Which of the two pickers a resolution belongs to. */
export type PickKind = 'device-select' | 'eebus-device-select';

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
    /** The device id or SKI the run is now bound to. */
    key: string;
    /** The candidate's title, for the event log and the badge. */
    label: string;
    /**
     * `true` when the host picked on the installer's behalf because exactly one
     * candidate matched and the block left `autoSelectSingleMatch` on — on a
     * device the screen is never rendered.
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
     * `true` when this screen would not be rendered on a device: one candidate
     * matched and the block left `autoSelectSingleMatch` on. The simulator
     * renders it anyway once the installer walks back onto it, so the pick can
     * be changed — which is the one place the preview knowingly shows a screen a
     * device would not.
     */
    wouldSkip: boolean;
    resolution?: PickResolution;
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
    events: { at: number; message: string }[];
}

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

/** Whether a block is one of the two pickers — the blocks that own their step. */
const isPickerBlock = (
    block: {type: EnyoOnboardingV2BlockType}
): block is EnyoOnboardingV2DeviceSelectBlock | EnyoOnboardingV2EebusDeviceSelectBlock =>
    block.type === EnyoOnboardingV2BlockType.DeviceSelect ||
    block.type === EnyoOnboardingV2BlockType.EebusDeviceSelect;

const pickKindOf = (block: {type: EnyoOnboardingV2BlockType}): PickKind =>
    block.type === EnyoOnboardingV2BlockType.DeviceSelect ? 'device-select' : 'eebus-device-select';

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

export class RunStore {
    private readonly runs = new Map<string, SimRun>();
    private readonly startedAt = Date.now();

    constructor(private app: LoadedApp) {}

    /** Point the store at a freshly pulled guide set; open runs are dropped with it. */
    replaceApp(app: LoadedApp): void {
        this.app = app;
        this.runs.clear();
    }

    get loadedApp(): LoadedApp {
        return this.app;
    }

    guideAt(index: number): EnyoOnboardingV2Guide | undefined {
        return this.app.guides[index];
    }

    /** Every guide the app ships, described for the library screen. */
    summaries(): GuideSummary[] {
        return this.app.guides.map((guide, index) => ({
            index,
            name: guide.name ?? `guide-${index + 1}`,
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
            validation: this.app.validation.guides[index],
        }));
    }

    createRun(guideIndex: number, context?: Partial<RunContext>): SimRun {
        const guide = this.app.guides[guideIndex];
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
     * Run an `additional-setup` block: hand the collected fields to the app and
     * turn its verdict into the outcome the guide branches on.
     *
     * Mirrors `additional-setup.runner.ts`: the app's `outcome` string is matched
     * against the block's declared outcome *values*, and everything else — no
     * handler, a rejection, a timeout, an undeclared outcome — falls back to the
     * reserved `failed` branch. The installer always gets a branch.
     *
     * The collected values may be credentials, so nothing here logs one: only the
     * setup key, the field names and the resulting outcome.
     */
    async runAdditionalSetup(
        runId: string,
        blockId: string,
        values: EnyoOnboardingV2SetupFieldValue[]
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
        const handler = this.app.mock.state.additionalSetupHandler;
        const fieldNames = values.map(value => value.name).join(', ');
        this.record(run, `${step.name}: setup '${setupBlock.setupKey}' with fields [${fieldNames}]`);

        const failed = (note: string, extra: Partial<SetupResolution> = {}): SetupResolution => ({
            blockId,
            setupKey: setupBlock.setupKey,
            outcomeId:
                setupBlock.outcomes.find(outcome => outcome.value === ENYO_ONBOARDING_V2_SETUP_FAILED_OUTCOME)?.id ?? '',
            fellBackToFailed: true,
            note,
            ...extra,
        });

        let resolution: SetupResolution;
        if (!handler) {
            resolution = failed('The app registered no additional-setup handler, so every setup block fails.');
        } else {
            const requestId = randomUUID();
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
                        timeoutMs: SETUP_TIMEOUT_MS,
                    }),
                    SETUP_TIMEOUT_MS
                );

                if (answer === 'timeout') {
                    resolution = failed(`The app did not answer within ${SETUP_TIMEOUT_MS} ms.`);
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
     * scan turned up and an `eebus-device-select` sees what announced itself over
     * SHIP. The filter only narrows it, which is why a filter that matches
     * nothing leaves an empty screen rather than the unfiltered list.
     */
    candidatesFor(block: EnyoOnboardingV2DeviceSelectBlock | EnyoOnboardingV2EebusDeviceSelectBlock): PickCandidate[] {
        if (block.type === EnyoOnboardingV2BlockType.DeviceSelect) {
            return simulatedDevicesFor(block.detectedAt).map(device => ({
                key: device.id,
                title: device.hostname,
                subtitle: device.ipAddress,
                badges: device.detectedAt ?? [],
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

    /** The picker blocks of a step, with their lists and whatever came of them. */
    private pickerViews(run: SimRun, step: EnyoOnboardingV2Step): Record<string, PickerView> {
        const views: Record<string, PickerView> = {};
        for (const block of step.blocks) {
            if (!isPickerBlock(block)) {
                continue;
            }
            const candidates = this.candidatesFor(block);
            views[block.id] = {
                blockId: block.id,
                kind: pickKindOf(block),
                candidates,
                wouldSkip: candidates.length === 1 && block.autoSelectSingleMatch !== false,
                resolution: run.picks[block.id],
            };
        }
        return views;
    }

    /**
     * Skip the screen when exactly one candidate matches, the way the host does.
     *
     * Everything else still happens — the handler is called, the run is bound,
     * the positive outcome is fired — because skipping is a rendering decision
     * and not a semantic one. Nothing is skipped with **no** match: the step
     * renders its empty list and the installer leaves through `not-found`, which
     * is the branch that explains why.
     *
     * Once a pick is recorded it is never re-made, so walking back onto an
     * auto-selected picker shows the screen instead of bouncing the installer
     * forward again.
     *
     * @returns `true` when the walk moved on, so the caller re-simulates.
     */
    private async autoSelectPicker(run: SimRun, step: EnyoOnboardingV2Step): Promise<boolean> {
        const decision = decisionBlock(step);
        if (!decision || !isPickerBlock(decision) || run.picks[decision.id] || run.answers[decision.id]) {
            return false;
        }
        if (decision.autoSelectSingleMatch === false) {
            return false;
        }
        const candidates = this.candidatesFor(decision);
        if (candidates.length !== 1) {
            return false;
        }

        await this.resolvePick(run, step, decision, candidates[0], true);
        return Boolean(run.answers[decision.id]);
    }

    /**
     * Record the installer's pick on the current step's picker block.
     *
     * The positive branch only: a run that came away with nothing takes
     * `not-found` (or, for a handshake that did not come up, `failure`), and
     * those are ordinary outcome answers with no handler behind them.
     */
    async pick(runId: string, blockId: string, key: string): Promise<PickResolution> {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        const walk = simulate(guide, run.answers);
        const step = stepByName(guide, walk.currentStepName);
        const block = step?.blocks.find(candidate => candidate.id === blockId);
        if (!step || !block || !isPickerBlock(block)) {
            throw new Error(`Block ${blockId} is not a picker block on the current step`);
        }

        const candidate = this.candidatesFor(block).find(entry => entry.key === key);
        if (!candidate) {
            throw new Error(`'${key}' is not on ${blockId}'s list — its filter leaves it out`);
        }
        return this.resolvePick(run, step, block, candidate, false);
    }

    /**
     * Hand the pick to the app, bind the run to what comes back, and take the
     * block's positive branch.
     *
     * Mirrors the host in the two places it matters. The handler is optional:
     * without one the block still works, the run stays bound to the device or the
     * SKI, and no appliance is created. And nothing the handler does re-routes
     * the flow — a rejection, a timeout and an empty answer are all the positive
     * outcome with no appliance, because a guide that must branch on "we could
     * not use it" needs a device test, whose verdict is a routing handle.
     */
    private async resolvePick(
        run: SimRun,
        step: EnyoOnboardingV2Step,
        block: EnyoOnboardingV2DeviceSelectBlock | EnyoOnboardingV2EebusDeviceSelectBlock,
        candidate: PickCandidate,
        autoSelected: boolean
    ): Promise<PickResolution> {
        const kind = pickKindOf(block);
        const base = {blockId: block.id, kind, key: candidate.key, label: candidate.title, autoSelected};
        this.record(
            run,
            `${step.name}: ${kind} ${autoSelected ? 'auto-selected' : 'picked'} ${candidate.title} (${candidate.key})`
        );

        const requestId = randomUUID();
        const deviceHandler = this.app.mock.state.deviceSelectHandler;
        const eebusHandler = this.app.mock.state.eebusDeviceSelectHandler;
        // Bound to its own handler here so the two requests — a network device
        // with an address, a peer with a SKI — stay apart, which is the reason
        // the SDK keeps them apart in the first place.
        const ask =
            block.type === EnyoOnboardingV2BlockType.DeviceSelect
                ? deviceHandler &&
                  (() =>
                      deviceHandler({
                          requestId,
                          blockId: block.id,
                          stepName: step.name,
                          devices: simulatedDevicesFor(block.detectedAt).filter(
                              device => device.id === candidate.key
                          ),
                          applianceId: run.context.applianceId,
                          timeoutMs: PICK_TIMEOUT_MS,
                          autoSelected: autoSelected || undefined,
                      }))
                : eebusHandler &&
                  (() =>
                      eebusHandler({
                          requestId,
                          blockId: block.id,
                          stepName: step.name,
                          peer: this.peerFor(candidate.key),
                          applianceId: run.context.applianceId,
                          timeoutMs: PICK_TIMEOUT_MS,
                          autoSelected: autoSelected || undefined,
                      }));

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
        // SKI) is what later steps resolve against — `device-ip` on a dynamic
        // block, `current` on a device test.
        if (kind === 'device-select') {
            const device = simulatedDevicesFor().find(entry => entry.id === candidate.key);
            run.context.networkDeviceId = candidate.key;
            run.context.deviceIp = device?.ipAddress;
            run.context.deviceName = device?.hostname;
        } else {
            run.context.eebusSki = candidate.key;
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
        // two pickers name it in enums of their own, and a block's outcome
        // `value` is the plain string the author wrote.
        const positive: string =
            kind === 'device-select'
                ? EnyoOnboardingV2DeviceSelectOutcome.Selected
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
            }
        }
    }

    /** The run as the browser sees it, with the current step already resolved. */
    async view(runId: string): Promise<RunView> {
        const run = this.run(runId);
        const guide = this.guideOf(run);
        let walk = simulate(guide, run.answers);
        let step = stepByName(guide, walk.currentStepName);

        // A skipped picker can land on another picker that skips too, so this
        // runs until the walk settles. It terminates because a pick is recorded
        // before the walk moves on, and a recorded pick never fires again.
        while (step && walk.status === 'await' && (await this.autoSelectPicker(run, step))) {
            walk = simulate(guide, run.answers);
            step = stepByName(guide, walk.currentStepName);
        }

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

        return {
            runId: run.id,
            guide: this.summaries()[run.guideIndex],
            context: run.context,
            status: walk.status,
            step: walk.status === 'terminal' ? undefined : step,
            decisionBlockId: walk.status === 'terminal' ? undefined : decision?.id,
            suggestedHandleId: suggested,
            terminal: walk.terminal,
            handoffGuideIndex: handoffVariant
                ? this.app.guides.findIndex(candidate => candidate.startVariant === handoffVariant)
                : undefined,
            visited: walk.visited,
            stepsRemaining: step ? stepsToTerminal(guide, step.name) : 0,
            canGoBack: decidedAnswerKeys(guide, run.answers).length > 0,
            inputs: run.inputs,
            dynamic: run.dynamic,
            setups: run.setups,
            pickers: step && walk.status !== 'terminal' ? this.pickerViews(run, step) : {},
            events: run.events,
        };
    }

    private guideOf(run: SimRun): EnyoOnboardingV2Guide {
        const guide = this.app.guides[run.guideIndex];
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
