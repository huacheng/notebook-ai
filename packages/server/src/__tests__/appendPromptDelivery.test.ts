/**
 * Test: appendPrompt sends messages to Claude stdin.
 * The _pendingAppends counter was removed because Claude processes
 * all appended prompts in the same turn and sends only one result.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('appendPrompt delivery to Claude', () => {
  it('appendPrompt should send prompt via agentProcess.sendPrompt', () => {
    const src = sessionSrc();
    // The appendPrompt method should call sendPrompt
    const appendBlock = src.match(/appendPrompt\([\s\S]*?broadcast\(session/);
    expect(appendBlock).toBeTruthy();
    expect(appendBlock![0]).toContain('agentProcess.sendPrompt');
  });

  it('appendPrompt should broadcast cell_appended event', () => {
    const src = sessionSrc();
    expect(src).toContain("type: 'cell_appended'");
  });

  it('should NOT have _pendingAppends tracking (removed)', () => {
    const src = sessionSrc();
    // The counter was removed — it caused incorrect defer behavior
    expect(src).not.toMatch(/_pendingAppends:\s*number/);
    expect(src).not.toMatch(/session\._pendingAppends\+\+/);
  });
});
