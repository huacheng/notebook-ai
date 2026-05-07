import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { csrfMiddleware } from '../csrf.js';

function makeApp() {
  const a = express();
  a.use(cookieParser());
  a.use(csrfMiddleware);
  a.get('/r', (_req, res) => { res.json({ ok: true }); });
  a.post('/r', (_req, res) => { res.json({ ok: true }); });
  return a;
}

describe('csrfMiddleware', () => {
  beforeEach(() => { delete process.env['NB_CSRF_DISABLED']; });
  afterEach(() => { delete process.env['NB_CSRF_DISABLED']; });

  it('GET requests do not check Origin', async () => {
    const r = await request(makeApp()).get('/r').set('Cookie', 'nb-auth-token=x');
    expect(r.status).toBe(200);
  });

  it('POST with cookie + allowed Origin passes', async () => {
    const r = await request(makeApp()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'http://localhost:3003');
    expect(r.status).toBe(200);
  });

  it('POST with cookie + foreign Origin gets 403', async () => {
    const r = await request(makeApp()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'https://evil.com');
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('Forbidden');
  });

  it('POST with cookie + missing Origin gets 403', async () => {
    const r = await request(makeApp()).post('/r').set('Cookie', 'nb-auth-token=x');
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('Origin');
  });

  it('POST with only Bearer header (no cookie) is not Origin-checked', async () => {
    const r = await request(makeApp()).post('/r')
      .set('Authorization', 'Bearer x')
      .set('Origin', 'https://anywhere.com');
    expect(r.status).toBe(200);
  });

  it('NB_CSRF_DISABLED=1 skips check', async () => {
    process.env['NB_CSRF_DISABLED'] = '1';
    const r = await request(makeApp()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'https://evil.com');
    expect(r.status).toBe(200);
  });

  it('POST with port-collision Origin gets 403 (regression)', async () => {
    const r = await request(makeApp()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'http://localhost:30033');
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('Forbidden');
  });

  it('POST with Origin: null literal gets 403', async () => {
    const r = await request(makeApp()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'null');
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('Forbidden');
  });

  it('POST uses Referer header when Origin missing', async () => {
    const r = await request(makeApp()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Referer', 'http://localhost:3003/some/path');
    expect(r.status).toBe(200);
  });
});
