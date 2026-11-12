/**
 * Incremental Server-Sent Events parser: feed it the decoded chunks of a
 * response body in order and it answers the data of every event that completed.
 *
 * Only what the registry sends is understood — `data:` lines, joined with a
 * newline when an event has several, and `:` comment lines, which are ignored
 * like the other fields (`event:`, `id:`, `retry:`).
 */
export class SseParser {
    private buffer = '';
    private dataLines: string[] = [];

    push(chunk: string): string[] {
        this.buffer += chunk;
        const events: string[] = [];

        let newline = this.buffer.search(/\r\n|\n|\r/);
        while (newline !== -1) {
            const line = this.buffer.slice(0, newline);
            const separatorLength = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
            this.buffer = this.buffer.slice(newline + separatorLength);
            const event = this.handleLine(line);
            if (event !== undefined) {
                events.push(event);
            }
            newline = this.buffer.search(/\r\n|\n|\r/);
        }

        return events;
    }

    private handleLine(line: string): string | undefined {
        if (line === '') {
            if (this.dataLines.length === 0) {
                return undefined;
            }
            const data = this.dataLines.join('\n');
            this.dataLines = [];
            return data;
        }
        if (line.startsWith('data:')) {
            const value = line.slice('data:'.length);
            this.dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
        }
        return undefined;
    }
}
