export class CLIError extends Error {
    constructor(
        message: string,
        public readonly code?: string,
        public readonly exitCode: number = 1
    ) {
        super(message);
        this.name = 'CLIError';
    }
}

export const handleError = (error: unknown, context: string): never => {
    if (error instanceof Error) {
        console.error(`❌ Error ${context}:`, error.message);
    } else {
        console.error(`❌ Unknown error ${context}:`, error);
    }

    if (error instanceof CLIError) {
        process.exit(error.exitCode);
    }

    process.exit(1);
};

export const validatePort = (portString: string, portName: string = 'port'): number => {
    const port = parseInt(portString, 10);

    if (isNaN(port) || port <= 0 || port > 65535) {
        throw new CLIError(`Invalid ${portName} number: ${portString}. Must be between 1 and 65535.`);
    }

    return port;
};