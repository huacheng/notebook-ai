import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  shouldCompact,
  detectCompaction,
  writeSummaryWithRecoveryHeader,
  validateRecoveryReadiness,
  SummaryContext,
} from '../task-ai/compaction-strategy';

describe('compactionStrategy', () => {
  describe('shouldCompact', () => {
    it('should not compact if already compacted once', () => {
      const decision = shouldCompact(0.90, 1);
      expect(decision.shouldCompact).toBe(false);
      expect(decision.reason).toContain('Already compacted');
    });

    it('should not compact if compacted twice', () => {
      const decision = shouldCompact(0.95, 2);
      expect(decision.shouldCompact).toBe(false);
    });

    it('should compact at 82% on first time', () => {
      const decision = shouldCompact(0.82, 0);
      expect(decision.shouldCompact).toBe(true);
      expect(decision.reason).toContain('82%');
    });

    it('should compact at 85% on first time', () => {
      const decision = shouldCompact(0.85, 0);
      expect(decision.shouldCompact).toBe(true);
    });

    it('should not compact below 82%', () => {
      const decision = shouldCompact(0.75, 0);
      expect(decision.shouldCompact).toBe(false);
      expect(decision.reason).toContain('Below threshold');
    });

    it('should not compact at 81%', () => {
      const decision = shouldCompact(0.81, 0);
      expect(decision.shouldCompact).toBe(false);
    });
  });

  describe('detectCompaction', () => {
    it('should detect "ran out of context" message', () => {
      const msg = 'This session is being continued from a previous conversation that ran out of context.';
      expect(detectCompaction(msg)).toBe(true);
    });

    it('should detect "context window limit" message', () => {
      const msg = 'The context window limit has been reached.';
      expect(detectCompaction(msg)).toBe(true);
    });

    it('should detect "session is being continued" message', () => {
      const msg = 'This session is being continued from where we left off.';
      expect(detectCompaction(msg)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const msg = 'CONVERSATION THAT RAN OUT OF CONTEXT';
      expect(detectCompaction(msg)).toBe(true);
    });

    it('should not false-positive on normal output', () => {
      const msg = '## Findings\n- Code review complete\n- All tests pass';
      expect(detectCompaction(msg)).toBe(false);
    });

    it('should not false-positive on unrelated context mentions', () => {
      const msg = 'The context of this function is important';
      expect(detectCompaction(msg)).toBe(false);
    });
  });

  describe('writeSummaryWithRecoveryHeader', () => {
    it('should prepend recovery header', () => {
      const content = '## Summary\nTask completed step 1.';
      const ctx: SummaryContext = {
        notebook: 'test-task',
        status: 'executing',
        phase: 'Phase 2',
        nextStep: 'exec',
        branch: 'task-ai/test-task',
      };

      const result = writeSummaryWithRecoveryHeader(content, ctx);

      expect(result).toContain('TASK-AI RECOVERY CONTEXT');
      expect(result).toContain('Read .auto-signal');
      expect(result).toContain('Read .status.json');
    });

    it('should include status line', () => {
      const content = '## Summary\nContent here.';
      const ctx: SummaryContext = {
        notebook: 'my-notebook',
        status: 'planning',
        phase: 'Phase 1',
        nextStep: 'plan',
        branch: 'task-ai/my-notebook',
      };

      const result = writeSummaryWithRecoveryHeader(content, ctx);

      expect(result).toContain('# Task: my-notebook');
      expect(result).toContain('**Status**: planning');
      expect(result).toContain('**Phase**: Phase 1');
      expect(result).toContain('**Next**: plan');
      expect(result).toContain('**Branch**: task-ai/my-notebook');
    });

    it('should preserve original content', () => {
      const content = '## Original Content\n\n- Item 1\n- Item 2';
      const ctx: SummaryContext = {
        notebook: 'test',
        status: 'executing',
        phase: 'Phase 2',
        nextStep: 'verify',
        branch: 'task-ai/test',
      };

      const result = writeSummaryWithRecoveryHeader(content, ctx);

      expect(result).toContain('## Original Content');
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
    });

    it('should use --- separator', () => {
      const content = 'Content';
      const ctx: SummaryContext = {
        notebook: 'test',
        status: 'executing',
        phase: 'Phase 2',
        nextStep: 'exec',
        branch: 'task-ai/test',
      };

      const result = writeSummaryWithRecoveryHeader(content, ctx);

      expect(result).toContain('---');
    });
  });

  describe('validateRecoveryReadiness', () => {
    const tempDir = '/tmp/test-recovery-validation';

    beforeEach(() => {
      // Create temp directory structure
      fs.mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should fail when .auto-signal is missing', () => {
      // Create only .status.json and .summary.md
      fs.writeFileSync(
        path.join(tempDir, '.status.json'),
        JSON.stringify({ status: 'executing', title: 'Test', type: 'software', branch: 'test' })
      );
      fs.writeFileSync(
        path.join(tempDir, '.summary.md'),
        '<!-- TASK-AI RECOVERY CONTEXT -->\n# Task: test'
      );

      const result = validateRecoveryReadiness(tempDir);

      expect(result.ready).toBe(false);
      expect(result.errors).toContain('.auto-signal missing');
    });

    it('should fail when .status.json is missing', () => {
      fs.writeFileSync(
        path.join(tempDir, '.auto-signal'),
        JSON.stringify({ step: 'exec', next: 'verify', iteration: 1, timestamp: new Date().toISOString() })
      );
      fs.writeFileSync(
        path.join(tempDir, '.summary.md'),
        '<!-- TASK-AI RECOVERY CONTEXT -->\n# Task: test'
      );

      const result = validateRecoveryReadiness(tempDir);

      expect(result.ready).toBe(false);
      expect(result.errors).toContain('.status.json missing');
    });

    it('should fail when .summary.md is missing', () => {
      fs.writeFileSync(
        path.join(tempDir, '.auto-signal'),
        JSON.stringify({ step: 'exec', next: 'verify', iteration: 1, timestamp: new Date().toISOString() })
      );
      fs.writeFileSync(
        path.join(tempDir, '.status.json'),
        JSON.stringify({ status: 'executing', title: 'Test', type: 'software', branch: 'test' })
      );

      const result = validateRecoveryReadiness(tempDir);

      expect(result.ready).toBe(false);
      expect(result.errors).toContain('.summary.md missing');
    });

    it('should fail when .auto-signal missing required field', () => {
      fs.writeFileSync(
        path.join(tempDir, '.auto-signal'),
        JSON.stringify({ step: 'exec', next: 'verify' }) // missing iteration and timestamp
      );
      fs.writeFileSync(
        path.join(tempDir, '.status.json'),
        JSON.stringify({ status: 'executing', title: 'Test', type: 'software', branch: 'test' })
      );
      fs.writeFileSync(
        path.join(tempDir, '.summary.md'),
        '<!-- TASK-AI RECOVERY CONTEXT -->\n# Task: test'
      );

      const result = validateRecoveryReadiness(tempDir);

      expect(result.ready).toBe(false);
      expect(result.errors.some(e => e.includes('iteration'))).toBe(true);
    });

    it('should fail when .summary.md missing recovery header', () => {
      fs.writeFileSync(
        path.join(tempDir, '.auto-signal'),
        JSON.stringify({ step: 'exec', next: 'verify', iteration: 1, timestamp: new Date().toISOString() })
      );
      fs.writeFileSync(
        path.join(tempDir, '.status.json'),
        JSON.stringify({ status: 'executing', title: 'Test', type: 'software', branch: 'test' })
      );
      fs.writeFileSync(
        path.join(tempDir, '.summary.md'),
        '## Summary\nNo recovery header here'
      );

      const result = validateRecoveryReadiness(tempDir);

      expect(result.ready).toBe(false);
      expect(result.errors).toContain('.summary.md missing recovery header');
    });

    it('should pass when all files are valid', () => {
      fs.writeFileSync(
        path.join(tempDir, '.auto-signal'),
        JSON.stringify({ step: 'exec', next: 'verify', iteration: 1, timestamp: new Date().toISOString(), phase: 'execution', phase_progress: 0.5, retry_count: 0 })
      );
      fs.writeFileSync(
        path.join(tempDir, '.status.json'),
        JSON.stringify({ status: 'executing', title: 'Test', type: 'software', branch: 'test' })
      );
      fs.writeFileSync(
        path.join(tempDir, '.summary.md'),
        '<!-- TASK-AI RECOVERY CONTEXT -->\n# Task: test\n**Status**: executing'
      );

      const result = validateRecoveryReadiness(tempDir);

      expect(result.ready).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('buildRecoverySignal', () => {
    // Import dynamically to avoid circular dependencies
    it('should build recovery signal with correct structure', async () => {
      const { buildRecoverySignal } = await import('../task-ai/compaction-strategy');
      const signal = buildRecoverySignal('/path/to/working');

      expect(signal.type).toBe('human');
      expect(signal.message).toContain('Context compacted');
      expect(signal.message).toContain('.auto-signal');
      expect(signal.message).toContain('.summary.md');
      expect(signal.message).toContain('Resume auto loop');
    });
  });
});
