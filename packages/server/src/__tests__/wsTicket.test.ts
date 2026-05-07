import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { csrfMiddleware } from '../csrf.js';
import {
  authMiddleware,
  handleTokenLogin,
  handleWsTicket,
  createWsTicket,
  consumeWsTicket,
} from '../auth.js';

const TEST_TOKEN = 'ws-ticket-test-secret-token-for-cookie-12345';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfMiddleware);
  app.use(authMiddleware);
  app.post('/api/auth/login-token', handleTokenLogin);
  app.post('/api/auth/ws-ticket', handleWsTicket);
  return app;
}

beforeAll(() => {
  process.env['NB_AUTH_TOKEN'] = TEST_TOKEN;
});

describe('ws-ticket HTTP — cookie path', () => {
  it('cookie-authenticated POST /api/auth/ws-ticket returns a ticket', async () => {
    const app = makeApp();
    // Login via token to get cookie
    const login = await request(app)
      .post('/api/auth/login-token')
      .set('Origin', 'http://localhost:3003')
      .send({ token: TEST_TOKEN });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeTruthy();

    // Use cookie (+ Origin for CSRF) to request ws-ticket
    const r = await request(app)
      .post('/api/auth/ws-ticket')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3003');
    expect(r.status).toBe(200);
    expect(typeof r.body.ticket).toBe('string');
    expect(r.body.ticket.length).toBeGreaterThan(0);
  });

  it('Bearer-authenticated POST /api/auth/ws-ticket still works (backward compat)', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/auth/login-token')
      .set('Origin', 'http://localhost:3003')
      .send({ token: TEST_TOKEN });
    expect(login.status).toBe(200);
    const sessionToken: string = login.body.token;
    expect(sessionToken).toBeTruthy();

    const r = await request(app)
      .post('/api/auth/ws-ticket')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('Origin', 'http://localhost:3003');
    expect(r.status).toBe(200);
    expect(typeof r.body.ticket).toBe('string');
  });
});

describe('ws-ticket', () => {
  const testUserId = 'test-user-123';

  it('createWsTicket returns unique tickets', () => {
    const t1 = createWsTicket(testUserId);
    const t2 = createWsTicket(testUserId);
    expect(t1).not.toBe(t2);
    expect(typeof t1).toBe('string');
    expect(t1.length).toBeGreaterThan(0);
  });

  it('consumeWsTicket succeeds for a valid ticket', () => {
    const ticket = createWsTicket(testUserId);
    const result = consumeWsTicket(ticket);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(testUserId);
  });

  it('consumeWsTicket fails on reuse (one-time)', () => {
    const ticket = createWsTicket(testUserId);
    const first = consumeWsTicket(ticket);
    const second = consumeWsTicket(ticket);
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
  });

  it('consumeWsTicket fails after expiry', () => {
    vi.useFakeTimers();
    try {
      const ticket = createWsTicket(testUserId);
      // Advance past TTL (30s)
      vi.advanceTimersByTime(31_000);
      const result = consumeWsTicket(ticket);
      expect(result.valid).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
