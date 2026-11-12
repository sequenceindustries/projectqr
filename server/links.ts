import type { FastifyInstance, FastifyReply } from 'fastify';
import { checkAlias, checkDestination, CODE_RE, LINK_LIMITS, randomCode, type LinkInfo } from '../shared/links.js';

/**
 * URL shortener: the one feature that stores data server-side, because a
 * short link has to keep working after the visitor leaves.
 *
 * Stored per link: code, destination, created time, an aggregate click
 * count and a disabled flag. No IPs, user agents or per-click records.
 */

export interface StoredLink {
  code: string;
  url: string;
  createdAt: Date;
  clicks: number;
  disabled: boolean;
}

export interface LinkStore {
  init(): Promise<void>;
  /** Insert; returns false if the code is taken. */
  insert(code: string, url: string, custom: boolean): Promise<boolean>;
  /** An existing, active, non-custom code for this destination, to avoid duplicates. */
  findByUrl(url: string): Promise<string | null>;
  get(code: string): Promise<StoredLink | null>;
  hit(code: string): Promise<void>;
  report(code: string, reason: string): Promise<boolean>;
  close(): Promise<void>;
}

/* ---------- Memory store (tests and local development) ---------- */

export class MemoryLinkStore implements LinkStore {
  links = new Map<string, StoredLink & { custom: boolean }>();
  reports: { code: string; reason: string }[] = [];
  async init() {}
  async insert(code: string, url: string, custom: boolean) {
    if (this.links.has(code)) return false;
    this.links.set(code, { code, url, createdAt: new Date(), clicks: 0, disabled: false, custom });
    return true;
  }
  async findByUrl(url: string) {
    for (const l of this.links.values()) if (l.url === url && !l.custom && !l.disabled) return l.code;
    return null;
  }
  async get(code: string) {
    const l = this.links.get(code);
    return l ? { code: l.code, url: l.url, createdAt: l.createdAt, clicks: l.clicks, disabled: l.disabled } : null;
  }
  async hit(code: string) {
    const l = this.links.get(code);
    if (l) l.clicks++;
  }
  async report(code: string, reason: string) {
    if (!this.links.has(code)) return false;
    this.reports.push({ code, reason });
    return true;
  }
  async close() {}
}

/* ---------- Postgres store ---------- */

type Pool = import('pg').Pool;

export class PgLinkStore implements LinkStore {
  constructor(private pool: Pool) {}

  static async connect(connectionString: string): Promise<PgLinkStore> {
    const { default: pg } = await import('pg');
    const ssl = /sslmode=require/.test(connectionString) || process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined;
    const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl });
    const store = new PgLinkStore(pool);
    await store.init();
    return store;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS short_links (
        code        text PRIMARY KEY,
        url         text NOT NULL,
        custom      boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        clicks      bigint NOT NULL DEFAULT 0,
        disabled    boolean NOT NULL DEFAULT false,
        disabled_reason text
      );
      CREATE INDEX IF NOT EXISTS short_links_url_idx ON short_links (md5(url)) WHERE NOT custom;
      CREATE TABLE IF NOT EXISTS short_link_reports (
        id          bigserial PRIMARY KEY,
        code        text NOT NULL REFERENCES short_links(code) ON DELETE CASCADE,
        reason      text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async insert(code: string, url: string, custom: boolean) {
    const r = await this.pool.query('INSERT INTO short_links (code, url, custom) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING', [code, url, custom]);
    return r.rowCount === 1;
  }

  async findByUrl(url: string) {
    const r = await this.pool.query<{ code: string }>(
      'SELECT code FROM short_links WHERE md5(url) = md5($1) AND url = $1 AND NOT custom AND NOT disabled ORDER BY created_at LIMIT 1',
      [url],
    );
    return r.rows[0]?.code ?? null;
  }

  async get(code: string) {
    const r = await this.pool.query<{ code: string; url: string; created_at: Date; clicks: string; disabled: boolean }>(
      'SELECT code, url, created_at, clicks, disabled FROM short_links WHERE code = $1',
      [code],
    );
    const row = r.rows[0];
    return row ? { code: row.code, url: row.url, createdAt: row.created_at, clicks: Number(row.clicks), disabled: row.disabled } : null;
  }

  async hit(code: string) {
    await this.pool.query('UPDATE short_links SET clicks = clicks + 1 WHERE code = $1', [code]);
  }

  async report(code: string, reason: string) {
    try {
      await this.pool.query('INSERT INTO short_link_reports (code, reason) VALUES ($1, $2)', [code, reason]);
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await this.pool.end();
  }
}

/* ---------- Routes ---------- */

export interface LinkRouteOptions {
  store: LinkStore | null;
  /** Public origin for short links, e.g. https://example.com (no trailing slash). */
  baseUrl: string;
  /** Hosts that belong to this site; links to them are refused. */
  ownHosts: string[];
  /** Static page that renders link previews / errors (link.html), if built. */
  page?: () => Buffer | undefined;
  createPerHour?: number;
}

const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.status(status).send({ error: { code, message } });

export async function registerLinkRoutes(app: FastifyInstance, o: LinkRouteOptions) {
  const base = o.baseUrl.replace(/\/+$/, '');
  const info = (l: StoredLink): LinkInfo => ({
    code: l.code,
    url: l.url,
    shortUrl: `${base}/s/${l.code}`,
    createdAt: l.createdAt.toISOString(),
    clicks: l.clicks,
    disabled: l.disabled,
  });

  const lookup = async (raw: string) => {
    if (!o.store || !CODE_RE.test(raw)) return null;
    // Custom endings are lowercase; accept them typed in any case.
    return (await o.store.get(raw)) ?? (raw !== raw.toLowerCase() ? await o.store.get(raw.toLowerCase()) : null);
  };

  app.post(
    '/api/links',
    { config: { rateLimit: { max: o.createPerHour ?? 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!o.store) return err(reply, 503, 'unavailable', 'Link shortening isn’t available right now. Please try again later.');
      const b = (req.body ?? {}) as { url?: unknown; alias?: unknown };
      const dest = checkDestination(b.url, o.ownHosts);
      if (!dest.ok) return err(reply, 400, dest.code, dest.message);
      const alias = checkAlias(b.alias);
      if (!alias.ok) return err(reply, 400, alias.code, alias.message);

      if (alias.alias) {
        const ok = await o.store.insert(alias.alias, dest.url, true);
        if (!ok) return err(reply, 409, 'alias_taken', 'That ending is already taken. Try another.');
        req.log.info({ evt: 'short_link', custom: true }, 'short link created');
        return reply.status(201).send(info((await o.store.get(alias.alias))!));
      }

      const existing = await o.store.findByUrl(dest.url);
      if (existing) return reply.status(200).send(info((await o.store.get(existing))!));

      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        if (await o.store.insert(code, dest.url, false)) {
          req.log.info({ evt: 'short_link', custom: false }, 'short link created');
          return reply.status(201).send(info((await o.store.get(code))!));
        }
      }
      return err(reply, 500, 'server_error', 'Something went wrong. Please try again.');
    },
  );

  app.get<{ Params: { code: string } }>('/api/links/:code', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!o.store) return err(reply, 503, 'unavailable', 'Link shortening isn’t available right now.');
    const l = await lookup(req.params.code);
    if (!l) return err(reply, 404, 'not_found', 'We couldn’t find that short link.');
    reply.header('Cache-Control', 'no-store');
    return info(l);
  });

  app.post<{ Params: { code: string } }>('/api/links/:code/report', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!o.store) return err(reply, 503, 'unavailable', 'Reporting isn’t available right now.');
    const reasonRaw = (req.body as { reason?: unknown } | null)?.reason;
    const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, LINK_LIMITS.reportMax) : '';
    if (!reason) return err(reply, 400, 'empty', 'Tell us briefly what’s wrong with this link.');
    if (!CODE_RE.test(req.params.code) || !(await o.store.report(req.params.code, reason))) return err(reply, 404, 'not_found', 'We couldn’t find that short link.');
    req.log.warn({ evt: 'short_link_reported', code: req.params.code }, 'short link reported');
    return reply.status(202).send({ ok: true });
  });

  const page = (reply: FastifyReply, status: number) => {
    const html = o.page?.();
    reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
    if (html) return reply.status(status).type('text/html; charset=utf-8').send(html);
    return reply.status(status).type('text/plain; charset=utf-8').send(status === 404 ? 'Short link not found.' : 'Short link unavailable.');
  };

  app.get<{ Params: { code: string } }>('/s/:code', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = decodeURIComponent(req.params.code);
    // "/s/abc+" shows where a link goes without visiting it.
    if (raw.endsWith('+')) return page(reply, (await lookup(raw.slice(0, -1))) ? 200 : 404);
    if (!o.store) return page(reply, 503);
    const l = await lookup(raw);
    if (!l) return page(reply, 404);
    if (l.disabled) return page(reply, 410);
    o.store.hit(l.code).catch((e) => req.log.error(e));
    reply.header('Cache-Control', 'private, max-age=0').header('X-Robots-Tag', 'noindex').header('Referrer-Policy', 'no-referrer');
    return reply.redirect(l.url, 302);
  });
}
