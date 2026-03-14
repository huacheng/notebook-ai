import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('/auto command in toolbar', () => {
  const getInputBarSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/shared/InputBar.tsx'), 'utf-8');

  const getCommandsSrc = () =>
    readFileSync(path.resolve(__dirname, '../../../server/src/routes/commands.ts'), 'utf-8');

  it('should have task-ai:auto as the first command in toolbar', () => {
    const src = getInputBarSrc();
    // Extract the commands array
    const match = src.match(/const commands[^=]*= \[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const commandsBlock = match![1];
    // First entry should be task-ai:auto
    const firstCmd = commandsBlock.match(/cmd:\s*'([^']+)'/);
    expect(firstCmd).toBeTruthy();
    expect(firstCmd![1]).toBe('task-ai:auto');
  });

  it('should display as /auto in the button label', () => {
    const src = getInputBarSrc();
    // The label extraction: label ?? cmd.split(':')[1] — for 'task-ai:auto' this yields 'auto'
    expect(src).toMatch(/cmd\.split\(':'\)\[1\]/);
  });

  it('should be listed in the backend COMMANDS array', () => {
    const src = getCommandsSrc();
    expect(src).toMatch(/name:\s*'task-ai:auto'/);
  });
});
