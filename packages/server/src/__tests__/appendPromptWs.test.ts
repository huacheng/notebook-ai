/**
 * Tests that ws-handler.ts correctly routes append_prompt messages.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('WS handler append_prompt routing', () => {
  it('should have append_prompt case in message switch', () => {
    const src = wsHandlerSrc();
    expect(src).toContain("case 'append_prompt'");
  });

  it('should check session permission before processing', () => {
    const src = wsHandlerSrc();
    const caseBlock = src.match(/case 'append_prompt'[\s\S]*?break;\s*\}/);
    expect(caseBlock).toBeTruthy();
    expect(caseBlock![0]).toContain('checkSessionPermission');
  });

  it('should call sessionManager.appendPrompt with correct args', () => {
    const src = wsHandlerSrc();
    const caseBlock = src.match(/case 'append_prompt'[\s\S]*?break;\s*\}/);
    expect(caseBlock).toBeTruthy();
    // Now includes image_refs and is async
    expect(caseBlock![0]).toContain('await sessionManager.appendPrompt(session_id, cell_id, source, images, image_refs)');
  });

  it('should send error to client on failure', () => {
    const src = wsHandlerSrc();
    const caseBlock = src.match(/case 'append_prompt'[\s\S]*?break;\s*\}/);
    expect(caseBlock).toBeTruthy();
    expect(caseBlock![0]).toContain('catch');
    expect(caseBlock![0]).toContain('sendToClient');
    expect(caseBlock![0]).toContain("type: 'error'");
  });

  it('should NOT have queue_prompt case anymore', () => {
    const src = wsHandlerSrc();
    expect(src).not.toContain("case 'queue_prompt'");
    expect(src).not.toContain("case 'queue_remove'");
    expect(src).not.toContain("case 'queue_reorder'");
  });
});
