import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Test that cell_created is broadcast to all subscribers when a new cell
 * is created via execute_request. This enables multi-device sync - other
 * browsers need to know about new cells before outputs arrive.
 */
describe('cell_created broadcast (multi-device sync)', () => {
  const getSessionSrc = () =>
    readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

  it('should broadcast cell_created when a new cell is created in executeCell', () => {
    const src = getSessionSrc();
    // When a cell doesn't exist and is created, should broadcast cell_created
    // Look for: if (!cellExists) { ... broadcast({ type: 'cell_created' ... })
    expect(src).toMatch(/cell_created/);
  });

  it('should include cell_id and source in cell_created broadcast', () => {
    const src = getSessionSrc();
    // The broadcast should include cell_id and source so other clients can create the cell
    expect(src).toMatch(/type:\s*['"]cell_created['"]/);
    expect(src).toMatch(/cell_created[\s\S]*?cell_id/);
    expect(src).toMatch(/cell_created[\s\S]*?source/);
  });

  it('should broadcast cell_created before setting cell status to running', () => {
    const src = getSessionSrc();
    // The broadcast should happen inside the if (!cellExists) block,
    // which is before updateCellStatus(... 'running')
    const cellCreatedPos = src.indexOf('cell_created');
    const updateStatusPos = src.indexOf("updateCellStatus(session.notebook, cellId, 'running')");
    expect(cellCreatedPos).toBeGreaterThan(0);
    expect(updateStatusPos).toBeGreaterThan(0);
    expect(cellCreatedPos).toBeLessThan(updateStatusPos);
  });

  it('should broadcast cell_status running after cell creation', () => {
    const src = getSessionSrc();
    // After creating the cell, should also broadcast cell_status: running
    // so other clients know the cell is now executing
    expect(src).toMatch(/type:\s*['"]cell_status['"]/);
    expect(src).toMatch(/cell_status[\s\S]*?running/);
  });
});

describe('frontend cell_created handling', () => {
  const getWsSliceSrc = () =>
    readFileSync(
      path.resolve(__dirname, '../../../../packages/web/src/store/wsSlice.ts'),
      'utf-8'
    );

  it('should handle cell_created message type', () => {
    const src = getWsSliceSrc();
    expect(src).toContain("case 'cell_created':");
  });

  it('should create the cell in notebook when cell_created is received', () => {
    const src = getWsSliceSrc();
    // Should add the new cell to the notebook
    expect(src).toMatch(/cell_created[\s\S]*?cells/);
  });
});
