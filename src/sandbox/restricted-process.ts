export interface ProcessEventListeners {
    beforeExit: Array<(code: number) => void>;
    exit: Array<(code: number) => void>;
}

export interface RestrictedProcess {
    env: Record<string, never>;
    argv: never[];
    cwd: () => string;
    exit: (code?: string | number) => void;
    on: (event: string, listener: (code: number) => void) => void;
    once: (event: string, listener: (code: number) => void) => void;
    removeListener: (event: string, listener: (code: number) => void) => void;
    stdout: typeof process.stdout;
    stderr: typeof process.stderr;
    stdin: typeof process.stdin;
}

export const createRestrictedProcess = (packageRoot: string): RestrictedProcess => {
    // Create restricted process object with event handling
    const processEventListeners: ProcessEventListeners = {
        beforeExit: [],
        exit: []
    };

    return {
        env: {},
        argv: [],
        cwd: () => packageRoot, // Restrict cwd to package root
        exit: (code?: string | number) => {
            console.log(`Package requested exit with code: ${code}`);

            // Emit beforeExit event
            processEventListeners.beforeExit.forEach(listener => {
                try {
                    listener(typeof code === 'string' ? parseInt(code) || 0 : code || 0);
                } catch (error) {
                    console.error('Error in beforeExit listener:', error);
                }
            });

            // Emit exit event
            processEventListeners.exit.forEach(listener => {
                try {
                    listener(typeof code === 'string' ? parseInt(code) || 0 : code || 0);
                } catch (error) {
                    console.error('Error in exit listener:', error);
                }
            });

            // Don't actually exit the main process
        },
        on: (event: string, listener: (code: number) => void) => {
            if (event === 'beforeExit' || event === 'exit') {
                if (typeof listener === 'function') {
                    processEventListeners[event].push(listener);
                }
            } else {
                console.warn(`Event '${event}' is not supported in the restricted process`);
            }
        },
        once: (event: string, listener: (code: number) => void) => {
            if (event === 'beforeExit' || event === 'exit') {
                if (typeof listener === 'function') {
                    const onceWrapper = (code: number) => {
                        listener(code);
                        const index = processEventListeners[event].indexOf(onceWrapper);
                        if (index > -1) {
                            processEventListeners[event].splice(index, 1);
                        }
                    };
                    processEventListeners[event].push(onceWrapper);
                }
            } else {
                console.warn(`Event '${event}' is not supported in the restricted process`);
            }
        },
        removeListener: (event: string, listener: (code: number) => void) => {
            if (event === 'beforeExit' || event === 'exit') {
                const index = processEventListeners[event].indexOf(listener);
                if (index > -1) {
                    processEventListeners[event].splice(index, 1);
                }
            }
        },
        stdout: process.stdout,
        stderr: process.stderr,
        stdin: process.stdin
    };
};