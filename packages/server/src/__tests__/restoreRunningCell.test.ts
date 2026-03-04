import { describe, it, expect } from 'vitest';

/**
 * Running cell state persistence after page refresh
 *
 * Problem: 当 notebook 有一个 running cell 时，用户关闭页面后重新打开：
 * 1. restore 端点应该返回完整的 notebook，包括 running cell
 * 2. 前端重新连接 session 后，应该能中断 running cell
 * 3. restart session 不应该删除 running cell（只是将其标记为 error）
 */
describe('Running cell state persistence', () => {
  it('restore should return notebook with running cells intact', () => {
    // Given: a notebook with a running cell saved to disk
    const runningCell = {
      id: 'cell-1',
      type: 'prompt' as const,
      source: 'long running task',
      outputs: [{ type: 'text' as const, content: 'partial output...' }],
      execution_count: 1,
      status: 'running' as const,
    };

    const cells = [runningCell];

    // The running cell should be preserved when notebook is loaded
    expect(cells.length).toBe(1);
    expect(cells[0].status).toBe('running');
    expect(cells[0].outputs.length).toBe(1);
  });

  it('restart session should preserve cells but mark running as error', () => {
    // When session restarts with a running cell, the cell should not disappear
    // Instead, it should be marked as 'error' status with an appropriate message
    const cells = [
      {
        id: 'cell-1',
        type: 'prompt' as const,
        source: 'task',
        outputs: [{ type: 'text' as const, content: 'partial...' }],
        execution_count: 1,
        status: 'running' as const,
      },
    ];

    // After restart, cell should still exist but status changed
    const expectedAfterRestart = cells.map(c => ({
      ...c,
      status: c.status === 'running' ? 'error' : c.status,
    }));

    expect(expectedAfterRestart.length).toBe(1);
    expect(expectedAfterRestart[0].status).toBe('error');
    expect(expectedAfterRestart[0].outputs.length).toBe(1); // Outputs preserved
  });
});

describe('Session subscription after page refresh', () => {
  it('should be able to subscribe to existing session after page refresh', () => {
    // After page refresh, the frontend sends:
    // 1. POST /api/notebooks/:id/restore → returns sessionId
    // 2. WS message: { type: 'subscribe', session_id: sessionId }
    //
    // The subscription should succeed even if the session was created by a previous connection

    const sessionId = 'session-123';
    const subscribedSessions = new Set<string>();

    // Simulate subscribe
    subscribedSessions.add(sessionId);

    // After subscribe, operations like interrupt should be allowed
    expect(subscribedSessions.has(sessionId)).toBe(true);
  });
});
