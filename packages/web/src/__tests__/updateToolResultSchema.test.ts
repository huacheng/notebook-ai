/**
 * Test: update_tool_result message type must be accepted by WSClientMessageSchema.
 *
 * Bug: Frontend sends update_tool_result for AskUserQuestion auto-response workaround,
 * but the type was missing from the Zod discriminated union schema, causing
 * "Invalid message format" errors at the backend validation layer.
 */
import { describe, it, expect } from 'vitest';
import { WSClientMessageSchema } from '@notebook-ai/shared';

describe('update_tool_result schema validation', () => {
  it('should accept valid update_tool_result message', () => {
    const msg = {
      type: 'update_tool_result',
      session_id: 'nb-abc123',
      cell_id: 'cell-001',
      tool_use_id: 'toolu_01abc',
      content: 'User selected: Option A',
    };

    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should reject update_tool_result without cell_id', () => {
    const msg = {
      type: 'update_tool_result',
      session_id: 'nb-abc123',
      tool_use_id: 'toolu_01abc',
      content: 'answer',
    };

    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should accept tool_result_response (normal path still works)', () => {
    const msg = {
      type: 'tool_result_response',
      session_id: 'nb-abc123',
      tool_use_id: 'toolu_01abc',
      content: 'Python',
    };

    const result = WSClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });
});
