/**
 * The step as the enyo app is handed it: content blocks, one input spec for the
 * footer, and the run's progress.
 *
 * Ported from `render-model.builder.ts` (connect-core api, onboarding-runtime),
 * together with the two places it reshapes a v2 guide on the way in —
 * `v2-guide.mapper.ts` (an `auth` block's label/help become provider/description)
 * and `picker-blocks.ts` (both picker shapes become one `picker` input). The app
 * renders only this, so the simulator's preview renders only this too: whatever
 * the builder hides from the installer, the preview hides as well.
 *
 * What the host would resolve against the hub — an auth status, a published
 * file's CDN url, a dynamic value — comes from the simulated run instead.
 */
import {EnyoOnboardingV2BlockType, EnyoOnboardingV2DynamicKind} from '@enyo-energy/energy-app-sdk';
import type {
    EnergyAppPackageConsent,
    EnergyAppPackageDefinition,
    EnyoConsentState,
    EnyoOnboardingV2Block,
    EnyoOnboardingV2Guide,
    EnyoOnboardingV2Step,
    EnyoOnboardingV2Target,
} from '@enyo-energy/energy-app-sdk';
import {decisionBlock, stepsToTerminal} from './flow-walker.js';

/** Author-facing text: a translated array from an app, or a host default. */
export type RenderText = { language: string; value: string }[] | string;

export interface RenderOutcome {
    id: string;
    value: string;
    label?: RenderText;
}

/** A block as the app receives it — the authored block plus what the host resolved. */
export type RenderBlock = Record<string, unknown> & { id: string; type: string };

export const ACTION_KINDS = [
    'network-scan',
    'connection-check',
    'ocpp-connect',
    'device-test',
    'eebus-pair',
    'device-select',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type PickerKind = 'device-select' | 'eebus-device-select' | 'zigbee-pairing';

/**
 * One checkbox of a consent block (or of an additional setup's `consentKeys`):
 * the declaration the key resolves to, merged with the answer enyo holds.
 */
export interface ConsentRow {
    consentKey: string;
    /** False when the package declares no consent with this key — the host cannot render it. */
    declared: boolean;
    version?: string;
    required: boolean;
    grantableBy: string[];
    label?: RenderText;
    summary?: RenderText;
    title?: RenderText;
    legalText?: EnergyAppPackageConsent['legalText'];
    /** In force for the declared version — such a row starts ticked. */
    granted: boolean;
    grantedBy?: string;
}

/** The parts of a package definition a subscription-offer step renders. */
export type SubscriptionOfferSource = Pick<
    EnergyAppPackageDefinition,
    'subscriptionPlans' | 'subscriptionMode' | 'subscriptionFreeTier' | 'subscriptionOfferScreen' | 'subscriptionFeatures'
>;

export interface SetupFieldSpec {
    name: string;
    type: string;
    label?: RenderText;
    placeholder?: RenderText;
    help?: RenderText;
    required: boolean;
    options?: { value: string; label: RenderText }[];
}

export type InputSpec =
    | { kind: 'terminal' }
    | { kind: 'continue' }
    | {
          kind: 'choice';
          blockId: string;
          prompt?: RenderText;
          layout: 'buttons' | 'list';
          options: { id: string; label: RenderText; description?: RenderText }[];
      }
    | {
          kind: 'action';
          blockId: string;
          action: ActionKind;
          deviceSelection?: string;
          label: RenderText;
          outcomes: RenderOutcome[];
      }
    | {
          kind: 'input';
          blockId: string;
          valueType: string;
          label: RenderText;
          placeholder?: RenderText;
          help?: RenderText;
          submitLabel: RenderText;
          value?: string;
          validationError?: RenderText;
          /** The typed value goes to the app's input validation handler first. */
          validated: boolean;
          outcomes: RenderOutcome[];
      }
    | {
          kind: 'auth';
          blockId: string;
          provider: RenderText;
          description?: RenderText;
          successOutcomeId: string;
          authenticated: boolean;
          requiresWebAuthentication: boolean;
          redirectUrlFilter?: unknown;
      }
    | {
          kind: 'additional-setup';
          blockId: string;
          setupKey: string;
          cta: RenderText;
          description: RenderText;
          fields: SetupFieldSpec[];
          outcomes: RenderOutcome[];
          skip?: { id: string; label: RenderText };
          message?: RenderText;
          /** Checkboxes above the CTA; the CTA stays disabled until every required one is ticked. */
          consents: ConsentRow[];
          progressPhases?: { key: string; label: RenderText }[];
          maxDurationMs?: number;
      }
    | {
          kind: 'consent';
          blockId: string;
          cta: RenderText;
          consents: ConsentRow[];
          outcomes: RenderOutcome[];
      }
    | {
          kind: 'subscription-offer';
          blockId: string;
          /** `block.mode`, else the package's `subscriptionMode`. */
          mode?: string;
          /** The offered plans, in declaration order — all of them when `planKeys` is omitted. */
          plans: NonNullable<EnergyAppPackageDefinition['subscriptionPlans']>;
          /** Plan keys the block names that the package does not declare. */
          unknownPlanKeys: string[];
          freeTier?: EnergyAppPackageDefinition['subscriptionFreeTier'];
          offerScreen?: EnergyAppPackageDefinition['subscriptionOfferScreen'];
          features?: EnergyAppPackageDefinition['subscriptionFeatures'];
          outcomes: RenderOutcome[];
      }
    | {
          kind: 'picker';
          blockId: string;
          picker: PickerKind;
          headline?: RenderText;
          description?: RenderText;
          label?: RenderText;
          autoSelectSingleMatch: boolean;
          detectedAt?: string[];
          deviceTypes?: string[];
          vendors?: string[];
          manufacturerNames?: string[];
          modelIds?: string[];
          /** How many entries may be confirmed at once — above 1 only on a Zigbee pairing. */
          maxDevices: number;
          /** How long a Zigbee pairing keeps the network open, in seconds. */
          durationSeconds?: number;
          outcomes: RenderOutcome[];
      };

export interface RenderModel {
    step: { name: string; title: RenderText; blocks: RenderBlock[] } | null;
    input: InputSpec;
    progress: { position: number; visited: string[]; total: number };
    canGoBack: boolean;
    isTerminal: boolean;
    terminal?: EnyoOnboardingV2Target;
}

/** What the simulated run knows that the host would know on a device. */
export interface RenderModelSource {
    guide: EnyoOnboardingV2Guide;
    /** The awaiting step, or `undefined` once the walk has ended. */
    step?: EnyoOnboardingV2Step;
    visited: string[];
    isTerminal: boolean;
    terminal?: EnyoOnboardingV2Target;
    canGoBack: boolean;
    /** Values typed into input and select blocks, by block id. */
    inputs: Record<string, string>;
    /** The app's line about a block's previous setup attempt, by block id. */
    setupMessages: Record<string, RenderText | undefined>;
    /** What each dynamic block resolved to, by block id (`null` = nothing). */
    dynamicValues: Record<string, string | null | undefined>;
    /** The url a declared public file is served at, or `undefined` when undeclared. */
    fileUrl: (name: string) => string | undefined;
    /** The consents the package declares. */
    consents?: EnergyAppPackageConsent[];
    /** What enyo holds for each declared consent. */
    consentStates?: EnyoConsentState[];
    /** The app's rejection of a value typed into a validated input, by block id. */
    inputErrors?: Record<string, RenderText | undefined>;
    /** The package's plans and offer, for a subscription-offer step. */
    subscriptionOffer?: SubscriptionOfferSource;
}

/** Resolve consent keys against the declaration and the recorded answers, in the block's order. */
export const consentRowsOf = (
    keys: unknown,
    consents: EnergyAppPackageConsent[] = [],
    states: EnyoConsentState[] = []
): ConsentRow[] =>
    (Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []).map(consentKey => {
        const declared = consents.find(consent => consent.consentKey === consentKey);
        const answer = states.find(state => state.consentKey === consentKey);
        if (!declared) {
            return {consentKey, declared: false, required: false, grantableBy: [], granted: false};
        }
        return {
            consentKey,
            declared: true,
            version: declared.version,
            required: declared.required,
            grantableBy: [...declared.grantableBy],
            label: declared.label,
            summary: declared.summary,
            title: declared.title,
            legalText: declared.legalText,
            // An answer for another version no longer counts.
            granted: answer?.granted === true && answer.version === declared.version,
            grantedBy: answer?.grantedBy,
        };
    });

// Mirrors the frontend DYNAMIC_KIND_META placeholders, as the builder does.
const DYNAMIC_PLACEHOLDER: Record<string, string> = {
    [EnyoOnboardingV2DynamicKind.OcppUrl]: 'wird zur Laufzeit gesetzt (OCPP-/CSMS-URL)',
    [EnyoOnboardingV2DynamicKind.DeviceIp]: 'wird zur Laufzeit gesetzt (IP-Adresse / Link)',
};

const toActionKind = (value: unknown): ActionKind =>
    ACTION_KINDS.includes(value as ActionKind) ? (value as ActionKind) : 'network-scan';

const toChoiceLayout = (value: unknown): 'buttons' | 'list' => (value === 'list' ? 'list' : 'buttons');

const toInputValueType = (value: unknown): string =>
    ['text', 'ip-address', 'number', 'password'].includes(value as string) ? (value as string) : 'text';

const asStringArray = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.length > 0 && value.every(entry => typeof entry === 'string')
        ? value
        : undefined;

const outcomesOf = (block: Record<string, unknown>): RenderOutcome[] =>
    ((block.outcomes as RenderOutcome[] | undefined) ?? []).map(outcome => ({
        id: outcome.id,
        value: outcome.value,
        label: outcome.label,
    }));

/** Both picker shapes — the block types, and the legacy `action` kinds — as one. */
const LEGACY_PICKER: Record<string, PickerKind> = {
    'device-select': 'device-select',
    'eebus-pair': 'eebus-device-select',
};

const pickerSpec = (block: Record<string, unknown> & { id: string; type: string }): InputSpec | undefined => {
    const legacyKind = block.type === 'action' ? LEGACY_PICKER[block.action as string] : undefined;
    const kind: PickerKind | undefined =
        block.type === 'device-select'
            ? 'device-select'
            : block.type === 'eebus-device-select'
              ? 'eebus-device-select'
              : block.type === 'zigbee-pairing'
                ? 'zigbee-pairing'
                : legacyKind;
    if (!kind) {
        return undefined;
    }
    const legacy = legacyKind !== undefined;
    return {
        kind: 'picker',
        blockId: block.id,
        picker: kind,
        headline: legacy ? undefined : (block.headline as RenderText | undefined),
        description: legacy ? undefined : (block.description as RenderText | undefined),
        label: block.label as RenderText | undefined,
        autoSelectSingleMatch:
            typeof block.autoSelectSingleMatch === 'boolean'
                ? block.autoSelectSingleMatch
                : legacy
                  ? kind === 'device-select'
                  : true,
        detectedAt: asStringArray(block.detectedAt),
        deviceTypes: asStringArray(block.deviceTypes),
        vendors: asStringArray(block.vendors),
        manufacturerNames: asStringArray(block.manufacturerNames),
        modelIds: asStringArray(block.modelIds),
        maxDevices:
            kind === 'zigbee-pairing' && typeof block.maxDevices === 'number' && block.maxDevices >= 1
                ? Math.floor(block.maxDevices)
                : 1,
        durationSeconds:
            kind === 'zigbee-pairing'
                ? typeof block.durationSeconds === 'number' ? block.durationSeconds : 180
                : undefined,
        outcomes: outcomesOf(block),
    };
};

/**
 * Where an auth login has to run in a browser: `redirectUrlFilter.webOnly` wins
 * where both are set, the deprecated flag still counts on its own.
 */
const resolveWebOnly = (block: Record<string, unknown>): boolean => {
    const filter = block.redirectUrlFilter as { webOnly?: boolean } | undefined;
    if (filter?.webOnly !== undefined) {
        return filter.webOnly === true;
    }
    return block.requiresWebAuthentication === true;
};

export const inputSpecOf = (source: RenderModelSource): InputSpec => {
    if (source.isTerminal || !source.step) {
        return {kind: 'terminal'};
    }
    const found = decisionBlock(source.step);
    if (!found) {
        return {kind: 'continue'};
    }
    const decision = found as unknown as Record<string, unknown> & { id: string; type: string };

    if (decision.type === 'auth') {
        const outcome = decision.outcome as { id: string } | undefined;
        return {
            kind: 'auth',
            blockId: decision.id,
            provider: (decision.label as RenderText | undefined) ?? '',
            description: decision.help as RenderText | undefined,
            successOutcomeId: outcome?.id ?? '',
            // There is no account behind the simulator: the login is never
            // confirmed, so the installer always confirms it by hand.
            authenticated: false,
            requiresWebAuthentication: resolveWebOnly(decision),
            redirectUrlFilter: decision.redirectUrlFilter,
        };
    }
    if (decision.type === 'additional-setup') {
        const fields = ((decision.fields as Record<string, unknown>[] | undefined) ?? []).map(
            // The SDK defaults `required` to true; the app should not have to know.
            field => ({...field, required: field.required !== false}) as SetupFieldSpec
        );
        return {
            kind: 'additional-setup',
            blockId: decision.id,
            setupKey: (decision.setupKey as string | undefined) ?? decision.id,
            cta: (decision.cta as RenderText | undefined) ?? 'Einrichten',
            description: (decision.description as RenderText | undefined) ?? '',
            fields,
            outcomes: outcomesOf(decision),
            skip: decision.skip as { id: string; label: RenderText } | undefined,
            message: source.setupMessages[decision.id],
            consents: consentRowsOf(decision.consentKeys, source.consents, source.consentStates),
            progressPhases: decision.progressPhases as { key: string; label: RenderText }[] | undefined,
            maxDurationMs: typeof decision.maxDurationMs === 'number' ? decision.maxDurationMs : undefined,
        };
    }
    if (decision.type === 'consent') {
        return {
            kind: 'consent',
            blockId: decision.id,
            cta: (decision.cta as RenderText | undefined) ?? 'Zustimmen und weiter',
            consents: consentRowsOf(decision.consentKeys, source.consents, source.consentStates),
            outcomes: outcomesOf(decision),
        };
    }
    if (decision.type === 'subscription-offer') {
        const declared = source.subscriptionOffer?.subscriptionPlans ?? [];
        const planKeys = asStringArray(decision.planKeys);
        return {
            kind: 'subscription-offer',
            blockId: decision.id,
            mode: (decision.mode as string | undefined) ?? source.subscriptionOffer?.subscriptionMode,
            plans: planKeys ? declared.filter(plan => planKeys.includes(plan.planKey)) : declared,
            unknownPlanKeys: (planKeys ?? []).filter(key => !declared.some(plan => plan.planKey === key)),
            freeTier: source.subscriptionOffer?.subscriptionFreeTier,
            offerScreen: source.subscriptionOffer?.subscriptionOfferScreen,
            features: source.subscriptionOffer?.subscriptionFeatures,
            outcomes: outcomesOf(decision),
        };
    }
    if (decision.type === 'input') {
        const valueType = toInputValueType(decision.valueType);
        return {
            kind: 'input',
            blockId: decision.id,
            valueType,
            label: (decision.label as RenderText | undefined) ?? '',
            placeholder: decision.placeholder as RenderText | undefined,
            help: decision.help as RenderText | undefined,
            submitLabel: (decision.submitLabel as RenderText | undefined) ?? 'Prüfen',
            // A masked value is re-asked, never rendered back.
            value: valueType === 'password' ? undefined : source.inputs[decision.id],
            validationError: source.inputErrors?.[decision.id],
            validated: decision.validated === true,
            outcomes: outcomesOf(decision),
        };
    }
    const picker = pickerSpec(decision);
    if (picker) {
        return picker;
    }
    if (decision.type === 'choice') {
        const options =
            (decision.options as { id: string; label: RenderText; description?: RenderText }[] | undefined) ?? [];
        return {
            kind: 'choice',
            blockId: decision.id,
            prompt: decision.prompt as RenderText | undefined,
            layout: toChoiceLayout(decision.layout),
            options: options.map(option => ({id: option.id, label: option.label, description: option.description})),
        };
    }
    return {
        kind: 'action',
        blockId: decision.id,
        action: toActionKind(decision.action),
        deviceSelection: decision.deviceSelection as string | undefined,
        label: (decision.label as RenderText | undefined) ?? '',
        outcomes: outcomesOf(decision),
    };
};

/**
 * Content blocks pass through; image, select and dynamic blocks carry what the
 * host resolved for them, exactly as the builder hands them on.
 */
const renderBlock = (block: EnyoOnboardingV2Block, source: RenderModelSource): RenderBlock => {
    const raw = block as unknown as RenderBlock;
    if (block.type === EnyoOnboardingV2BlockType.Image && typeof raw.file === 'string') {
        // An undeclared file renders its caption alone, never a broken image.
        return {...raw, url: source.fileUrl(raw.file)};
    }
    if (block.type === EnyoOnboardingV2BlockType.Select) {
        return {...raw, value: source.inputs[block.id]};
    }
    if (block.type === EnyoOnboardingV2BlockType.Dynamic) {
        const value = source.dynamicValues[block.id];
        return {
            ...raw,
            resolved: value !== null && value !== undefined,
            value: value ?? undefined,
            placeholder: DYNAMIC_PLACEHOLDER[block.kind] ?? '',
        };
    }
    return {...raw};
};

export const buildRenderModel = (source: RenderModelSource): RenderModel => {
    const step = source.isTerminal ? undefined : source.step;
    const visited = source.visited;
    return {
        step: step ? {name: step.name, title: step.title, blocks: step.blocks.map(block => renderBlock(block, source))} : null,
        input: inputSpecOf({...source, step}),
        // Walked so far plus the shortest way still ahead, as on a device: a
        // guide that branches long says so, and a finished run is finished.
        progress: {
            position: visited.length,
            visited,
            total: step ? visited.length + stepsToTerminal(source.guide, step.name) - 1 : visited.length,
        },
        canGoBack: source.canGoBack,
        isTerminal: source.isTerminal,
        terminal: source.terminal,
    };
};
