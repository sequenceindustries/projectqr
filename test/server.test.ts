import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';

let app: FastifyInstance;
let dir: string;
const logs: string[] = [];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrsite-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>home</title>');
  fs.writeFileSync(path.join(dir, 'wifi-qr-code.html'), '<!doctype html><title>wifi</title>');
  fs.writeFileSync(path.join(dir, '404.html'), '<!doctype html><title>404</title>');
  app = await buildApp({ staticDir: dir, eventsPerMinute: 5 });
  // Capture what the analytics endpoint would log.
  app.log.info = ((obj: unknown) => logs.push(JSON.stringify(obj))) as typeof app.log.info;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pages and headers', () => {
  it('serves pages with strict security headers', async () => {
    const r = await app.inject('/');
    expect(r.statusCode).toBe(200);
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.headers['permissions-policy']).toContain('camera=(self)');
    expect(r.headers['permissions-policy']).toContain('microphone=()');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it('extensionless routes, .html and trailing-slash redirects, 404s', async () => {
    expect((await app.inject('/wifi-qr-code')).statusCode).toBe(200);
    expect((await app.inject('/wifi-qr-code.html')).headers.location).toBe('/wifi-qr-code');
    expect((await app.inject('/wifi-qr-code/')).headers.location).toBe('/wifi-qr-code');
    expect((await app.inject('/qr-generator')).headers.location).toBe('/qr-code-generator');
    const nf = await app.inject('/nope');
    expect(nf.statusCode).toBe(404);
    expect(nf.body).toContain('404');
    expect((await app.inject('/api/nope')).json().error.code).toBe('not_found');
  });
  it('health check', async () => {
    expect((await app.inject('/healthz')).json()).toEqual({ ok: true });
  });
});

describe('analytics endpoint', () => {
  it('accepts whitelisted events and strips unknown or content-like properties', async () => {
    logs.length = 0;
    const r = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify({ name: 'qr_downloaded', props: { tool: 'wifi-qr-code', format: 'png', size: 1024, ssid: 'MyHome', data: 'secret', type: 'https://evil.example/x?y' } }),
    });
    expect(r.statusCode).toBe(204);
    const line = logs.find((l) => l.includes('analytics'))!;
    expect(line).toContain('"tool":"wifi-qr-code"');
    expect(line).not.toContain('MyHome');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('://');
  });
  it('ignores unknown event names and bad JSON', async () => {
    logs.length = 0;
    await app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'text/plain' }, payload: '{"name":"qr_content","props":{"tool":"x"}}' });
    await app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'text/plain' }, payload: 'not json' });
    expect(logs.filter((l) => l.includes('analytics'))).toHaveLength(0);
  });
  it('rate limits', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'text/plain' }, payload: '{}' })).statusCode);
    expect(codes).toContain(429);
  });
  it('rejects oversized bodies', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'text/plain' }, payload: 'x'.repeat(5000) });
    expect([400, 413, 429]).toContain(r.statusCode);
  });
});
