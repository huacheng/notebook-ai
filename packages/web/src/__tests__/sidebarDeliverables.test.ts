/**
 * Test: Deliverables tab is merged into sidebar L2, right panel removed.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Sidebar L2 has Files/Deliverables tabs', () => {
  it('ProjectSidebar should have a deliverables tab in L2', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/ProjectSidebar.tsx'), 'utf-8'
    );
    expect(src).toContain('sidebar-l2-tab');
    expect(src).toContain('deliverables');
  });

  it('ProjectSidebar should render FileSection for deliverables', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../components/ProjectSidebar.tsx'), 'utf-8'
    );
    expect(src).toContain('getDeliverablesPath');
    expect(src).toContain("source: 'deliverables'");
  });
});

describe('Right panel is removed', () => {
  it('RightPanel.tsx should not exist', () => {
    const exists = fs.existsSync(
      path.resolve(__dirname, '../components/RightPanel.tsx')
    );
    expect(exists).toBe(false);
  });

  it('App.tsx should not import or render RightPanel', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/App.tsx'), 'utf-8'
    );
    expect(src).not.toContain('RightPanel');
    expect(src).not.toContain('right-panel');
    expect(src).not.toContain('startRightDrag');
  });

  it('store types should not have rightPanel state', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../store/types.ts'), 'utf-8'
    );
    expect(src).not.toContain('rightPanelOpen');
    expect(src).not.toContain('rightPanelWidth');
    expect(src).not.toContain('toggleRightPanel');
  });
});
