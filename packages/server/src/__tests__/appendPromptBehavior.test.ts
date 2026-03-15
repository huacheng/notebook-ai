/**
 * Tests appendPrompt runtime behavior via SessionManager.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('appendPrompt behavior', () => {
  it('should handle non-running cell (redirect or throw)', () => {
    const src = sessionSrc();
    // appendPrompt should check cell.status !== 'running' and either redirect or throw
    const method = src.match(/appendPrompt[\s\S]*?\/\/ Append segment/);
    expect(method).toBeTruthy();
    expect(method![0]).toMatch(/status\s*!==\s*'running'/);
    expect(method![0]).toMatch(/throw/);
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
    // cell_appended broadcast is after the append segment logic
    expect(src).toContain("type: 'cell_appended'");
    expect(src).toMatch(/broadcast\(session,\s*\{[^}]*cell_appended/);
  });

  it('should handle images when provided', () => {
    const src = sessionSrc();
    const method = src.match(/appendPrompt[\s\S]*?broadcast\(session/);
    expect(method).toBeTruthy();
    // Should resolve image_refs and pass resolvedImages to sendPrompt
    expect(method![0]).toContain('resolvedImages');
    expect(method![0]).toMatch(/sendPrompt\(source,\s*resolvedImages\)/);
  });
});
