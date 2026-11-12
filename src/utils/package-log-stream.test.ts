import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    formatPackageLogEvent,
    formatPackageLogFileLine,
    openPackageLogFile,
    packageLogStreamUrl,
    parsePackageLogEvent,
    resolveLogFilePath
} from './package-log-stream.js';

describe('packageLogStreamUrl', () => {
    test('encodes the box and the package name', () => {
        assert.equal(
            packageLogStreamUrl('https://api.example', 'SER 1', 'my-app'),
            'https://api.example/api/package-registry/devices/SER%201/packages/my-app/logs'
        );
    });
});

describe('parsePackageLogEvent', () => {
    test('reads a log event', () => {
        assert.deepEqual(
            parsePackageLogEvent('{"type":"log","timestampIso":"2026-11-12T10:00:00.000Z","level":"debug","message":"hi"}'),
            {type: 'log', timestampIso: '2026-11-12T10:00:00.000Z', level: 'debug', message: 'hi'}
        );
    });

    test('ignores what is not JSON or has no type', () => {
        assert.equal(parsePackageLogEvent('not json'), undefined);
        assert.equal(parsePackageLogEvent('{"level":"info"}'), undefined);
    });
});

describe('formatPackageLogEvent', () => {
    test('prints a log line with its level icon and message', () => {
        const line = formatPackageLogEvent({type: 'log', timestampIso: '2026-11-12T10:00:00.000Z', level: 'debug', message: 'hi'});
        assert.match(line ?? '', /🐛 hi$/);
    });

    test('reports dropped lines', () => {
        assert.match(formatPackageLogEvent({type: 'dropped', count: 4}) ?? '', /4 log line\(s\) dropped/);
    });

    test('prints nothing for keep-alives', () => {
        assert.equal(formatPackageLogEvent({type: 'ping'}), undefined);
    });
});

describe('resolveLogFilePath', () => {
    test('writes nothing without --out', () => {
        assert.equal(resolveLogFilePath(undefined, 'DEV000001', 'my-app'), undefined);
    });

    test('puts a bare --out into .enyo-logs, named after box and package', () => {
        assert.equal(resolveLogFilePath(true, 'DEV000001', '@enyo/my-app'), path.join('.enyo-logs', 'DEV000001-_enyo_my-app.log'));
    });

    test('takes a typed path as it is', () => {
        assert.equal(resolveLogFilePath('tmp/box.log', 'DEV000001', 'my-app'), 'tmp/box.log');
    });
});

describe('formatPackageLogFileLine', () => {
    const now = new Date('2026-11-12T10:05:00.000Z');

    test('keeps the full timestamp and the level as a word', () => {
        assert.equal(
            formatPackageLogFileLine({type: 'log', timestampIso: '2026-11-12T10:00:00.000Z', level: 'warn', message: 'hi'}, now),
            '2026-11-12T10:00:00.000Z WARN  hi'
        );
    });

    test('stamps stream events with the time they arrived', () => {
        assert.equal(formatPackageLogFileLine({type: 'status', message: 'box offline'}, now), '2026-11-12T10:05:00.000Z STATUS box offline');
    });

    test('writes nothing for keep-alives', () => {
        assert.equal(formatPackageLogFileLine({type: 'ping'}, now), undefined);
    });
});

describe('openPackageLogFile', () => {
    test('appends events after a header and keeps a .enyo-logs folder out of git', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-logs-'));
        try {
            const file = path.join(root, '.enyo-logs', 'box.log');
            fs.mkdirSync(path.dirname(file));
            fs.writeFileSync(file, 'earlier\n');

            const write = openPackageLogFile(file, 'my-app on DEV000001');
            write({type: 'log', timestampIso: '2026-11-12T10:00:00.000Z', level: 'info', message: 'started'});
            write({type: 'ping'});

            const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
            assert.equal(lines[0], 'earlier');
            assert.match(lines[1], /^\S+ STREAM my-app on DEV000001$/);
            assert.equal(lines[2], '2026-11-12T10:00:00.000Z INFO  started');
            assert.equal(lines.length, 3);
            assert.equal(fs.readFileSync(path.join(root, '.enyo-logs', '.gitignore'), 'utf8'), '*\n');
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    test('leaves other folders without a .gitignore', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enyo-logs-'));
        try {
            openPackageLogFile(path.join(root, 'logs', 'box.log'), 'my-app on DEV000001');
            assert.equal(fs.existsSync(path.join(root, 'logs', '.gitignore')), false);
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });
});
