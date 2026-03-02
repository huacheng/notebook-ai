/**
 * Test: base64 chunk concatenation issue
 *
 * When binary files are streamed in chunks and each chunk is base64-encoded
 * separately, the concatenated result is invalid if chunk sizes aren't
 * multiples of 3 bytes.
 */

import { describe, it, expect } from 'vitest';
import { b64ToUint8Array } from '../utils/b64';

describe('base64 chunk concatenation', () => {
  it('fails when chunks are independently encoded with padding', async () => {
    // Simulate server sending two chunks of binary data, each independently base64-encoded
    // Chunk 1: 16384 bytes (not divisible by 3) → will have padding
    const chunk1Raw = new Uint8Array(16384);
    for (let i = 0; i < chunk1Raw.length; i++) chunk1Raw[i] = i % 256;

    // Chunk 2: 100 bytes
    const chunk2Raw = new Uint8Array(100);
    for (let i = 0; i < chunk2Raw.length; i++) chunk2Raw[i] = (i * 3) % 256;

    // Each chunk encoded separately (this is what server does)
    const chunk1B64 = Buffer.from(chunk1Raw).toString('base64');
    const chunk2B64 = Buffer.from(chunk2Raw).toString('base64');

    // 16384 % 3 = 1 → padding expected
    expect(chunk1B64.endsWith('=')).toBe(true);

    // Concatenate (this is what frontend does)
    const concatenated = chunk1B64 + chunk2B64;

    // This should fail because padding chars are in the middle
    await expect(b64ToUint8Array(concatenated)).rejects.toThrow();
  });

  it('succeeds when chunk size is multiple of 3', async () => {
    // Use chunk size that's multiple of 3 → no padding except last chunk
    const chunkSize = 16383; // 16383 % 3 = 0

    const chunk1Raw = new Uint8Array(chunkSize);
    for (let i = 0; i < chunk1Raw.length; i++) chunk1Raw[i] = i % 256;

    const chunk2Raw = new Uint8Array(100);
    for (let i = 0; i < chunk2Raw.length; i++) chunk2Raw[i] = (i * 3) % 256;

    const chunk1B64 = Buffer.from(chunk1Raw).toString('base64');
    const chunk2B64 = Buffer.from(chunk2Raw).toString('base64');

    // First chunk should NOT have padding
    expect(chunk1B64.endsWith('=')).toBe(false);

    const concatenated = chunk1B64 + chunk2B64;

    // Should succeed
    const decoded = await b64ToUint8Array(concatenated);
    expect(decoded.length).toBe(chunkSize + 100);

    // Verify content
    for (let i = 0; i < chunkSize; i++) {
      expect(decoded[i]).toBe(i % 256);
    }
    for (let i = 0; i < 100; i++) {
      expect(decoded[chunkSize + i]).toBe((i * 3) % 256);
    }
  });
});
