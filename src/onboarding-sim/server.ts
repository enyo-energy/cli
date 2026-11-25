/**
 * The simulator's local web server: the guide library, one endpoint per thing an
 * installer can do to a step, and a live stream of everything the app said or
 * asked the SDK for.
 *
 * It holds no database and no auth — it is a preview of an app you are building,
 * bound to localhost, and it goes away when the CLI does.
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import type {Express, Request, Response} from 'express';
import {EnyoConsentGrantorEnum, EnyoOnboardingV2TransitionSourceKind} from '@enyo-energy/energy-app-sdk';
import type {
    EnyoOnboardingV2SetupFieldValue,
    EnyoOnboardingV2TransitionSource,
} from '@enyo-energy/energy-app-sdk';
import {getTemplate} from '../constants/templates.js';
import type {LoadedApp} from './app-loader.js';
import {RunStore, START_VARIANTS, defaultContextFor, type RunContext} from './run-store.js';

/** One line in the live log panel. */
export interface SimLogEvent {
    at: number;
    kind: 'sdk' | 'app' | 'sim';
    level?: string;
    message: string;
    detail?: unknown;
}

/** Kept so a browser opened after the app booted still sees the boot log. */
const LOG_BUFFER_LIMIT = 2_000;

export class SimulatorLog {
    private readonly events: SimLogEvent[] = [];
    private readonly clients = new Set<Response>();
    private readonly startedAt = Date.now();

    /** Milliseconds since the simulator started, for events of its own. */
    elapsed(): number {
        return Date.now() - this.startedAt;
    }

    push(event: SimLogEvent): void {
        this.events.push(event);
        if (this.events.length > LOG_BUFFER_LIMIT) {
            this.events.shift();
        }
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of this.clients) {
            client.write(payload);
        }
    }

    subscribe(response: Response): () => void {
        for (const event of this.events) {
            response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        this.clients.add(response);
        return () => this.clients.delete(response);
    }
}

export interface SimulatorServerOptions {
    app: LoadedApp;
    log: SimulatorLog;
    /** Re-run the app and pull its guides again — the "reload" button. */
    reload: () => Promise<LoadedApp>;
}

const asError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The role the browser acts in; anything else is the installer, who walks the guide on a device. */
const asRole = (value: unknown): EnyoConsentGrantorEnum =>
    value === EnyoConsentGrantorEnum.Customer ? EnyoConsentGrantorEnum.Customer : EnyoConsentGrantorEnum.Installer;

const asAnswers = (value: unknown): Record<string, boolean> =>
    value && typeof value === 'object'
        ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                  (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
              )
          )
        : {};

export const createSimulatorServer = (options: SimulatorServerOptions): Express => {
    const store = new RunStore(options.app, (message, level) =>
        options.log.push({at: options.log.elapsed(), kind: 'sim', level, message})
    );
    const server = express();
    server.use(express.json({limit: '1mb'}));

    const handle = (fn: (request: Request, response: Response) => Promise<void> | void) =>
        (request: Request, response: Response): void => {
            // Inside `then`, so a handler that throws synchronously is answered as JSON too.
            Promise.resolve()
                .then(() => fn(request, response))
                .catch((error: unknown) => {
                    response.status(400).json({error: asError(error)});
                });
        };

    server.get('/', (_request, response) => {
        response.type('html').send(getTemplate('onboarding-sim/index.html'));
    });

    server.get('/api/app', (_request, response) => {
        const app = store.loadedApp;
        const guides = store.summaries();
        response.json({
            packageName: app.packageName,
            entryPath: app.entryPath,
            answer: app.answer,
            detail: app.detail,
            validation: app.validation.result,
            energyAppState: app.mock.state.energyAppState,
            handlers: {
                guides: Boolean(app.mock.state.guidesHandler),
                dynamic: Boolean(app.mock.state.dynamicHandler),
                additionalSetup: Boolean(app.mock.state.additionalSetupHandler),
                deviceSelect: Boolean(app.mock.state.deviceSelectHandler),
                eebusDeviceSelect: Boolean(app.mock.state.eebusDeviceSelectHandler),
                zigbeePairing: Boolean(app.mock.state.zigbeePairingHandler),
                inputValidation: Boolean(app.mock.state.inputValidationHandler),
            },
            // Whether a package config was found: a subscription offer has nothing to show without it.
            hasDefinition: Boolean(app.definition),
            // Declared consents with what enyo holds for each — the inspector's toggles.
            consents: app.consents.map(consent => ({
                ...consent,
                state: app.mock.state.consentStates.find(state => state.consentKey === consent.consentKey),
            })),
            runActions: app.mock.state.runActions,
            variants: START_VARIANTS.map(variant => ({
                variant,
                guides: guides.filter(guide => guide.startVariant === variant),
                defaultContext: defaultContextFor(variant),
            })),
            files: app.files.map(file => ({name: file.name, mimeType: file.mimeType})),
            // Listed apart from `variants`: the host never offers it. Walk it with
            // `guideIndex: PACKAGE_GUIDE_INDEX`.
            packageGuide: store.packageGuideSummary() ?? null,
        });
    });

    server.post('/api/reload', handle(async (_request, response) => {
        const reloaded = await options.reload();
        store.replaceApp(reloaded);
        options.log.push({
            at: options.log.elapsed(),
            kind: 'sim',
            message: `Reloaded ${reloaded.packageName}: ${reloaded.guides.length} guide(s), answer '${reloaded.answer}'` +
                (reloaded.packageGuide ? ', plus the manual setup guide (pre-app onboarding)' : ''),
        });
        response.json({ok: true});
    }));

    /**
     * A public file the package declares, so an image block renders the picture
     * the installer would actually see. Only declared files are served: the
     * lookup is by `name`, never by a path from the request.
     */
    server.get('/api/files/:name', handle((request, response) => {
        const app = store.loadedApp;
        const declared = app.files.find(file => file.name === request.params.name);
        if (!declared) {
            response.status(404).json({error: `No public file named '${request.params.name}' is declared`});
            return;
        }
        const resolved = path.resolve(app.cwd, declared.path);
        if (!fs.existsSync(resolved)) {
            response.status(404).json({error: `${declared.path} is declared but missing on disk`});
            return;
        }
        if (declared.mimeType) {
            response.type(declared.mimeType);
        }
        response.sendFile(resolved);
    }));

    server.post('/api/runs', handle(async (request, response) => {
        const body = request.body as { guideIndex?: number; context?: Partial<RunContext> };
        if (typeof body.guideIndex !== 'number') {
            throw new Error('guideIndex is required');
        }
        const run = store.createRun(body.guideIndex, body.context);
        response.json(await store.view(run.id));
    }));

    server.get('/api/runs/:id', handle(async (request, response) => {
        response.json(await store.view(request.params.id));
    }));

    server.post('/api/runs/:id/answer', handle(async (request, response) => {
        const body = request.body as { source?: EnyoOnboardingV2TransitionSource; label?: string };
        if (!body.source) {
            throw new Error('source is required');
        }
        store.answer(request.params.id, body.source, body.label);
        response.json(await store.view(request.params.id));
    }));

    /**
     * An input block: the typed value is kept, checked with the host's own rules,
     * and the installer picks which verdict the (absent) device test came back
     * with — that pick is the branch.
     */
    server.post('/api/runs/:id/input', handle(async (request, response) => {
        const body = request.body as { blockId?: string; value?: string; outcomeId?: string; label?: string };
        if (!body.blockId || typeof body.value !== 'string') {
            throw new Error('blockId and value are required');
        }
        const {valid} = store.validateInput(request.params.id, body.blockId, body.value);
        if (!valid) {
            response.status(422).json({error: 'The value does not match the block\'s value type'});
            return;
        }
        store.recordInput(request.params.id, body.blockId, body.value);
        // A `validated` input asks the app first; a rejection keeps the
        // installer on the step with the app's message, and is no branch.
        const check = await store.checkInputWithApp(request.params.id, body.blockId, body.value);
        if (check.valid && body.outcomeId) {
            store.answer(
                request.params.id,
                {
                    kind: EnyoOnboardingV2TransitionSourceKind.Outcome,
                    blockId: body.blockId,
                    outcomeId: body.outcomeId,
                },
                body.label
            );
        }
        response.json(await store.view(request.params.id));
    }));

    server.post('/api/runs/:id/setup', handle(async (request, response) => {
        const body = request.body as {
            blockId?: string;
            values?: EnyoOnboardingV2SetupFieldValue[];
            consents?: Record<string, boolean>;
            role?: string;
        };
        if (!body.blockId) {
            throw new Error('blockId is required');
        }
        const resolution = await store.runAdditionalSetup(
            request.params.id,
            body.blockId,
            body.values ?? [],
            asAnswers(body.consents),
            asRole(body.role)
        );
        response.json({resolution, view: await store.view(request.params.id)});
    }));

    /** Polled by the browser while a setup request is open — `reportSetupProgress()` as it arrives. */
    server.get('/api/runs/:id/progress', handle((request, response) => {
        response.json(store.progressOf(request.params.id));
    }));

    /**
     * A consent block's CTA: the ticked answers are recorded in the acting role,
     * and `given` fires once every required consent is in force. `declined` is an
     * ordinary outcome answer and goes through `/answer`.
     */
    server.post('/api/runs/:id/consent', handle(async (request, response) => {
        const body = request.body as { blockId?: string; answers?: Record<string, boolean>; role?: string };
        if (!body.blockId) {
            throw new Error('blockId is required');
        }
        const resolution = store.giveConsents(request.params.id, body.blockId, asAnswers(body.answers), asRole(body.role));
        response.json({resolution, view: await store.view(request.params.id)});
    }));

    /** A subscription-offer step: a simulated checkout that always succeeds. */
    server.post('/api/runs/:id/subscribe', handle(async (request, response) => {
        const body = request.body as { blockId?: string; planKey?: string };
        if (!body.blockId || !body.planKey) {
            throw new Error('blockId and planKey are required');
        }
        store.subscribe(request.params.id, body.blockId, body.planKey);
        response.json(await store.view(request.params.id));
    }));

    /** Give or withdraw a declared consent outside any step — the customer in their own app. */
    server.post('/api/consents/:key', handle((request, response) => {
        const body = request.body as { granted?: boolean; role?: string };
        if (typeof body.granted !== 'boolean') {
            throw new Error('granted is required');
        }
        response.json(store.setConsent(request.params.key, body.granted, asRole(body.role)));
    }));

    /**
     * A picker block: the installer picked a device or a peer off the list. The
     * app's handler runs, the run is bound to what it answers with, and the
     * block's positive outcome is the branch.
     *
     * The negative branches — nothing was listed, the handshake never came up —
     * are ordinary outcome answers and go through `/answer`: there is no pick
     * behind them and no handler to call.
     */
    server.post('/api/runs/:id/pick', handle(async (request, response) => {
        const body = request.body as { blockId?: string; key?: string; keys?: string[]; autoSelected?: boolean };
        const keys = Array.isArray(body.keys) ? body.keys.filter(key => typeof key === 'string') : body.key ? [body.key] : [];
        if (!body.blockId || keys.length === 0) {
            throw new Error('blockId and key (or keys) are required');
        }
        const resolution = await store.pick(request.params.id, body.blockId, keys, body.autoSelected === true);
        response.json({resolution, view: await store.view(request.params.id)});
    }));

    server.post('/api/runs/:id/back', handle(async (request, response) => {
        store.back(request.params.id);
        response.json(await store.view(request.params.id));
    }));

    server.post('/api/runs/:id/reset', handle(async (request, response) => {
        store.reset(request.params.id);
        response.json(await store.view(request.params.id));
    }));

    server.get('/api/log', (request, response) => {
        response.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        response.flushHeaders();
        const unsubscribe = options.log.subscribe(response);
        request.on('close', unsubscribe);
    });

    return server;
};
