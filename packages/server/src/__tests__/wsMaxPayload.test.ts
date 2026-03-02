import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../index.ts'),
  'utf-8',
);

/**
 * P0-2: WebSocketServer has no maxPayload limit (default 100MB).
 * A single client can send huge JSON payloads to exhaust server memory.
 */
describe('WS maxPayload limit (P0-2)', () => {
  it('should set maxPayload on WebSocketServer', () => {
    const wssLine = src.slice(
      src.indexOf('new WebSocketServer'),
      src.indexOf('\n', src.indexOf('new WebSocketServer')),
    );
    expect(wssLine).toContain('maxPayload');
  });
});
