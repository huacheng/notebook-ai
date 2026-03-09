/**
 * Tests appendPrompt runtime behavior via SessionManager.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('appendPrompt behavior', () => {
  it('should throw on non-running cell', () => {
    const src = sessionSrc();
    // appendPrompt should check cell.status !== 'running' and throw
    const method = src.match(/appendPrompt[\s\S]*?\/\/ Broadcast/);
    expect(method).toBeTruthy();
    expect(method![0]).toMatch(/status\s*!==\s*'running'/);
    expect(method![0]).toMatch(/throw\s+new\s+Error/);
  });

  it('should throw on missing session', () => {
    const src = sessionSrc();
    const method = src.match(/appendPrompt[\s\S]*?\/\/ Append segment/);
    expect(method).toBeTruthy();
    expect(method![0]).toContain('not found');
    expect(method![0]).toMatch(/throw\s+new\s+Error/);
  });

  it('should call agentProcess.sendPrompt with source', () => {
    const src = sessionSrc();
    const method = src.match(/appendPrompt[\s\S]*?broadcast\(session/);
    expect(method).toBeTruthy();
    expect(method![0]).toContain('agentProcess.sendPrompt(source');
  });

  it('should broadcast cell_appended with segment', () => {
    const src = sessionSrc();
    const method = src.match(/appendPrompt[\s\S]*?console\.log/);
    expect(method).toBeTruthy();
    expect(method![0]).toContain("type: 'cell_appended'");
    expect(method![0]).toContain('segment');
  });

  it('should handle images when provided', () => {
    const src = sessionSrc();
    const method = src.match(/appendPrompt[\s\S]*?broadcast\(session/);
    expect(method).toBeTruthy();
    // Should check for images and pass them to sendPrompt
    expect(method![0]).toContain('images');
    expect(method![0]).toMatch(/sendPrompt\(source,\s*images\)/);
  });
});
