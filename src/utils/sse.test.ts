import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {SseParser} from './sse.js';

describe('SseParser', () => {
    test('answers the data of each completed event', () => {
        const parser = new SseParser();
        assert.deepEqual(parser.push('data: {"type":"ping"}\n\ndata: {"a":1}\n\n'), ['{"type":"ping"}', '{"a":1}']);
    });

    test('keeps an event split across chunks until it completes', () => {
        const parser = new SseParser();
        assert.deepEqual(parser.push('data: {"type":'), []);
        assert.deepEqual(parser.push('"log"}\n'), []);
        assert.deepEqual(parser.push('\n'), ['{"type":"log"}']);
    });

    test('joins multi-line data and ignores comments and other fields', () => {
        const parser = new SseParser();
        assert.deepEqual(parser.push(': keep-alive\nevent: log\nid: 7\ndata: one\ndata: two\n\n'), ['one\ntwo']);
    });

    test('understands CRLF line endings', () => {
        const parser = new SseParser();
        assert.deepEqual(parser.push('data: x\r\n\r\n'), ['x']);
    });

    test('a blank line without data is not an event', () => {
        const parser = new SseParser();
        assert.deepEqual(parser.push('\n\n: comment\n\n'), []);
    });
});
