import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { PgLinkStore, type LinkStore } from './links.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const list = (v: string | undefined) => (v ? v.split(/[\s,]+/).filter(Boolean) : []);

// Short links need Postgres. Without DATABASE_URL the rest of the site runs
// normally and the shortener politely reports that it's unavailable.
let store: LinkStore | null = null;
if (process.env.DATABASE_URL) {
  try {
    store = await PgLinkStore.connect(process.env.DATABASE_URL);
  } catch (e) {
    console.error('URL shortener disabled: could not connect to the database.', (e as Error).message);
  }
}
const siteUrl = (process.env.SHORT_LINK_BASE_URL || process.env.SITE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const ownHosts = [siteUrl, process.env.SITE_URL ?? '']
  .filter(Boolean)
  .map((u) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  })
  .filter(Boolean);

const app = await buildApp({
  links: { store, baseUrl: siteUrl, ownHosts, createPerHour: Number(process.env.SHORT_LINKS_PER_HOUR) || undefined },
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, '../../dist'),
  logger: true,
  eventsPerMinute: Number(process.env.EVENTS_PER_MINUTE) || undefined,
  cspExtra: {
    script: list(process.env.CSP_SCRIPT_SRC),
    connect: list(process.env.CSP_CONNECT_SRC),
    img: list(process.env.CSP_IMG_SRC),
    frame: list(process.env.CSP_FRAME_SRC),
  },
});

const port = Number(process.env.PORT) || 8080;
await app.listen({ port, host: '0.0.0.0' });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    app.log.info({ sig }, 'shutting down');
    app
      .close()
      .then(() => store?.close())
      .then(() => process.exit(0));
  });
}
