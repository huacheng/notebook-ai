/**
 * Tests for InteractiveOptions component behavior (pure logic, no DOM).
 *
 * Validates the interaction patterns between user actions and formatAnswer output.
 */
import { describe, it, expect } from 'vitest';
import { formatAnswer } from '../utils/interactiveOptions';
import type { AskQuestion } from '../utils/interactiveOptions';

const singleQ: AskQuestion[] = [
  {
    question: 'Pick a color?',
    header: 'Color',
    options: [
      { label: 'Red', description: 'warm' },
      { label: 'Blue', description: 'cool' },
    ],
    multiSelect: false,
  },
];

const multiQ: AskQuestion[] = [
  {
    question: 'Pick a tool?',
    header: 'Tool',
    options: [
      { label: 'Hammer', description: 'hit' },
      { label: 'Wrench', description: 'turn' },
    ],
    multiSelect: true,
  },
];

describe('InteractiveOptions behavior', () => {
  it('Other selection sets __other__ and formats with custom text', () => {
    // Simulates: user focuses Other input → selections become [['__other__']]
    const selections: string[][] = [['__other__']];
    const result = formatAnswer(singleQ, selections, { otherTexts: ['Custom color'] });
    expect(result).toBe('Other: Custom color');
  });

  it('Decline sends decline format via formatAnswer', () => {
    // Simulates: user clicks Decline area → selections become [['__decline__']]
    const selections: string[][] = [['__decline__']];
    const result = formatAnswer(singleQ, selections, { declineReason: 'Not applicable' });
    expect(result).toBe('Declined: Not applicable');
  });

  it('Other with empty text produces Other with empty suffix', () => {
    // Component should guard against submitting empty Other text,
    // but formatAnswer itself produces "Other: " if text is empty
    const selections: string[][] = [['__other__']];
    const result = formatAnswer(singleQ, selections, { otherTexts: [''] });
    expect(result).toBe('Other: ');
    // The component submit guard should prevent this from being sent
  });

  it('Decline without reason formats as bare Declined', () => {
    // Simulates: user presses Ctrl+Enter in Decline input with empty text
    const selections: string[][] = [['__decline__']];
    const result = formatAnswer(singleQ, selections, { declineReason: '' });
    expect(result).toBe('Declined');
  });

  it('multiSelect Other can coexist with preset options', () => {
    // Simulates: user selects Hammer + types Other text
    const selections: string[][] = [['Hammer', '__other__']];
    const result = formatAnswer(multiQ, selections, { otherTexts: ['Drill'] });
    expect(result).toBe('Hammer, Other: Drill');
  });

  it('Decline overrides all questions in multi-question', () => {
    const twoQ: AskQuestion[] = [
      { question: 'Q1?', header: 'H1', options: [{ label: 'A', description: '' }], multiSelect: false },
      { question: 'Q2?', header: 'H2', options: [{ label: 'B', description: '' }], multiSelect: false },
    ];
    // Even if q1 has a selection, __decline__ in q2 triggers global decline
    const selections: string[][] = [['A'], ['__decline__']];
    const result = formatAnswer(twoQ, selections, { declineReason: 'Changed my mind' });
    expect(result).toBe('Declined: Changed my mind');
  });
});
