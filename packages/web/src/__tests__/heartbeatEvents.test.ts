/**
 * Frontend handling of heartbeat events from backend.
 * Tests that process_dead, stuck_exhausted, and tool_long_running events
 * are properly handled and displayed to users.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Heartbeat event handling', () => {
  const wsSliceSrc = () => readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  describe('process_dead event', () => {
    it('should have case handler for process_dead', () => {
      const src = wsSliceSrc();
      expect(src).toMatch(/case\s+['"]process_dead['"]/);
    });

    it('should set error state or notification for process_dead', () => {
      const src = wsSliceSrc();
      // Should either set an error state or trigger a notification via sessionNotice
      const processDeadMatch = src.match(/process_dead[\s\S]*?(sessionNotice|setError|notification|toast)/i);
      expect(processDeadMatch).toBeTruthy();
    });
  });

  describe('stuck_exhausted event', () => {
    it('should have case handler for stuck_exhausted', () => {
      const src = wsSliceSrc();
      expect(src).toMatch(/case\s+['"]stuck_exhausted['"]/);
    });

    it('should set error state or notification for stuck_exhausted', () => {
      const src = wsSliceSrc();
      // Should set sessionNotice to notify user
      const stuckMatch = src.match(/stuck_exhausted[\s\S]*?(sessionNotice|setError|notification|toast)/i);
      expect(stuckMatch).toBeTruthy();
    });
  });

  describe('tool_long_running event', () => {
    it('should have case handler for tool_long_running', () => {
      const src = wsSliceSrc();
      expect(src).toMatch(/case\s+['"]tool_long_running['"]/);
    });

    it('should notify user about long-running tool', () => {
      const src = wsSliceSrc();
      const toolMatch = src.match(/tool_long_running[\s\S]*?(notification|toast|console|log)/i);
      expect(toolMatch).toBeTruthy();
    });
  });

  describe('tool_long_running auto-clear on tool_result', () => {
    it('should clear sessionNotice in tool_result case block', () => {
      const src = wsSliceSrc();
      // Extract the tool_result case block and check it contains sessionNotice clearing
      // The pattern should find sessionNotice clearing within ~50 lines after "case 'tool_result'"
      const toolResultCase = src.match(/case\s+['"]tool_result['"][\s\S]{0,800}?break;/);
      expect(toolResultCase).toBeTruthy();
      expect(toolResultCase![0]).toMatch(/sessionNotice.*null|clearSessionNotice|sessionNotice.*''|Tool execution/i);
    });
  });
});

describe('sessionNotice display in Notebook component', () => {
  const notebookSrc = () => readFileSync(
    path.resolve(__dirname, '../components/Notebook.tsx'),
    'utf-8'
  );

  it('should display sessionNotice in Notebook component', () => {
    const src = notebookSrc();
    expect(src).toContain('sessionNotice');
    expect(src).toContain('session-notice');
  });

  it('should have close button for sessionNotice', () => {
    const src = notebookSrc();
    expect(src).toContain('clearSessionNotice');
  });
});

describe('Heartbeat event types in shared', () => {
  const typesSrc = () => readFileSync(
    path.resolve(__dirname, '../../../shared/src/types.ts'),
    'utf-8'
  );

  it('should define ProcessDeadMessage type', () => {
    const src = typesSrc();
    expect(src).toContain('process_dead');
  });

  it('should define StuckExhaustedMessage type', () => {
    const src = typesSrc();
    expect(src).toContain('stuck_exhausted');
  });

  it('should define ToolLongRunningMessage type', () => {
    const src = typesSrc();
    expect(src).toContain('tool_long_running');
  });
});
