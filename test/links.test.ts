import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';
import { MemoryLinkStore, PgLinkStore, type LinkStore } from '../server/links.js';
import { checkAlias, checkDestination, CODE_ALPHABET, randomCode } from '../shared/links.js';

const BASE = 'https://codes.example.com';
const json = (payload: unknown) => ({ method: 'POST' as const, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });

describe('destination rules', () => {
  const own = ['codes.example.com'];
  it.each([
    ['example.com/menu', 'https://example.com/menu'],
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['http://sub.example.co.za', 'http://sub.example.co.za/'],
    ['https://例え.jp/パス', 'https://xn--r8jz45g.jp/%E3%83%91%E3%82%B9'],
  ])('accepts %s', (input, out) => {
    const r = checkDestination(input, own);
    expect(r.ok && r.url).toBe(out);
  });
  it.each([
    ['', 'empty'],
    ['not a url', 'invalid_url'],
    ['javascript:alert(1)', 'bad_scheme'],
    ['data:text/html,hi', 'bad_scheme'],
    ['ftp://example.com', 'bad_scheme'],
    ['https://user:pass@example.com', 'credentials'],
    ['http://localhost:3000', 'private_host'],
    ['http://127.0.0.1/admin', 'private_host'],
    ['http://192.168.1.1', 'private_host'],
    ['http://10.0.0.5', 'private_host'],
    ['http://169.254.169.254/latest', 'private_host'],
    ['http://[::1]/', 'private_host'],
    ['http://printer.local', 'private_host'],
    ['https://codes.example.com/s/abc', 'own_host'],
    ['https://bit.ly/xyz', 'shortener'],
    ['https://www.tinyurl.com/xyz', 'shortener'],
    ['https://example.com/' + 'a'.repeat(2100), 'too_long'],
    ['https://nodot', 'invalid_url'],
  ])('rejects %s', (input, code) => {
    const r = checkDestination(input, own);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
});

describe('alias rules', () => {
  it('accepts and lowercases', () => expect(checkAlias('Spring-Menu')).toEqual({ ok: true, alias: 'spring-menu' }));
  it('empty means none', () => expect(checkAlias('  ')).toEqual({ ok: true, alias: null }));
  it.each(['ab', 'a'.repeat(33), '-abc', 'abc-', 'a--b', 'a b', 'ünï', 'admin', 'login'])('rejects %s', (a) => expect(checkAlias(a).ok).toBe(false));
  it('random codes use the unambiguous alphabet', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => randomCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) {
      expect(c).toHaveLength(7);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });
});

function suite(name: string, makeStore: () => Promise<LinkStore | null>) {
  describe(name, () => {
    let app: FastifyInstance;
    let store: LinkStore | null;
    let dir: string;
    beforeAll(async () => {
      store = await makeStore();
      if (!store) return;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>home</title>');
      fs.writeFileSync(path.join(dir, 'link.html'), '<!doctype html><title>link page</title>');
      fs.writeFileSync(path.join(dir, '404.html'), '<!doctype html><title>404</title>');
      app = await buildApp({ staticDir: dir, links: { store, baseUrl: BASE, ownHosts: ['codes.example.com'], createPerHour: 1000 } });
      await app.ready();
    });
    afterAll(async () => {
      await app?.close();
      await store?.close();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('creates a short link and redirects to it', async (ctx) => {
      if (!store) return ctx.skip();
      const r = await app.inject({ url: '/api/links', ...json({ url: 'example.com/spring?x=1' }) });
      expect(r.statusCode).toBe(201);
      const body = r.json();
      expect(body.url).toBe('https://example.com/spring?x=1');
      expect(body.shortUrl).toBe(`${BASE}/s/${body.code}`);
      expect(body.code).toMatch(/^[A-Za-z0-9]{7}$/);
      const go = await app.inject(`/s/${body.code}`);
      expect(go.statusCode).toBe(302);
      expect(go.headers.location).toBe('https://example.com/spring?x=1');
      expect(go.headers['referrer-policy']).toBe('no-referrer');
      expect(go.headers['x-robots-tag']).toBe('noindex');
      await new Promise((res) => setTimeout(res, 50));
      expect((await app.inject(`/api/links/${body.code}`)).json().clicks).toBe(1);
    });

    it('reuses the code for the same destination', async (ctx) => {
      if (!store) return ctx.skip();
      const a = (await app.inject({ url: '/api/links', ...json({ url: 'https://example.com/same' }) })).json();
      const b = await app.inject({ url: '/api/links', ...json({ url: 'https://example.com/same' }) });
      expect(b.statusCode).toBe(200);
      expect(b.json().code).toBe(a.code);
    });

    it('custom endings: create, case-insensitive, taken', async (ctx) => {
      if (!store) return ctx.skip();
      const r = await app.inject({ url: '/api/links', ...json({ url: 'https://example.com/menu', alias: 'Lunch-Menu' }) });
      expect(r.statusCode).toBe(201);
      expect(r.json().code).toBe('lunch-menu');
      expect((await app.inject('/s/LUNCH-MENU')).headers.location).toBe('https://example.com/menu');
      const dup = await app.inject({ url: '/api/links', ...json({ url: 'https://example.com/other', alias: 'lunch-menu' }) });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('alias_taken');
    });

    it('rejects bad input with friendly messages', async (ctx) => {
      if (!store) return ctx.skip();
      for (const [payload, code] of [
        [{ url: 'javascript:alert(1)' }, 'bad_scheme'],
        [{ url: 'http://169.254.169.254/' }, 'private_host'],
        [{ url: 'https://codes.example.com/s/x' }, 'own_host'],
        [{ url: 'https://example.com', alias: 'admin' }, 'reserved_alias'],
        [{ url: 'https://example.com', alias: 'no spaces' }, 'invalid_alias'],
        [{}, 'empty'],
      ] as const) {
        const r = await app.inject({ url: '/api/links', ...json(payload) });
        expect(r.statusCode).toBe(400);
        expect(r.json().error.code).toBe(code);
        expect(r.json().error.message).toBeTruthy();
      }
    });

    it('preview, unknown and disabled links', async (ctx) => {
      if (!store) return ctx.skip();
      const { code } = (await app.inject({ url: '/api/links', ...json({ url: 'https://example.com/preview' }) })).json();
      const pv = await app.inject(`/s/${code}+`);
      expect(pv.statusCode).toBe(200);
      expect(pv.body).toContain('link page');
      expect(pv.headers['x-robots-tag']).toBe('noindex');
      expect((await app.inject('/s/nope123')).statusCode).toBe(404);
      expect((await app.inject('/s/%3Cscript%3E')).statusCode).toBe(404);
      expect((await app.inject('/api/links/nope123')).statusCode).toBe(404);
      // Disable it the way an operator would.
      if (store instanceof MemoryLinkStore) store.links.get(code)!.disabled = true;
      else await (store as PgLinkStore)['pool'].query('UPDATE short_links SET disabled = true WHERE code = $1', [code]);
      expect((await app.inject(`/s/${code}`)).statusCode).toBe(410);
      expect((await app.inject(`/api/links/${code}`)).json().disabled).toBe(true);
    });

    it('accepts abuse reports', async (ctx) => {
      if (!store) return ctx.skip();
      const { code } = (await app.inject({ url: '/api/links', ...json({ url: 'https://example.com/report-me' }) })).json();
      expect((await app.inject({ url: `/api/links/${code}/report`, ...json({ reason: 'Phishing page' }) })).statusCode).toBe(202);
      expect((await app.inject({ url: `/api/links/${code}/report`, ...json({ reason: '' }) })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/links/nope123/report', ...json({ reason: 'x' }) })).statusCode).toBe(404);
    });
  });
}

suite('shortener (memory store)', async () => new MemoryLinkStore());
suite('shortener (Postgres)', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const s = await PgLinkStore.connect(url);
  await s['pool'].query('TRUNCATE short_links CASCADE');
  return s;
});

describe('shortener without a database', () => {
  it('reports unavailable instead of failing', async () => {
    const app = await buildApp({ links: { store: null, baseUrl: BASE, ownHosts: [] } });
    const r = await app.inject({ url: '/api/links', ...json({ url: 'https://example.com' }) });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('unavailable');
    expect((await app.inject('/s/abcdefg')).statusCode).toBe(503);
    await app.close();
  });
  it('rate limits link creation', async () => {
    const app = await buildApp({ links: { store: new MemoryLinkStore(), baseUrl: BASE, ownHosts: [], createPerHour: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ url: '/api/links', ...json({ url: `https://example.com/${i}` }) })).statusCode);
    expect(codes.slice(0, 3)).toEqual([201, 201, 201]);
    expect(codes).toContain(429);
    await app.close();
  });
});
