import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_NAMES, EVENT_PROPS } from '../shared/events.js';

/**
 * QR Tools server.
 *
 * Every QR code is generated, scanned and zipped in the visitor's browser,
 * so this service never receives QR content. It only serves the prebuilt
 * static site and accepts whitelisted, content-free analytics events.
 */
export interface AppOptions {
  /** Directory of the built static site. Omit to run API-only (tests). */
  staticDir?: string;
  logger?: boolean;
  eventsPerMinute?: number;
  /** Extra origins allowed by the CSP, e.g. an ad or analytics network later. */
  cspExtra?: { script?: string[]; connect?: string[]; img?: string[]; frame?: string[] };
}

export function buildCsp(extra: NonNullable<AppOptions['cspExtra']> = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${(extra.script ?? []).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    // blob:/data: are needed for QR previews, downloads and uploaded logos.
    `img-src 'self' blob: data: ${(extra.img ?? []).join(' ')}`.trim(),
    // Camera frames stay in a local <video>; nothing is streamed anywhere.
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    `connect-src 'self' ${(extra.connect ?? []).join(' ')}`.trim(),
    `frame-src ${(extra.frame ?? []).length ? extra.frame!.join(' ') : "'none'"}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 8 * 1024,
    logger: opts.logger
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          // Never log client IPs, query strings or user agents.
          serializers: { req: (req) => ({ method: req.method, url: req.url.split('?')[0] }) },
        }
      : false,
  });

  const csp = buildCsp(opts.cspExtra);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Camera is allowed for this origin only (the scanner asks first); nothing else.
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) {
      reply.header('Content-Security-Policy', csp);
      reply.header('X-Frame-Options', 'DENY');
    }
    return payload;
  });

  await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ statusCode: 429, error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' } }),
  });

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' } });
    if (status && status >= 400 && status < 500) return reply.status(400).send({ error: { code: 'bad_request', message: 'Bad request.' } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'server_error', message: 'Something went wrong.' } });
  });

  app.get('/healthz', async () => ({ ok: true }));

  // First-party, cookie-free analytics. Only whitelisted names and short,
  // non-identifying properties are accepted; QR contents never reach here.
  app.post(
    '/api/events',
    { config: { rateLimit: { max: opts.eventsPerMinute ?? 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      let body = req.body as unknown;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          return reply.status(204).send();
        }
      }
      const b = body as { name?: unknown; props?: unknown } | null;
      if (!b || typeof b.name !== 'string' || !EVENT_NAMES.has(b.name)) return reply.status(204).send();
      const props: Record<string, string | number> = {};
      if (b.props && typeof b.props === 'object') {
        for (const [k, v] of Object.entries(b.props as Record<string, unknown>)) {
          if (!EVENT_PROPS.has(k)) continue;
          if (typeof v === 'number' && Number.isFinite(v)) props[k] = Math.round(v);
          // Short enum-like tokens only: anything that looks like content is cut to a safe shape.
          else if (typeof v === 'string') props[k] = v.slice(0, 32).replace(/[^\w.-]/g, '');
        }
      }
      req.log.info({ evt: 'analytics', name: b.name, ...props }, 'event');
      return reply.status(204).send();
    },
  );
  // sendBeacon posts text/plain.
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 2048 }, (_req, body, done) => done(null, body));

  if (opts.staticDir) await registerSite(app, opts.staticDir);
  return app;
}

async function registerSite(app: FastifyInstance, dir: string) {
  const root = path.resolve(dir);
  await app.register(fastifyStatic, {
    root,
    index: false,
    redirect: false,
    allowedPath: (p) => !p.endsWith('.html'),
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}_astro${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      else res.header('Cache-Control', 'public, max-age=86400');
    },
  });

  const files: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else files.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(root);

  // Pages are small: hold them in memory and serve extensionless routes.
  const pages = new Map<string, Buffer>();
  for (const rel of files) {
    if (!rel.endsWith('.html')) continue;
    pages.set(rel, fs.readFileSync(path.join(root, rel)));
    if (rel === '404.html') continue;
    const route = rel === 'index.html' ? '/' : '/' + rel.replace(/\.html$/, '');
    app.get(route, (_req, reply) =>
      reply.type('text/html; charset=utf-8').header('Cache-Control', 'public, max-age=0, must-revalidate').send(pages.get(rel)),
    );
    app.get('/' + rel, (_req, reply) => reply.redirect(route, 301));
  }

  // Common alternate spellings keep their search traffic.
  const moved: Record<string, string> = {
    '/qr-generator': '/qr-code-generator',
    '/qr-scanner': '/qr-code-scanner',
    '/qr-reader': '/qr-code-reader',
    '/wifi-qr-code-generator': '/wifi-qr-code',
    '/vcard-qr-code-generator': '/vcard-qr-code',
    '/qr-code-with-logo': '/custom-qr-code',
    '/bulk-qr-code': '/batch-qr-code',
  };
  for (const [from, to] of Object.entries(moved)) if (!files.includes(from.slice(1) + '.html')) app.get(from, (_q, r) => r.redirect(to, 301));

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && req.url.length > 1 && req.url.endsWith('/')) {
      const target = req.url.replace(/\/+$/, '');
      if (files.includes(target.slice(1) + '.html')) return reply.redirect(target, 301);
    }
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    const notFound = pages.get('404.html');
    if (notFound) return reply.status(404).type('text/html; charset=utf-8').send(notFound);
    return reply.status(404).send('Not found');
  });
}
