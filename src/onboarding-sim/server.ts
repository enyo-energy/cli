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
import {EnyoOnboardingV2TransitionSourceKind} from '@enyo-energy/energy-app-sdk';
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

export const createSimulatorServer = (options: SimulatorServerOptions): Express => {
    const store = new RunStore(options.app);
    const server = express();
    server.use(express.json({limit: '1mb'}));

    const handle = (fn: (request: Request, response: Response) => Promise<void> | void) =>
        (request: Request, response: Response): void => {
            Promise.resolve(fn(request, response)).catch((error: unknown) => {
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
            },
            runActions: app.mock.state.runActions,
            variants: START_VARIANTS.map(variant => ({
                variant,
                guides: guides.filter(guide => guide.startVariant === variant),
                defaultContext: defaultContextFor(variant),
            })),
            files: app.files.map(file => ({name: file.name, mimeType: file.mimeType})),
        });
    });

    server.post('/api/reload', handle(async (_request, response) => {
        const reloaded = await options.reload();
        store.replaceApp(reloaded);
        options.log.push({
            at: options.log.elapsed(),
            kind: 'sim',
            message: `Reloaded ${reloaded.packageName}: ${reloaded.guides.length} guide(s), answer '${reloaded.answer}'`,
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
        if (body.outcomeId) {
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
        const body = request.body as { blockId?: string; values?: EnyoOnboardingV2SetupFieldValue[] };
        if (!body.blockId) {
            throw new Error('blockId is required');
        }
        const resolution = await store.runAdditionalSetup(request.params.id, body.blockId, body.values ?? []);
        response.json({resolution, view: await store.view(request.params.id)});
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
        const body = request.body as { blockId?: string; key?: string };
        if (!body.blockId || !body.key) {
            throw new Error('blockId and key are required');
        }
        const resolution = await store.pick(request.params.id, body.blockId, body.key);
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
