/**
 * Tests for interactive options (AskUserQuestion) detection and formatting.
 */
import { describe, it, expect } from 'vitest';
import { isAskUserQuestion, formatAnswer } from '../utils/interactiveOptions';

// ── Test fixtures ────────────────────────────────────────────────────────────

const askToolUse = {
  type: 'tool_use' as const,
  tool_use_id: 'toolu_01abc',
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: '你更喜欢哪种编程语言？',
        header: '编程语言',
        options: [
          { label: 'Python', description: '简洁优雅' },
          { label: 'JavaScript', description: 'Web 开发首选' },
          { label: 'Rust', description: '高性能系统编程' },
        ],
        multiSelect: false,
      },
    ],
  },
  timestamp: '2026-02-27T00:00:00Z',
};

const multiSelectToolUse = {
  type: 'tool_use' as const,
  tool_use_id: 'toolu_02def',
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: '你想启用哪些功能？',
        header: '功能',
        options: [
          { label: '暗黑模式', description: '护眼' },
          { label: '自动保存', description: '防丢失' },
          { label: '快捷键', description: '高效操作' },
        ],
        multiSelect: true,
      },
    ],
  },
  timestamp: '2026-02-27T00:00:00Z',
};

const multiQuestionToolUse = {
  type: 'tool_use' as const,
  tool_use_id: 'toolu_03ghi',
  name: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: '选择框架？',
        header: '框架',
        options: [
          { label: 'React', description: '组件化' },
          { label: 'Vue', description: '渐进式' },
        ],
        multiSelect: false,
      },
      {
        question: '选择样式方案？',
        header: '样式',
        options: [
          { label: 'CSS Modules', description: '模块化' },
          { label: 'Tailwind', description: '原子化' },
        ],
        multiSelect: false,
      },
    ],
  },
  timestamp: '2026-02-27T00:00:00Z',
};

const regularToolUse = {
  type: 'tool_use' as const,
  tool_use_id: 'toolu_04jkl',
  name: 'Read',
  input: { file_path: '/tmp/test.txt' },
  timestamp: '2026-02-27T00:00:00Z',
};

const malformedAskToolUse = {
  type: 'tool_use' as const,
  tool_use_id: 'toolu_05mno',
  name: 'AskUserQuestion',
  input: { bad: 'data' },
  timestamp: '2026-02-27T00:00:00Z',
};

// ── isAskUserQuestion ────────────────────────────────────────────────────────

describe('isAskUserQuestion', () => {
  it('returns true for valid AskUserQuestion tool_use', () => {
    expect(isAskUserQuestion(askToolUse)).toBe(true);
  });

  it('returns true for multiSelect AskUserQuestion', () => {
    expect(isAskUserQuestion(multiSelectToolUse)).toBe(true);
  });

  it('returns true for multi-question AskUserQuestion', () => {
    expect(isAskUserQuestion(multiQuestionToolUse)).toBe(true);
  });

  it('returns false for regular tool_use', () => {
    expect(isAskUserQuestion(regularToolUse)).toBe(false);
  });

  it('returns false for AskUserQuestion with malformed input', () => {
    expect(isAskUserQuestion(malformedAskToolUse)).toBe(false);
  });
});

// ── formatAnswer ─────────────────────────────────────────────────────────────

describe('formatAnswer', () => {
  it('formats single question single selection as plain label', () => {
    const result = formatAnswer(askToolUse.input.questions, [['Python']]);
    expect(result).toBe('Python');
  });

  it('formats single question multiple selections as comma-separated', () => {
    const result = formatAnswer(multiSelectToolUse.input.questions, [['暗黑模式', '快捷键']]);
    expect(result).toBe('暗黑模式, 快捷键');
  });

  it('formats multiple questions as labeled lines', () => {
    const result = formatAnswer(multiQuestionToolUse.input.questions, [['React'], ['Tailwind']]);
    expect(result).toBe('框架: React\n样式: Tailwind');
  });

  it('handles empty selection gracefully', () => {
    const result = formatAnswer(askToolUse.input.questions, [[]]);
    expect(result).toBe('');
  });
});
