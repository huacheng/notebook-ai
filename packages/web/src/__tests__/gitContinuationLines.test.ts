/**
 * @vitest-environment jsdom
 *
 * Tests for git graph continuation lines when commit files are expanded.
 * The ContinuationLines component draws active lane lines in the expanded area.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ContinuationLines } from '../components/GitHistoryPanel';
import type { LaneNode } from '../utils/gitGraph';
import { LANE_COLORS } from '../utils/gitGraph';

const LANE_WIDTH = 20;
function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}
function colorOf(idx: number): string {
  return LANE_COLORS[idx % LANE_COLORS.length];
}

describe('ContinuationLines', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  function render(el: ReturnType<typeof createElement>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(el));
  }

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it('renders SVG with line elements for each active lane', () => {
    const laneNode: LaneNode = {
      lane: 0,
      activeLanes: [
        { lane: 0, colorIndex: 0 },
        { lane: 1, colorIndex: 1 },
        { lane: 2, colorIndex: 3 },
      ],
      connections: [],
      colorIndex: 0,
      isMerge: false,
      newLanes: [],
      wasExpected: true,
    };

    render(createElement(ContinuationLines, { laneNode, maxLanes: 3 }));

    const svg = container.querySelector('.git-graph-continuation');
    expect(svg).not.toBeNull();
    expect(svg!.tagName.toLowerCase()).toBe('svg');

    const lines = svg!.querySelectorAll('line');
    expect(lines.length).toBe(3);
  });

  it('returns null when laneNode is undefined', () => {
    render(createElement(ContinuationLines, { laneNode: undefined, maxLanes: 3 }));

    const svg = container.querySelector('.git-graph-continuation');
    expect(svg).toBeNull();
  });

  it('returns null when maxLanes is 0', () => {
    const laneNode: LaneNode = {
      lane: 0,
      activeLanes: [{ lane: 0, colorIndex: 0 }],
      connections: [],
      colorIndex: 0,
      isMerge: false,
      newLanes: [],
      wasExpected: true,
    };

    render(createElement(ContinuationLines, { laneNode, maxLanes: 0 }));

    const svg = container.querySelector('.git-graph-continuation');
    expect(svg).toBeNull();
  });

  it('line x-positions match laneX() formula', () => {
    const laneNode: LaneNode = {
      lane: 1,
      activeLanes: [
        { lane: 0, colorIndex: 0 },
        { lane: 2, colorIndex: 4 },
      ],
      connections: [],
      colorIndex: 2,
      isMerge: true,
      newLanes: [],
      wasExpected: true,
    };

    render(createElement(ContinuationLines, { laneNode, maxLanes: 4 }));

    const lines = container.querySelectorAll('.git-graph-continuation line');
    expect(lines.length).toBe(2);

    expect(lines[0].getAttribute('x1')).toBe(String(laneX(0)));
    expect(lines[1].getAttribute('x1')).toBe(String(laneX(2)));
  });

  it('line strokes use correct lane colors', () => {
    const laneNode: LaneNode = {
      lane: 0,
      activeLanes: [
        { lane: 0, colorIndex: 0 },
        { lane: 1, colorIndex: 3 },
      ],
      connections: [],
      colorIndex: 0,
      isMerge: false,
      newLanes: [],
      wasExpected: true,
    };

    render(createElement(ContinuationLines, { laneNode, maxLanes: 2 }));

    const lines = container.querySelectorAll('.git-graph-continuation line');
    expect(lines[0].getAttribute('stroke')).toBe(colorOf(0));
    expect(lines[1].getAttribute('stroke')).toBe(colorOf(3));
  });
});
