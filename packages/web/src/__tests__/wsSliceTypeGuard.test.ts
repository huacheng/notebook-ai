import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../store/wsSlice.ts'),
  'utf-8',
);

/**
 * P1-14: ws.onmessage event.data should have a typeof === 'string' guard
 * before JSON.parse. WebSocket can also receive binary Blob/ArrayBuffer data,
 * and JSON.parse(Blob) will throw a confusing error.
 */
describe('wsSlice event.data type guard (P1-14)', () => {
  it('should check typeof event.data before JSON.parse', () => {
    const onMsgStart = src.indexOf('ws.onmessage');
    const onMsgEnd = src.indexOf('ws.onerror', onMsgStart);
    const block = src.slice(onMsgStart, onMsgEnd > 0 ? onMsgEnd : onMsgStart + 500);
    // Must contain a typeof check on event.data
    expect(block).toMatch(/typeof\s+event\.data\s*[!=]==?\s*'string'/);
  });
});
