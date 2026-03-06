import { describe, it, expect } from 'vitest';

describe('MultiStageView', () => {
  it('exports MultiStageView component', async () => {
    const { MultiStageView } = await import('../components/AutoStatusBar');
    expect(MultiStageView).toBeDefined();
    expect(typeof MultiStageView).toBe('function');
  });
});
